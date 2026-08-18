/**
 * Servicio de llamadas de atencion. Orquesta: evaluar la tarea, y si aplica,
 * registrar la llamada de forma IDEMPOTENTE y con contadores CONSISTENTES.
 *
 * Aqui esta la mejora clave frente a la version de Google Sheets:
 *
 *  - Idempotencia por ID determinista: la fila se llama
 *    {dateKey}_{taskId}_{alertType}. Si ClickUp dispara el webhook 3 veces el
 *    mismo dia para la misma tarea, las 3 apuntan a la misma fila -> una sola
 *    llamada. Adios a la deduplicacion manual (hasAttentionAlreadyLoggedToday_).
 *
 *  - Contadores sin race condition: el conteo semanal y trimestral se lee y se
 *    escribe DENTRO de una transaccion SERIALIZABLE de MySQL, con SELECT ...
 *    FOR UPDATE sobre las filas relevantes. InnoDB bloquea (next-key locking)
 *    el rango de filas leido, asi que una transaccion concurrente que intente
 *    insertar en ese mismo rango espera hasta que la primera confirme,
 *    garantizando secuencias 1,2,3,4... igual que el reintento automatico de
 *    Firestore. withTransaction() reintenta si hay deadlock/lock-wait-timeout.
 *
 * El envio a Slack (I/O de red) se hace FUERA de la transaccion y luego se
 * parcha la fila con el resultado, para no mantener la transaccion abierta
 * durante una llamada HTTP.
 */
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { withTransaction, type DbConn } from '../db.js';
import type { AlertDecision, AlertType, AttentionCall, Person, Settings, ClickUpTask } from '../domain/types.js';
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
  db: DbConn;
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

export interface AttentionCallRow extends RowDataPacket {
  id: string;
  timestamp_local: string;
  timestamp_ms: number | string;
  date_key: string;
  week_key: string;
  period_key: string;
  task_id: string;
  task_name: string;
  task_url: string;
  current_status: string;
  alert_type: AlertType;
  person_key: string;
  person_name: string;
  slack_user_id: string;
  reason: string | null;
  hours_elapsed: number | string;
  due_date_local: string;
  status_change_local: string;
  tolerance: string;
  is_tolerance: number;
  weekly_count_after: number;
  period_attention_count_after: number | null;
  slack_ok: number;
  slack_ts: string;
  slack_error: string | null;
  message: string | null;
  origin: 'webhook' | 'manual' | null;
  created_by_email: string | null;
  comment: string | null;
  deleted: number;
  deleted_by: string | null;
  deleted_reason: string | null;
  deleted_at: string | null;
  claim_id: string | null;
  created_at: string;
}

export function rowToAttentionCall(row: AttentionCallRow): AttentionCall {
  return {
    id: row.id,
    timestampLocal: row.timestamp_local,
    timestampMs: Number(row.timestamp_ms),
    dateKey: row.date_key,
    weekKey: row.week_key,
    periodKey: row.period_key,
    taskId: row.task_id,
    taskName: row.task_name,
    taskUrl: row.task_url,
    currentStatus: row.current_status,
    alertType: row.alert_type,
    personKey: row.person_key,
    personName: row.person_name,
    slackUserId: row.slack_user_id,
    reason: row.reason || '',
    hoursElapsed: Number(row.hours_elapsed),
    dueDateLocal: row.due_date_local,
    statusChangeLocal: row.status_change_local,
    tolerance: row.tolerance,
    isTolerance: !!row.is_tolerance,
    weeklyCountAfter: row.weekly_count_after,
    periodAttentionCountAfter: row.period_attention_count_after,
    slackOk: !!row.slack_ok,
    slackTs: row.slack_ts,
    slackError: row.slack_error || '',
    message: row.message || '',
    origin: row.origin ?? undefined,
    createdByEmail: row.created_by_email ?? undefined,
    comment: row.comment ?? undefined,
    deleted: !!row.deleted,
    deletedBy: row.deleted_by ?? undefined,
    deletedReason: row.deleted_reason ?? undefined,
    deletedAt: row.deleted_at ?? undefined,
    claimId: row.claim_id ?? undefined,
    createdAt: row.created_at ?? undefined
  };
}

