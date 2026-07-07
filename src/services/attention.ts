/**
 * Servicio de llamadas de atencion. Orquesta: evaluar la tarea, y si aplica,
 * registrar la llamada de forma IDEMPOTENTE y con contadores CONSISTENTES.
 *
 * Aqui esta la mejora clave frente a la version de Google Sheets:
 *
 *  - Idempotencia por ID determinista: el documento se llama
 *    {dateKey}_{taskId}_{alertType}. Si ClickUp dispara el webhook 3 veces el
 *    mismo dia para la misma tarea, las 3 apuntan al mismo doc -> una sola
 *    llamada. Adios a la deduplicacion manual (hasAttentionAlreadyLoggedToday_).
 *
 *  - Contadores sin race condition: el conteo semanal y trimestral se lee y se
 *    escribe DENTRO de una transaccion de Firestore. Firestore reintenta la
 *    transaccion si hay contencion, garantizando secuencias 1,2,3,4... Adios a
 *    LockService + SpreadsheetApp.flush() + backoff.
 *
 * El envio a Slack (I/O de red) se hace FUERA de la transaccion y luego se
 * parcha el documento con el resultado, para no mantener la transaccion abierta
 * durante una llamada HTTP.
 */
import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import type { AlertDecision, AttentionCall, Person, Settings, ClickUpTask } from '../domain/types.js';
import { VALID_ALERT_TYPES } from '../domain/types.js';
import { evaluateTask, type PersonResolver } from '../domain/rules.js';
import { computeTolerance } from '../domain/tolerance.js';
import {
  formatDateKey,
  formatLocalDateTime,
  getPeriodKey,
  getWeekKey,
  round2
} from '../domain/time.js';
import { getTaskStatusName, getTaskUrl } from '../domain/clickupTask.js';
import { buildSlackMessage, type SlackPostResult } from './slack.js';

export const CALLS_COLLECTION = 'attention_calls';
export const ERRORS_COLLECTION = 'system_errors';

export interface AttentionDeps {
  db: Firestore;
  settings: Settings;
  people: PersonResolver;
  slack: {
    channelId: string;
    post: (channelId: string, text: string) => Promise<SlackPostResult>;
  };
  now?: () => number;
}

export type AttentionResult =
  | { ok: true; ignored: true; taskId: string; reason: string; status: string }
  | { ok: true; noAlert: true; taskId: string; status: string }
  | { ok: true; alreadyLogged: true; taskId: string; alertType: string; call: AttentionCall }
  | { ok: true; raised: true; taskId: string; call: AttentionCall };

export type AttentionPreview =
  | { ok: true; dryRun: true; wouldRaise: false; taskId: string; status: string; reason?: string }
  | {
      ok: true;
      dryRun: true;
      wouldRaise: true;
      taskId: string;
      status: string;
      alertType: string;
      personKey: string;
      personName: string;
      slackUserId: string;
      reason: string;
      hoursElapsed: number;
      tolerancePreview: string;
      wouldSkipAsDuplicate: boolean;
    };

/** Evalua una tarea y, si aplica, registra la llamada de atencion. */
export async function runAttentionCheck(task: ClickUpTask, deps: AttentionDeps): Promise<AttentionResult> {
  const now = deps.now ? deps.now() : Date.now();
  const evaluation = evaluateTask(task, deps.settings, deps.people, now);

  if (evaluation.kind === 'ignored') {
    return { ok: true, ignored: true, taskId: task.id, reason: evaluation.reason, status: evaluation.status };
  }
  if (evaluation.kind === 'none') {
    return { ok: true, noAlert: true, taskId: task.id, status: evaluation.status };
  }
  return raiseAttention(task, evaluation.decision, deps, now);
}

/**
 * Modo DRY-RUN: evalua la tarea real (con el estado fresco de ClickUp) y devuelve
 * lo que PASARIA, sin escribir en Firestore ni postear a Slack. Sirve para
 * verificar en produccion, contra la base y las URLs reales, que el flujo
 * funciona, sin generar efectos secundarios.
 */
