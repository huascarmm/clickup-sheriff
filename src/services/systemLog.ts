/**
 * Registro de eventos del sistema para el panel de salud del superadmin.
 *
 * La idea (punto del usuario): todo webhook se dispara por alguna razon y en la
 * mayoria de casos deberia terminar en una llamada de atencion. Cuando NO es asi
 * (estado ignorado, no aplica, error, no se pudo verificar la tarea), se registra
 * aqui para poder auditar la salud del sistema y detectar fallos.
 */
import type { RowDataPacket } from 'mysql2/promise';
import type { DbConn } from '../db.js';
import { getSettings } from '../config.js';
import { formatLocalDateTime } from '../domain/time.js';
import { logSystemError } from './attention.js';
import type { LogSeverity, SystemLog } from '../domain/types.js';

export const SYSTEM_LOGS_COLLECTION = 'system_logs';

export interface LogInput {
  severity: LogSeverity;
  kind: string;
  message: string;
  taskId?: string;
  action?: string;
  status?: string;
  context?: Record<string, unknown>;
}

interface SystemLogRow extends RowDataPacket {
  id: number;
  severity: LogSeverity;
  kind: string;
  message: string | null;
  task_id: string | null;
  action: string | null;
  status: string | null;
  context: Record<string, unknown> | null;
  timestamp_ms: number | string;
  timestamp_local: string;
  created_at: string;
}

function rowToSystemLog(row: SystemLogRow): SystemLog {
  return {
    id: String(row.id),
    severity: row.severity,
    kind: row.kind,
    message: row.message || '',
    taskId: row.task_id || '',
    action: row.action || '',
    status: row.status || '',
    context: row.context || {},
    timestampMs: Number(row.timestamp_ms),
    timestampLocal: row.timestamp_local,
    createdAt: row.created_at
  };
}

export async function logEvent(db: DbConn, timezone: string, input: LogInput): Promise<void> {
  try {
    const now = Date.now();
    await db.query(
      `INSERT INTO ${SYSTEM_LOGS_COLLECTION} (
        severity, kind, message, task_id, action, status, context, timestamp_ms, timestamp_local, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        input.severity,
        input.kind,
        input.message,
        input.taskId || '',
        input.action || '',
        input.status || '',
        JSON.stringify(input.context || {}),
        now,
        formatLocalDateTime(now, timezone)
      ]
    );
  } catch {
    // Nunca dejamos que un fallo de logging tumbe el flujo principal.
  }
}

/**
 * Registra la falla de una ruta del panel en los DOS lugares que mira el
 * superadmin: el detalle tecnico (system_errors, para diagnosticar) y el panel de
 * salud (system_logs, para enterarse de que paso). Es el mismo par que ya hace el
 * webhook en webhooks/clickup.ts, pero en un solo sitio para no repetirlo en cada
 * catch. Nunca lanza: una falla al registrar no debe tapar la falla original.
 */
export async function logRouteFailure(
  db: DbConn,
  err: Error,
  info: { kind: string; action: string; context?: Record<string, unknown> }
): Promise<void> {
  await logSystemError(db, err, { action: info.action, ...(info.context || {}) });
  let timezone = 'America/La_Paz';
  try {
    timezone = (await getSettings()).timezone;
  } catch {
    // Si ni la configuracion se puede leer, el default alcanza para fechar el log.
  }
  await logEvent(db, timezone, {
    severity: 'error',
    kind: info.kind,
    message: err.message,
    action: info.action,
    context: info.context
  });
}

export async function listSystemLogs(
  db: DbConn,
  opts: { severity?: LogSeverity; kind?: string; limit?: number } = {}
): Promise<SystemLog[]> {
  const params: unknown[] = [];
  let sql = `SELECT * FROM ${SYSTEM_LOGS_COLLECTION}`;
  if (opts.severity) {
    sql += ' WHERE severity = ?';
    params.push(opts.severity);
  }
  sql += ' ORDER BY timestamp_ms DESC LIMIT ?';
  params.push(opts.limit || 500);

  const [rows] = await db.query<SystemLogRow[]>(sql, params);
  let logs = rows.map(rowToSystemLog);
  if (opts.kind) logs = logs.filter((l) => l.kind === opts.kind);
  return logs;
}