/** Fila completa (snake_case) lista para INSERT/UPDATE ... SET ?. Limpia los campos de borrado. */
function callToRow(call: AttentionCall): Record<string, unknown> {
  return {
    id: call.id,
    timestamp_local: call.timestampLocal,
    timestamp_ms: call.timestampMs,
    date_key: call.dateKey,
    week_key: call.weekKey,
    period_key: call.periodKey,
    task_id: call.taskId,
    task_name: call.taskName,
    task_url: call.taskUrl,
    current_status: call.currentStatus,
    alert_type: call.alertType,
    person_key: call.personKey,
    person_name: call.personName,
    slack_user_id: call.slackUserId,
    reason: call.reason,
    hours_elapsed: call.hoursElapsed,
    due_date_local: call.dueDateLocal,
    status_change_local: call.statusChangeLocal,
    tolerance: call.tolerance,
    is_tolerance: call.isTolerance,
    weekly_count_after: call.weeklyCountAfter,
    period_attention_count_after: call.periodAttentionCountAfter,
    slack_ok: call.slackOk,
    slack_ts: call.slackTs,
    slack_error: call.slackError,
    message: call.message,
    origin: call.origin ?? null,
    created_by_email: call.createdByEmail ?? null,
    comment: call.comment ?? null,
    deleted: call.deleted,
    deleted_by: null,
    deleted_reason: null,
    deleted_at: null,
    created_at: new Date()
  };
}

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
 * lo que PASARIA, sin escribir en MySQL ni postear a Slack. Sirve para
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
  const validTypes = new Set<string>(VALID_ALERT_TYPES);

  // Lectura (no transaccional) del conteo semanal, solo para la vista previa.
  const [weeklyRows] = await deps.db.query<RowDataPacket[]>(
    'SELECT alert_type FROM attention_calls WHERE person_key = ? AND week_key = ? AND deleted = FALSE',
    [decision.person.person_key, weekKey]
  );
  const previousWeeklyFaults = weeklyRows.filter((r) => validTypes.has(String(r.alert_type))).length;
  const { tolerance } = computeTolerance(previousWeeklyFaults, Number(deps.settings.overdueWeeklyTolerance));

  // ¿Ya hay una llamada vigente (no eliminada) hoy para esta tarea/tipo?
  const [dupRows] = await deps.db.query<RowDataPacket[]>(
    'SELECT deleted FROM attention_calls WHERE id = ?',
    [`${dateKey}_${task.id}_${decision.alertType}`]
  );
  const wouldSkipAsDuplicate = dupRows.length > 0 && !dupRows[0].deleted;

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
  const { settings } = deps;
  const tz = settings.timezone;
  const nowDate = new Date(now);

  const dateKey = formatDateKey(nowDate, tz);
  const weekKey = getWeekKey(nowDate, tz);
  const periodKey = getPeriodKey(nowDate, tz, settings.resetPeriodMonths);

  const person = decision.person;
  const docId = `${dateKey}_${task.id}_${decision.alertType}`;

  // --- Transaccion: idempotencia + contadores consistentes ---
  const outcome = await withTransaction(async (tx) => {
    const [existingRows] = await tx.query<AttentionCallRow[]>(
      'SELECT * FROM attention_calls WHERE id = ? FOR UPDATE',
      [docId]
    );
    const existing = existingRows[0];
    // Si ya existe una llamada VIGENTE (no eliminada) para esta tarea/tipo/dia,
    // es idempotencia real: no reenviamos. Pero si la fila existe pero fue
    // ELIMINADA (soft-delete: por error o por un test), la condicion puede seguir
    // vigente, asi que se debe volver a emitir la llamada de atencion.
    const existedButDeleted = !!existing && !!existing.deleted;
    if (existing && !existedButDeleted) {
      return { alreadyLogged: true as const, call: rowToAttentionCall(existing) };
    }

    // Conteo semanal de faltas de la persona (excluye llamadas eliminadas).
    const counts = await readCountsInTx(tx, settings, person.person_key, weekKey, periodKey);
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

    // Si la fila no existia, INSERT. Si existia pero estaba eliminada, UPDATE la
    // sobreescribe por completo, limpiando los campos de borrado
    // (deletedBy/deletedReason/deletedAt).
    const row = callToRow(call);
    if (existedButDeleted) {
      await tx.query('UPDATE attention_calls SET ? WHERE id = ?', [row, docId]);
    } else {
      try {
        await tx.query('INSERT INTO attention_calls SET ?', [row]);
      } catch (err) {
        // Doble cinturon de idempotencia ante una carrera muy improbable.
        if ((err as { code?: string }).code === 'ER_DUP_ENTRY') {
          const [again] = await tx.query<AttentionCallRow[]>('SELECT * FROM attention_calls WHERE id = ?', [docId]);
          return { alreadyLogged: true as const, call: rowToAttentionCall(again[0]) };
        }
        throw err;
      }
    }
    return { alreadyLogged: false as const, call };
  }, { isolation: 'SERIALIZABLE' });

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

  await deps.db.query('UPDATE attention_calls SET slack_ok = ?, slack_ts = ?, slack_error = ? WHERE id = ?', [
    slackResult.ok,
    slackResult.ts || '',
    slackResult.error || '',
    docId
  ]);

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
 * FOR UPDATE bloquea las filas leidas (y el hueco alrededor, en SERIALIZABLE)
 * para que una insercion concurrente del mismo person_key/week_key espere.
 */