export async function previewAttention(task: ClickUpTask, deps: AttentionDeps): Promise<AttentionPreview> {
  const now = deps.now ? deps.now() : Date.now();
  const evaluation = evaluateTask(task, deps.settings, deps.people, now);

  if (evaluation.kind === 'ignored') {
    return { ok: true, dryRun: true, wouldRaise: false, taskId: task.id, status: evaluation.status, reason: evaluation.reason };
  }
  if (evaluation.kind === 'none') {
    return { ok: true, dryRun: true, wouldRaise: false, taskId: task.id, status: evaluation.status };
  }

  const decision = evaluation.decision;
  const tz = deps.settings.timezone;
  const weekKey = getWeekKey(new Date(now), tz);
  const dateKey = formatDateKey(new Date(now), tz);

  // Lectura (no transaccional) del conteo semanal, solo para la vista previa.
  const weeklySnap = await deps.db
    .collection(CALLS_COLLECTION)
    .where('personKey', '==', decision.person.person_key)
    .where('weekKey', '==', weekKey)
    .where('deleted', '==', false)
    .get();
  const validTypes = new Set<string>(VALID_ALERT_TYPES);
  const previousWeeklyFaults = weeklySnap.docs.filter((d) => validTypes.has(String(d.data().alertType))).length;
  const { tolerance } = computeTolerance(previousWeeklyFaults, Number(deps.settings.overdueWeeklyTolerance));

  // ¿Ya hay una llamada vigente (no eliminada) hoy para esta tarea/tipo?
  const dupSnap = await deps.db.collection(CALLS_COLLECTION).doc(`${dateKey}_${task.id}_${decision.alertType}`).get();
  const wouldSkipAsDuplicate = dupSnap.exists && (dupSnap.data() as AttentionCall).deleted !== true;

  return {
    ok: true,
    dryRun: true,
    wouldRaise: true,
    taskId: task.id,
    status: evaluation.status,
    alertType: decision.alertType,
    personKey: decision.person.person_key,
    personName: decision.person.nombre_visible,
    slackUserId: decision.person.slack_user_id,
    reason: decision.reason,
    hoursElapsed: round2(decision.hoursElapsed),
    tolerancePreview: tolerance,
    wouldSkipAsDuplicate
  };
}

