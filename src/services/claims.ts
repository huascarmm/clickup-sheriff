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
import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';
import type { AttentionCall, Claim, ClaimStatus, Person } from '../domain/types.js';
import { CALLS_COLLECTION } from './attention.js';

export const CLAIMS_COLLECTION = 'claims';
const AUDIT_COLLECTION = 'audit_log';

/** Crea un reclamo sobre una llamada. Valida que sea del solicitante. */
export async function createClaim(
  db: Firestore,
  input: { callId: string; justification: string; requester: Person; requesterEmail: string }
): Promise<Claim> {
  const justification = String(input.justification || '').trim();
  if (justification.length < 5) throw new Error('justification_too_short');

  const callSnap = await db.collection(CALLS_COLLECTION).doc(input.callId).get();
  if (!callSnap.exists) throw new Error('call_not_found');
  const call = callSnap.data() as AttentionCall;

  // Seguridad: el admin solo reclama SUS propias llamadas.
  if (call.personKey !== input.requester.person_key) throw new Error('not_your_call');
  if (call.deleted) throw new Error('call_already_annulled');

  // Evitar reclamos duplicados vigentes (pending o accepted) sobre la misma llamada.
  const existing = await db
    .collection(CLAIMS_COLLECTION)
    .where('callId', '==', input.callId)
    .get();
  const hasOpen = existing.docs.some((d) => {
    const s = (d.data() as Claim).status;
    return s === 'pending' || s === 'accepted';
  });
  if (hasOpen) throw new Error('claim_already_exists');

  const now = Date.now();
  const claim: Claim = {
    id: '',
    callId: input.callId,
    taskId: call.taskId,
    taskName: call.taskName,
    taskUrl: call.taskUrl,
    alertType: call.alertType,
    callTimestampLocal: call.timestampLocal,
    personKey: call.personKey,
    personName: call.personName,
    requestedByEmail: input.requesterEmail.toLowerCase(),
    requestedByName: input.requester.nombre_visible,
    requestedBySlackId: input.requester.slack_user_id,
    justification,
    status: 'pending',
    createdAtMs: now
  };
  const ref = await db.collection(CLAIMS_COLLECTION).add({ ...claim, createdAt: FieldValue.serverTimestamp() });
  await ref.update({ id: ref.id });
  return { ...claim, id: ref.id };
}

/** Lista reclamos (opcionalmente filtrados por estado y/o solicitante). */
export async function listClaims(
  db: Firestore,
  opts: { status?: ClaimStatus; requesterEmail?: string; personKey?: string; limit?: number } = {}
): Promise<Claim[]> {
  const snap = await db
    .collection(CLAIMS_COLLECTION)
    .orderBy('createdAtMs', 'desc')
    .limit(opts.limit || 1000)
    .get();
  let claims = snap.docs.map((d) => ({ ...(d.data() as Claim), id: d.id }));
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
  db: Firestore,
  input: { claimId: string; decision: 'accepted' | 'rejected'; message: string; resolverEmail: string }
): Promise<Claim> {
  const message = String(input.message || '').trim();
  const claimRef = db.collection(CLAIMS_COLLECTION).doc(input.claimId);

  const result = await db.runTransaction(async (tx) => {
    const claimSnap = await tx.get(claimRef);
    if (!claimSnap.exists) throw new Error('claim_not_found');
    const claim = claimSnap.data() as Claim;
    if (claim.status !== 'pending') throw new Error('claim_already_resolved');

    const now = Date.now();
    tx.update(claimRef, {
      status: input.decision,
      resolvedByEmail: input.resolverEmail.toLowerCase(),
      resolvedAtMs: now,
      resolutionMessage: message
    });

    if (input.decision === 'accepted') {
      // Anula la llamada: deja de contar para tolerancia/periodo.
      const callRef = db.collection(CALLS_COLLECTION).doc(claim.callId);
      const callSnap = await tx.get(callRef);
      if (callSnap.exists) {
        tx.update(callRef, {
          deleted: true,
          deletedBy: input.resolverEmail.toLowerCase(),
          deletedReason: `Reclamo aceptado: ${message || claim.justification}`,
          deletedAt: FieldValue.serverTimestamp(),
          claimId: claim.id
        });
      }
    }
    return { ...claim, status: input.decision, resolvedByEmail: input.resolverEmail, resolvedAtMs: now, resolutionMessage: message };
  });

  // Auditoria fuera de la transaccion.
  await db.collection(AUDIT_COLLECTION).add({
    action: input.decision === 'accepted' ? 'claim_accepted_annul' : 'claim_rejected',
    claimId: input.claimId,
    callId: result.callId,
    by: input.resolverEmail.toLowerCase(),
    message,
    at: FieldValue.serverTimestamp()
  });

  return result;
}