async function readCountsInTx(
  tx: PoolConnection,
  settings: Settings,
  personKey: string,
  weekKey: string,
  periodKey: string
): Promise<{ weeklyCountAfter: number; isTolerance: boolean; tolerance: string; periodAttentionCountAfter: number | null }> {
  const validTypes = new Set<string>(VALID_ALERT_TYPES);

  const [weeklyRows] = await tx.query<RowDataPacket[]>(
    'SELECT alert_type FROM attention_calls WHERE person_key = ? AND week_key = ? AND deleted = FALSE FOR UPDATE',
    [personKey, weekKey]
  );
  const previousWeeklyFaults = weeklyRows.filter((r) => validTypes.has(String(r.alert_type))).length;

  const { weeklyCountAfter, isTolerance, tolerance } = computeTolerance(
    previousWeeklyFaults,
    Number(settings.overdueWeeklyTolerance)
  );

  let periodAttentionCountAfter: number | null = null;
  if (!isTolerance) {
    const [periodRows] = await tx.query<RowDataPacket[]>(
      'SELECT alert_type, tolerance FROM attention_calls WHERE person_key = ? AND period_key = ? AND deleted = FALSE FOR UPDATE',
      [personKey, periodKey]
    );
    const previousFormal = periodRows.filter(
      (r) => validTypes.has(String(r.alert_type)) && String(r.tolerance || '').startsWith('NO')
    ).length;
    periodAttentionCountAfter = previousFormal + 1;
  }

  return { weeklyCountAfter, isTolerance, tolerance, periodAttentionCountAfter };
}

/**
 * Recalcula tolerancia y conteo formal de TODAS las llamadas vigentes de una
 * persona dentro de un periodo, releyendolas en orden cronologico y aplicando
 * las mismas reglas que readCountsInTx (misma funcion pura computeTolerance).
 *
 * Se usa despues de ANULAR una llamada: las posteriores "corren" un lugar hacia
 * atras. El conteo semanal solo afecta a las de su misma week_key, pero el
 * conteo formal del periodo se desplaza para todas las que vengan despues; y si
 * una llamada deja de ser formal, vuelve a ser aviso de tolerancia (y su
 * period_attention_count_after pasa a NULL).
 *
 * Se recorre el periodo COMPLETO en vez de solo lo posterior a la anulada: las
 * anteriores dependen unicamente de llamadas que no cambiaron, asi que salen
 * identicas y se saltan sin escribir. Debe ejecutarse DENTRO de la transaccion
 * que anula, con la fila ya marcada deleted = TRUE.
 *
 * En las filas que cambian se regenera tambien `message` (lleva el numero de
 * llamada y el formato tolerancia/formal), para que el panel no muestre un
 * texto que contradiga a los contadores. El mensaje YA ENVIADO a Slack no se
 * toca: es el historico de lo que se comunico en su momento.
 *
 * Devuelve cuantas filas cambiaron.
 */