async function raiseAttention(
  task: ClickUpTask,
  decision: AlertDecision,
  deps: AttentionDeps,
  now: number
): Promise<AttentionResult> {
  const { db, settings } = deps;
  const tz = settings.timezone;
  const nowDate = new Date(now);

  const dateKey = formatDateKey(nowDate, tz);
  const weekKey = getWeekKey(nowDate, tz);
  const periodKey = getPeriodKey(nowDate, tz, settings.resetPeriodMonths);

  const person = decision.person;
  const docId = `${dateKey}_${task.id}_${decision.alertType}`;
  const ref = db.collection(CALLS_COLLECTION).doc(docId);

  // --- Transaccion: idempotencia + contadores consistentes ---
  const outcome = await db.runTransaction(async (tx) => {
    const existing = await tx.get(ref);
    // Si ya existe una llamada VIGENTE (no eliminada) para esta tarea/tipo/dia,
    // es idempotencia real: no reenviamos. Pero si el documento existe pero fue
    // ELIMINADO (soft-delete: por error o por un test), la condicion puede seguir
    // vigente, asi que se debe volver a emitir la llamada de atencion.
    const existedButDeleted = existing.exists && (existing.data() as AttentionCall).deleted === true;
    if (existing.exists && !existedButDeleted) {
      return { alreadyLogged: true as const, call: existing.data() as AttentionCall };
    }

    // Conteo semanal de faltas de la persona (excluye llamadas eliminadas).
    const counts = await readCountsInTx(tx, db, settings, person.person_key, weekKey, periodKey);
    const { weeklyCountAfter, isTolerance, tolerance, periodAttentionCountAfter } = counts;

    const message = buildSlackMessage({
      person,
      taskUrl: getTaskUrl(task),
      taskName: task.name || task.id,
      alertType: decision.alertType,
      reason: decision.reason,
      tolerance,
      isTolerance,
      periodAttentionCountAfter
    });

    const call: AttentionCall = {
      id: docId,
      timestampLocal: formatLocalDateTime(now, tz),
      timestampMs: now,
      dateKey,
      weekKey,
      periodKey,
      taskId: task.id,
      taskName: task.name || '',
      taskUrl: getTaskUrl(task),
      currentStatus: getTaskStatusName(task),
      alertType: decision.alertType,
      personKey: person.person_key,
      personName: person.nombre_visible,
      slackUserId: person.slack_user_id,
      reason: decision.reason,
      hoursElapsed: round2(decision.hoursElapsed),
      dueDateLocal: decision.dueDateMs ? formatLocalDateTime(decision.dueDateMs, tz) : '',
      statusChangeLocal: decision.statusChangeMs ? formatLocalDateTime(decision.statusChangeMs, tz) : '',
      tolerance,
      isTolerance,
      weeklyCountAfter,
      periodAttentionCountAfter,
      slackOk: false,
      slackTs: '',
      slackError: '',
      message,
      deleted: false
    };

    // Si el doc no existe, create() da doble cinturon de idempotencia.
    // Si existia pero estaba eliminado, set() lo sobrescribe por completo,
    // limpiando los campos de borrado (deletedBy/deletedReason/deletedAt).
    if (existedButDeleted) {
      tx.set(ref, { ...call, createdAt: FieldValue.serverTimestamp() });
    } else {
      tx.create(ref, { ...call, createdAt: FieldValue.serverTimestamp() });
    }
    return { alreadyLogged: false as const, call };
  });

  if (outcome.alreadyLogged) {
    return { ok: true, alreadyLogged: true, taskId: task.id, alertType: decision.alertType, call: outcome.call };
  }

  // --- Slack fuera de la transaccion, luego parchamos el resultado ---
  let slackResult: SlackPostResult = { ok: false, ts: '', error: '' };
  try {
    slackResult = await deps.slack.post(deps.slack.channelId, outcome.call.message);
  } catch (err) {
    slackResult = { ok: false, ts: '', error: (err as Error).message };
  }

  await ref.set(
    { slackOk: slackResult.ok, slackTs: slackResult.ts || '', slackError: slackResult.error || '' },
    { merge: true }
  );

  const finalCall: AttentionCall = {
    ...outcome.call,
    slackOk: slackResult.ok,
    slackTs: slackResult.ts || '',
    slackError: slackResult.error || ''
  };
  return { ok: true, raised: true, taskId: task.id, call: finalCall };
}

/**
 * Lee, DENTRO de una transaccion, el conteo semanal (tolerancia) y, si aplica,
 * el conteo formal del periodo. Compartido por las llamadas automaticas
 * (webhook) y las manuales, para que ambas cuenten EXACTAMENTE igual.
 */
async function readCountsInTx(
  tx: FirebaseFirestore.Transaction,
  db: Firestore,
  settings: Settings,
  personKey: string,
  weekKey: string,
  periodKey: string
): Promise<{ weeklyCountAfter: number; isTolerance: boolean; tolerance: string; periodAttentionCountAfter: number | null }> {
  const validTypes = new Set<string>(VALID_ALERT_TYPES);

  const weeklySnap = await tx.get(
    db
      .collection(CALLS_COLLECTION)
      .where('personKey', '==', personKey)
      .where('weekKey', '==', weekKey)
      .where('deleted', '==', false)
  );
  const previousWeeklyFaults = weeklySnap.docs.filter((d) => validTypes.has(String(d.data().alertType))).length;

  const { weeklyCountAfter, isTolerance, tolerance } = computeTolerance(
    previousWeeklyFaults,
    Number(settings.overdueWeeklyTolerance)
  );

  let periodAttentionCountAfter: number | null = null;
  if (!isTolerance) {
    const qSnap = await tx.get(
      db
        .collection(CALLS_COLLECTION)
        .where('personKey', '==', personKey)
        .where('periodKey', '==', periodKey)
        .where('deleted', '==', false)
    );
    const previousFormal = qSnap.docs.filter((d) => {
      const x = d.data();
      return validTypes.has(String(x.alertType)) && String(x.tolerance || '').startsWith('NO');
    }).length;
    periodAttentionCountAfter = previousFormal + 1;
  }

  return { weeklyCountAfter, isTolerance, tolerance, periodAttentionCountAfter };
}

