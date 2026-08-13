/**
 * Servicio de reclamos (anulacion de llamadas de atencion).
 *
 * Flujo:
 *  - Un admin (miembro del equipo) solicita anular UNA de SUS llamadas, con una
 *    justificacion (p.ej. "en el daily se acordo anularla" o una incoherencia
 *    del sistema). Se crea un reclamo 'pending'. Un reclamo por llamada.
 *  - El superadmin lo revisa y ACEPTA o RECHAZA con un mensaje de respuesta.
 *  - Al ACEPTAR, la llamada se anula automaticamente (deleted=true) y deja de
 *    contar para los contadores (semanal/periodo).
 */
import { randomUUID } from 'node:crypto';
import type { RowDataPacket } from 'mysql2/promise';
import { withTransaction, type DbConn } from '../db.js';
import type { Claim, ClaimStatus, Person } from '../domain/types.js';
import { CALLS_COLLECTION } from './attention.js';

export const CLAIMS_COLLECTION = 'claims';
const AUDIT_COLLECTION = 'audit_log';

interface ClaimRow extends RowDataPacket {
  id: string;
  call_id: string;
  task_id: string;
  task_name: string;
  task_url: string;
  alert_type: Claim['alertType'];
  call_timestamp_local: string;
  person_key: string;
  person_name: string;
  requested_by_email: string;
  requested_by_name: string;
  requested_by_slack_id: string;
  justification: string;
  status: ClaimStatus;
  created_at: string;
  created_at_ms: number | string;
  resolved_by_email: string | null;
  resolved_at_ms: number | string | null;
  resolution_message: string | null;
}

function rowToClaim(row: ClaimRow): Claim {
  return {
    id: row.id,
    callId: row.call_id,
    taskId: row.task_id,
    taskName: row.task_name,
    taskUrl: row.task_url,
    alertType: row.alert_type,
    callTimestampLocal: row.call_timestamp_local,
    personKey: row.person_key,
    personName: row.person_name,
    requestedByEmail: row.requested_by_email,
    requestedByName: row.requested_by_name,
    requestedBySlackId: row.requested_by_slack_id,
    justification: row.justification,
    status: row.status,
    createdAt: row.created_at,
    createdAtMs: Number(row.created_at_ms),
    resolvedByEmail: row.resolved_by_email ?? undefined,
    resolvedAtMs: row.resolved_at_ms != null ? Number(row.resolved_at_ms) : undefined,
    resolutionMessage: row.resolution_message ?? undefined
  };
}

interface AttentionCallRowMin extends RowDataPacket {
  person_key: string;
  deleted: number;
}