export async function recalcPeriodCounts(
  tx: PoolConnection,
  settings: Settings,
  personKey: string,
  periodKey: string
): Promise<number> {
  const validTypes = new Set<string>(VALID_ALERT_TYPES);
  const toleranceLimit = Number(settings.overdueWeeklyTolerance);

  const [rows] = await tx.query<RowDataPacket[]>(
    `SELECT id, week_key, alert_type, tolerance, is_tolerance, weekly_count_after, period_attention_count_after,
            person_name, slack_user_id, task_url, task_name, reason, comment
     FROM ${CALLS_COLLECTION}
     WHERE person_key = ? AND period_key = ? AND deleted = FALSE
     ORDER BY timestamp_ms ASC, id ASC
     FOR UPDATE`,
    [personKey, periodKey]
  );

  const weeklyFaults = new Map<string, number>();
  let periodFormal = 0;
  let updated = 0;

  for (const row of rows) {
    if (!validTypes.has(String(row.alert_type))) continue;

    const weekKey = String(row.week_key);
    const { weeklyCountAfter, isTolerance, tolerance } = computeTolerance(
      weeklyFaults.get(weekKey) ?? 0,
      toleranceLimit
    );
    weeklyFaults.set(weekKey, weeklyCountAfter);

    let periodAttentionCountAfter: number | null = null;
    if (!isTolerance) {
      periodFormal += 1;
      periodAttentionCountAfter = periodFormal;
    }

    const currentPeriodCount =
      row.period_attention_count_after == null ? null : Number(row.period_attention_count_after);
    const unchanged =
      row.tolerance === tolerance &&
      !!row.is_tolerance === isTolerance &&
      Number(row.weekly_count_after) === weeklyCountAfter &&
      currentPeriodCount === periodAttentionCountAfter;
    if (unchanged) continue;

    // Se reconstruye con los MISMOS campos de origen que uso el alta, asi que
    // solo cambia lo que depende de los contadores.
    const message = buildSlackMessage({
      person: rowToMessagePerson(row, personKey),
      taskUrl: String(row.task_url || ''),
      taskName: String(row.task_name || ''),
      alertType: row.alert_type as AlertType,
      reason: String(row.reason || ''),
      comment: row.comment ? String(row.comment) : undefined,
      tolerance,
      isTolerance,
      periodAttentionCountAfter
    });

    await tx.query(
      `UPDATE ${CALLS_COLLECTION}
       SET tolerance = ?, is_tolerance = ?, weekly_count_after = ?, period_attention_count_after = ?, message = ?
       WHERE id = ?`,
      [tolerance, isTolerance, weeklyCountAfter, periodAttentionCountAfter, message, row.id]
    );
    updated += 1;
  }

  return updated;
}

/**
 * Persona minima para reconstruir la mencion del mensaje. Se arma desde la
 * propia fila (y no desde la tabla people) para que el texto regenerado use el
 * mismo nombre/slack id con el que se registro la llamada.
 */
function rowToMessagePerson(row: RowDataPacket, personKey: string): Person {
  return {
    person_key: personKey,
    nombre_visible: String(row.person_name || ''),
    slack_user_id: String(row.slack_user_id || ''),
    qa_string: '',
    clickup_user_id: '',
    clickup_username: '',
    clickup_email: '',
    login_email: '',
    activo: true,
    notas: ''
  };
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
  const { settings } = deps;
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
  const comment = String(input.comment || '').trim();

  const call = await withTransaction(async (tx) => {
    const counts = await readCountsInTx(tx, settings, person.person_key, weekKey, periodKey);
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

    await tx.query('INSERT INTO attention_calls SET ?', [callToRow(doc)]);
    return doc;
  }, { isolation: 'SERIALIZABLE' });

  // Slack fuera de la transaccion, luego parchamos el resultado.
  let slackResult: SlackPostResult = { ok: false, ts: '', error: '' };
  try {
    slackResult = await deps.slack.post(deps.slack.channelId, call.message);
  } catch (err) {
    slackResult = { ok: false, ts: '', error: (err as Error).message };
  }
  await deps.db.query('UPDATE attention_calls SET slack_ok = ?, slack_ts = ?, slack_error = ? WHERE id = ?', [
    slackResult.ok,
    slackResult.ts || '',
    slackResult.error || '',
    docId
  ]);

  return {
    ok: true,
    raised: true,
    call: { ...call, slackOk: slackResult.ok, slackTs: slackResult.ts || '', slackError: slackResult.error || '' }
  };
}

/** Registra un error del sistema para diagnostico (reemplaza SYSTEM_ERROR en la hoja). */
export async function logSystemError(db: DbConn, err: Error, context?: Record<string, unknown>): Promise<void> {
  try {
    await db.query('INSERT INTO system_errors (message, stack, context, created_at) VALUES (?, ?, ?, NOW())', [
      err.message,
      err.stack || '',
      JSON.stringify(context || {})
    ]);
  } catch {
    // Si ni siquiera podemos loguear el error, no hacemos nada mas.
  }
}
