/**
 * Registro de eventos del sistema para el panel de salud del superadmin.
 *
 * La idea (punto del usuario): todo webhook se dispara por alguna razon y en la
 * mayoria de casos deberia terminar en una llamada de atencion. Cuando NO es asi
 * (estado ignorado, no aplica, error, no se pudo verificar la tarea), se registra
 * aqui para poder auditar la salud del sistema y detectar fallos.
 */
import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import { formatLocalDateTime } from '../domain/time.js';
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

export async function logEvent(db: Firestore, timezone: string, input: LogInput): Promise<void> {
  try {
    const now = Date.now();
    const doc: SystemLog = {
      severity: input.severity,
      kind: input.kind,
      message: input.message,
      taskId: input.taskId || '',
      action: input.action || '',
      status: input.status || '',
      context: input.context || {},
      timestampMs: now,
      timestampLocal: formatLocalDateTime(now, timezone)
    };
    await db.collection(SYSTEM_LOGS_COLLECTION).add({ ...doc, createdAt: FieldValue.serverTimestamp() });
  } catch {
    // Nunca dejamos que un fallo de logging tumbe el flujo principal.
  }
}

export async function listSystemLogs(
  db: Firestore,
  opts: { severity?: LogSeverity; kind?: string; limit?: number } = {}
): Promise<SystemLog[]> {
  let q = db.collection(SYSTEM_LOGS_COLLECTION).orderBy('timestampMs', 'desc').limit(opts.limit || 500);
  if (opts.severity) q = q.where('severity', '==', opts.severity) as typeof q;
  const snap = await q.get();
  let logs = snap.docs.map((d) => ({ id: d.id, ...(d.data() as SystemLog) }));
  if (opts.kind) logs = logs.filter((l) => l.kind === opts.kind);
  return logs;
}