/** Crea un reclamo sobre una llamada. Valida que sea del solicitante. */
export async function createClaim(
  db: DbConn,
  input: { callId: string; justification: string; requester: Person; requesterEmail: string }
): Promise<Claim> {
  const justification = String(input.justification || '').trim();
  if (justification.length < 5) throw new Error('justification_too_short');

  const [callRows] = await db.query<RowDataPacket[]>(
    `SELECT id, task_id, task_name, task_url, alert_type, timestamp_local, person_key, person_name, deleted
     FROM ${CALLS_COLLECTION} WHERE id = ?`,
    [input.callId]
  );
  const call = callRows[0];
  if (!call) throw new Error('call_not_found');

  // Seguridad: el admin solo reclama SUS propias llamadas.
  if (call.person_key !== input.requester.person_key) throw new Error('not_your_call');
  if (call.deleted) throw new Error('call_already_annulled');

  // Evitar reclamos duplicados vigentes (pending o accepted) sobre la misma llamada.
  const [openRows] = await db.query<RowDataPacket[]>(
    `SELECT id FROM ${CLAIMS_COLLECTION} WHERE call_id = ? AND status IN ('pending','accepted')`,
    [input.callId]
  );
  if (openRows.length > 0) throw new Error('claim_already_exists');

  const now = Date.now();
  const id = randomUUID();
  const claim: Claim = {
    id,
    callId: input.callId,
    taskId: call.task_id,
    taskName: call.task_name,
    taskUrl: call.task_url,
    alertType: call.alert_type,
    callTimestampLocal: call.timestamp_local,
    personKey: call.person_key,
    personName: call.person_name,
    requestedByEmail: input.requesterEmail.toLowerCase(),
    requestedByName: input.requester.nombre_visible,
    requestedBySlackId: input.requester.slack_user_id,
    justification,
    status: 'pending',
    createdAtMs: now
  };

  await db.query(
    `INSERT INTO ${CLAIMS_COLLECTION} (
      id, call_id, task_id, task_name, task_url, alert_type, call_timestamp_local,
      person_key, person_name, requested_by_email, requested_by_name, requested_by_slack_id,
      justification, status, created_at, created_at_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
    [
      claim.id, claim.callId, claim.taskId, claim.taskName, claim.taskUrl, claim.alertType,
      claim.callTimestampLocal, claim.personKey, claim.personName, claim.requestedByEmail,
      claim.requestedByName, claim.requestedBySlackId, claim.justification, claim.status, claim.createdAtMs
    ]
  );

  return claim;
}

/** Lista reclamos (opcionalmente filtrados por estado y/o solicitante). */
export async function listClaims(
  db: DbConn,
  opts: { status?: ClaimStatus; requesterEmail?: string; personKey?: string; limit?: number } = {}
): Promise<Claim[]> {
  const [rows] = await db.query<ClaimRow[]>(
    `SELECT * FROM ${CLAIMS_COLLECTION} ORDER BY created_at_ms DESC LIMIT ?`,
    [opts.limit || 1000]
  );
  let claims = rows.map(rowToClaim);
  if (opts.status) claims = claims.filter((c) => c.status === opts.status);
  if (opts.requesterEmail) {
    const email = opts.requesterEmail.toLowerCase();
    claims = claims.filter((c) => c.requestedByEmail === email);
  }
  if (opts.personKey) claims = claims.filter((c) => c.personKey === opts.personKey);
  return claims;
}

/**
 * Resuelve un reclamo. Si se ACEPTA, anula la llamada asociada en la MISMA
 * transaccion (deja de contar). Idempotente: no re-resuelve uno ya resuelto.
 */
export async function resolveClaim(
  db: DbConn,
  input: { claimId: string; decision: 'accepted' | 'rejected'; message: string; resolverEmail: string }
): Promise<Claim> {
  const message = String(input.message || '').trim();

  const result = await withTransaction(async (tx) => {
    const [claimRows] = await tx.query<ClaimRow[]>(`SELECT * FROM ${CLAIMS_COLLECTION} WHERE id = ? FOR UPDATE`, [
      input.claimId
    ]);
    const claimRow = claimRows[0];
    if (!claimRow) throw new Error('claim_not_found');
    const claim = rowToClaim(claimRow);
    if (claim.status !== 'pending') throw new Error('claim_already_resolved');

    const now = Date.now();
    const resolverEmail = input.resolverEmail.toLowerCase();
    await tx.query(
      `UPDATE ${CLAIMS_COLLECTION} SET status = ?, resolved_by_email = ?, resolved_at_ms = ?, resolution_message = ? WHERE id = ?`,
      [input.decision, resolverEmail, now, message, input.claimId]
    );

    if (input.decision === 'accepted') {
      // Anula la llamada: deja de contar para tolerancia/periodo.
      const [callRows] = await tx.query<AttentionCallRowMin[]>(`SELECT person_key FROM ${CALLS_COLLECTION} WHERE id = ?`, [
        claim.callId
      ]);
      if (callRows.length > 0) {
        await tx.query(
          `UPDATE ${CALLS_COLLECTION} SET deleted = TRUE, deleted_by = ?, deleted_reason = ?, deleted_at = NOW(), claim_id = ? WHERE id = ?`,
          [resolverEmail, `Reclamo aceptado: ${message || claim.justification}`, claim.id, claim.callId]
        );
      }
    }
    return { ...claim, status: input.decision, resolvedByEmail: resolverEmail, resolvedAtMs: now, resolutionMessage: message };
  });

  // Auditoria fuera de la transaccion.
  await db.query(
    `INSERT INTO ${AUDIT_COLLECTION} (action, claim_id, call_id, by_email, message, at) VALUES (?, ?, ?, ?, ?, NOW())`,
    [
      input.decision === 'accepted' ? 'claim_accepted_annul' : 'claim_rejected',
      input.claimId,
      result.callId,
      input.resolverEmail.toLowerCase(),
      message
    ]
  );

  return result;
}