export interface ManualAttentionInput {
  person: Person;
  reason: string;
  comment?: string;
  createdByEmail: string;
}

/**
 * Registra una llamada de atencion MANUAL (creada por el superadmin desde el
 * panel). Sigue el MISMO procedimiento que las automaticas: cuenta tolerancia y
 * periodo, envia a Slack, guarda la hora exacta y quien la creo. La diferencia
 * es que no proviene de una tarea de ClickUp; la razon la escribe el superadmin.
 *
 * A diferencia del flujo por webhook, cada llamada manual es intencional y unica
 * (no hay idempotencia por tarea/dia): se genera un id propio en cada registro.
 */
export async function raiseManualAttention(
  input: ManualAttentionInput,
  deps: AttentionDeps
): Promise<{ ok: true; raised: true; call: AttentionCall }> {
  const { db, settings } = deps;
  const tz = settings.timezone;
  const now = deps.now ? deps.now() : Date.now();
  const nowDate = new Date(now);

  const reason = String(input.reason || '').trim();
  if (!reason) throw new Error('reason_required');
  const person = input.person;

  const dateKey = formatDateKey(nowDate, tz);
  const weekKey = getWeekKey(nowDate, tz);
  const periodKey = getPeriodKey(nowDate, tz, settings.resetPeriodMonths);

  // id unico y estable para la llamada manual.
  const rand = Math.random().toString(36).slice(2, 8);
  const docId = `manual_${now}_${person.person_key}_${rand}`;
  const ref = db.collection(CALLS_COLLECTION).doc(docId);
  const comment = String(input.comment || '').trim();

  const call = await db.runTransaction(async (tx) => {
    const counts = await readCountsInTx(tx, db, settings, person.person_key, weekKey, periodKey);
    const { weeklyCountAfter, isTolerance, tolerance, periodAttentionCountAfter } = counts;

    const message = buildSlackMessage({
      person,
      taskUrl: '',
      taskName: '',
      alertType: 'MANUAL',
      reason,
      comment,
      tolerance,
      isTolerance,
      periodAttentionCountAfter
    });

    const doc: AttentionCall = {
      id: docId,
      timestampLocal: formatLocalDateTime(now, tz),
      timestampMs: now,
      dateKey,
      weekKey,
      periodKey,
      taskId: '',
      taskName: '',
      taskUrl: '',
      currentStatus: '',
      alertType: 'MANUAL',
      personKey: person.person_key,
      personName: person.nombre_visible,
      slackUserId: person.slack_user_id,
      reason,
      hoursElapsed: 0,
      dueDateLocal: '',
      statusChangeLocal: '',
      tolerance,
      isTolerance,
      weeklyCountAfter,
      periodAttentionCountAfter,
      slackOk: false,
      slackTs: '',
      slackError: '',
      message,
      origin: 'manual',
      createdByEmail: input.createdByEmail,
      comment,
      deleted: false
    };

    tx.create(ref, { ...doc, createdAt: FieldValue.serverTimestamp() });
    return doc;
  });

  // Slack fuera de la transaccion, luego parchamos el resultado.
  let slackResult: SlackPostResult = { ok: false, ts: '', error: '' };
  try {
    slackResult = await deps.slack.post(deps.slack.channelId, call.message);
  } catch (err) {
    slackResult = { ok: false, ts: '', error: (err as Error).message };
  }
  await ref.set(
    { slackOk: slackResult.ok, slackTs: slackResult.ts || '', slackError: slackResult.error || '' },
    { merge: true }
  );

  return {
    ok: true,
    raised: true,
    call: { ...call, slackOk: slackResult.ok, slackTs: slackResult.ts || '', slackError: slackResult.error || '' }
  };
}

/** Registra un error del sistema para diagnostico (reemplaza SYSTEM_ERROR en la hoja). */
export async function logSystemError(db: Firestore, err: Error, context?: Record<string, unknown>): Promise<void> {
  try {
    await db.collection(ERRORS_COLLECTION).add({
      message: err.message,
      stack: err.stack || '',
      context: context || {},
      createdAt: FieldValue.serverTimestamp()
    });
  } catch {
    // Si ni siquiera podemos loguear el error, no hacemos nada mas.
  }
}
