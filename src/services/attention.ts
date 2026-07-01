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
  getQuarterKey,
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
  const quarter = getQuarterKey(nowDate, tz);

  const person = decision.person;
  const docId = `${dateKey}_${task.id}_${decision.alertType}`;
  const ref = db.collection(CALLS_COLLECTION).doc(docId);

  // --- Transaccion: idempotencia + contadores consistentes ---
  const outcome = await db.runTransaction(async (tx) => {
    const existing = await tx.get(ref);
    if (existing.exists) {
      return { alreadyLogged: true as const, call: existing.data() as AttentionCall };
    }

    // Conteo semanal de faltas de la persona (excluye llamadas eliminadas).
    const weeklySnap = await tx.get(
      db
        .collection(CALLS_COLLECTION)
        .where('personKey', '==', person.person_key)
        .where('weekKey', '==', weekKey)
        .where('deleted', '==', false)
    );
    const validTypes = new Set<string>(VALID_ALERT_TYPES);
    const previousWeeklyFaults = weeklySnap.docs.filter((d) =>
      validTypes.has(String(d.data().alertType))
    ).length;

    const { weeklyCountAfter, isTolerance, tolerance } = computeTolerance(
      previousWeeklyFaults,
      Number(settings.overdueWeeklyTolerance)
    );

    let quarterlyAttentionCountAfter: number | null = null;
    if (!isTolerance) {
      const qSnap = await tx.get(
        db
          .collection(CALLS_COLLECTION)
          .where('personKey', '==', person.person_key)
          .where('quarter', '==', quarter)
          .where('deleted', '==', false)
      );
      const previousFormal = qSnap.docs.filter((d) => {
        const x = d.data();
        return validTypes.has(String(x.alertType)) && String(x.tolerance || '').startsWith('NO');
      }).length;
      quarterlyAttentionCountAfter = previousFormal + 1;
    }

    const message = buildSlackMessage({
      person,
      taskUrl: getTaskUrl(task),
      taskName: task.name || task.id,
      alertType: decision.alertType,
      reason: decision.reason,
      tolerance,
      isTolerance,
      quarterlyAttentionCountAfter
    });

    const call: AttentionCall = {
      id: docId,
      timestampLocal: formatLocalDateTime(now, tz),
      timestampMs: now,
      dateKey,
      weekKey,
      quarter,
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
      quarterlyAttentionCountAfter,
      slackOk: false,
      slackTs: '',
      slackError: '',
      message,
      deleted: false
    };

    // create() falla si el doc ya existe: doble cinturon de idempotencia.
    tx.create(ref, { ...call, createdAt: FieldValue.serverTimestamp() });
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
