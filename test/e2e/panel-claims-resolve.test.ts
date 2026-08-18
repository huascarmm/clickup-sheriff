/**
 * LLA-07 y LLA-08 — Resolver un reclamo desde el panel del superadmin
 * (POST /api/admin/claims/:id/resolve).
 *
 *   accepted -> el reclamo se acepta y la llamada se anula en la MISMA transaccion
 *   rejected -> el reclamo se rechaza y la llamada sigue vigente
 *
 * En ambos casos la operacion es idempotente (un reclamo resuelto no se
 * re-resuelve, ni siquiera bajo dos peticiones simultaneas), esta protegida por
 * rol y deja auditoria. El recalculo de contadores que dispara la aceptacion se
 * prueba a fondo en test/integration/claims-recalc.test.ts.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { RowDataPacket } from 'mysql2/promise';
import { testDb, clearAll, isMysqlUp } from '../helpers.js';
import { CALLS_COLLECTION } from '../../src/services/attention.js';
import { CLAIMS_COLLECTION } from '../../src/services/claims.js';
import { personStats } from '../../src/services/stats.js';
import {
  auditEntries, bearer, logsOfKind, makePanelApp, seedCall, seedClaim, seedPerson, systemErrors, NOW, PERIOD
} from '../support/panel.js';

vi.mock('../../src/firebase.js', () => import('../support/firebaseMock.js'));

let app: any;
let mysqlUp = true;

const SUPER = () => bearer('superadmin', 'boss@x.com');
const JOSE = () => bearer('admin', 'jose@x.com');

beforeAll(async () => {
  mysqlUp = await isMysqlUp();
  if (!mysqlUp) console.warn('\n[SKIP] MySQL no disponible.\n');
  app = await makePanelApp();
});

beforeEach(async () => {
  if (!mysqlUp) return;
  await clearAll();
  await seedPerson({ person_key: 'Jose', login_email: 'jose@x.com' });

  // Semana de Jose con tolerancia 2: dos avisos y una formal (la reclamada).
  await seedCall({ id: 'jose_1', personKey: 'Jose', isTolerance: true, tolerance: 'SI 1/2', weeklyCountAfter: 1, timestampMs: NOW });
  await seedCall({ id: 'jose_2', personKey: 'Jose', isTolerance: true, tolerance: 'SI 2/2', weeklyCountAfter: 2, timestampMs: NOW + 1000 });
  await seedCall({ id: 'jose_3', personKey: 'Jose', isTolerance: false, tolerance: 'NO 3/2', weeklyCountAfter: 3, periodAttentionCountAfter: 1, timestampMs: NOW + 2000 });

  await seedClaim({ id: 'claim_1', callId: 'jose_3', personKey: 'Jose', requestedByEmail: 'jose@x.com' });
});

function resolve(token: string, claimId: string, body: Record<string, unknown>) {
  return request(app).post(`/api/admin/claims/${claimId}/resolve`).set('Authorization', token).send(body);
}

async function claimRow(id: string): Promise<RowDataPacket> {
  const [rows] = await testDb().query<RowDataPacket[]>(`SELECT * FROM ${CLAIMS_COLLECTION} WHERE id = ?`, [id]);
  return rows[0];
}

async function callRow(id: string): Promise<RowDataPacket> {
  const [rows] = await testDb().query<RowDataPacket[]>(`SELECT * FROM ${CALLS_COLLECTION} WHERE id = ?`, [id]);
  return rows[0];
}

describe('LLA-07 aceptar el reclamo a una llamada', () => {
  it('LLA-07 el superadmin acepta: el reclamo queda aceptado y la llamada anulada', async () => {
    if (!mysqlUp) return;
    const res = await resolve(SUPER(), 'claim_1', { decision: 'accepted', message: 'Confirmado, se anula.' });

    expect(res.status).toBe(200);
    expect(res.body.claim.status).toBe('accepted');

    const claim = await claimRow('claim_1');
    expect(claim.status).toBe('accepted');
    expect(claim.resolved_by_email).toBe('boss@x.com');
    expect(claim.resolution_message).toBe('Confirmado, se anula.');
    expect(Number(claim.resolved_at_ms)).toBeGreaterThan(0);

    const call = await callRow('jose_3');
    expect(!!call.deleted).toBe(true);
    expect(call.deleted_by).toBe('boss@x.com');
    expect(call.claim_id).toBe('claim_1');
    expect(String(call.deleted_reason)).toContain('Reclamo aceptado');
  });

  it('LLA-07 la llamada anulada deja de contar en las estadisticas de la persona', async () => {
    if (!mysqlUp) return;
    const antes = await personStats(testDb(), 'Jose', PERIOD);
    expect(antes.formalCalls).toBe(1);

    await resolve(SUPER(), 'claim_1', { decision: 'accepted', message: 'Se anula.' });

    const despues = await personStats(testDb(), 'Jose', PERIOD);
    expect(despues.formalCalls).toBe(0);
    expect(despues.annulled).toBe(1);
    expect(despues.tolerances).toBe(2); // las tolerancias siguen igual
  });

  it('LLA-07 la aceptacion queda registrada en la auditoria', async () => {
    if (!mysqlUp) return;
    await resolve(SUPER(), 'claim_1', { decision: 'accepted', message: 'Se anula.' });

    const audit = await auditEntries('claim_accepted_annul');
    expect(audit.length).toBe(1);
    expect(audit[0].claim_id).toBe('claim_1');
    expect(audit[0].call_id).toBe('jose_3');
    expect(audit[0].by_email).toBe('boss@x.com');
  });

  it('LLA-07 un reclamo ya resuelto no se vuelve a aceptar', async () => {
    if (!mysqlUp) return;
    await resolve(SUPER(), 'claim_1', { decision: 'accepted', message: 'Se anula.' });

    const segundo = await resolve(SUPER(), 'claim_1', { decision: 'accepted', message: 'Otra vez.' });
    expect(segundo.status).toBe(400);
    expect(segundo.body.error).toBe('claim_already_resolved');

    const claim = await claimRow('claim_1');
    expect(claim.resolution_message).toBe('Se anula.'); // no se piso la resolucion original
    expect((await auditEntries('claim_accepted_annul')).length).toBe(1);
  });

  it('LLA-07 dos aceptaciones simultaneas: solo una prospera (transaccion + reintento)', async () => {
    if (!mysqlUp) return;
    const [a, b] = await Promise.all([
      resolve(SUPER(), 'claim_1', { decision: 'accepted', message: 'Se anula (A).' }),
      resolve(SUPER(), 'claim_1', { decision: 'accepted', message: 'Se anula (B).' })
    ]);

    const estados = [a.status, b.status].sort();
    expect(estados).toEqual([200, 400]);
    const fallida = a.status === 400 ? a : b;
    expect(fallida.body.error).toBe('claim_already_resolved');

    // La llamada se anulo una sola vez y hay una sola entrada de auditoria.
    expect(!!(await callRow('jose_3')).deleted).toBe(true);
    expect((await auditEntries('claim_accepted_annul')).length).toBe(1);
  });

  it('LLA-07 solo el superadmin puede aceptar: un admin recibe 403 y el reclamo sigue pendiente', async () => {
    if (!mysqlUp) return;
    const res = await resolve(JOSE(), 'claim_1', { decision: 'accepted', message: 'Se anula.' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('insufficient_role');

    expect((await claimRow('claim_1')).status).toBe('pending');
    expect(!!(await callRow('jose_3')).deleted).toBe(false);
  });

  it('LLA-07 la falla al aceptar queda en el panel de salud y en system_errors', async () => {
    if (!mysqlUp) return;
    const res = await resolve(SUPER(), 'no_existe', { decision: 'accepted', message: 'Se anula.' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('claim_not_found');

    const logs = await logsOfKind('claim_resolve_failed');
    expect(logs.length).toBe(1);
    expect(logs[0].severity).toBe('error');
    expect(logs[0].action).toBe('resolve_claim');

    const errors = await systemErrors();
    expect(errors.length).toBe(1);
    expect(String(errors[0].message)).toContain('claim_not_found');
  });
});

describe('LLA-08 rechazar el reclamo a una llamada', () => {
  it('LLA-08 el superadmin rechaza: el reclamo queda rechazado y la llamada sigue vigente', async () => {
    if (!mysqlUp) return;
    const res = await resolve(SUPER(), 'claim_1', { decision: 'rejected', message: 'No procede.' });

    expect(res.status).toBe(200);
    expect(res.body.claim.status).toBe('rejected');

    const claim = await claimRow('claim_1');
    expect(claim.status).toBe('rejected');
    expect(claim.resolved_by_email).toBe('boss@x.com');
    expect(claim.resolution_message).toBe('No procede.');

    const call = await callRow('jose_3');
    expect(!!call.deleted).toBe(false);
    expect(call.claim_id).toBeNull();
  });

  it('LLA-08 el rechazo no altera los contadores de la persona', async () => {
    if (!mysqlUp) return;
    const antes = await personStats(testDb(), 'Jose', PERIOD);
    await resolve(SUPER(), 'claim_1', { decision: 'rejected', message: 'No procede.' });
    const despues = await personStats(testDb(), 'Jose', PERIOD);

    expect(despues).toEqual(antes);
    expect(despues.formalCalls).toBe(1);
  });

  it('LLA-08 el rechazo queda registrado en la auditoria', async () => {
    if (!mysqlUp) return;
    await resolve(SUPER(), 'claim_1', { decision: 'rejected', message: 'No procede.' });

    const audit = await auditEntries('claim_rejected');
    expect(audit.length).toBe(1);
    expect(audit[0].claim_id).toBe('claim_1');
    expect(audit[0].message).toBe('No procede.');
    expect(audit[0].by_email).toBe('boss@x.com');
  });

  it('LLA-08 un reclamo ya resuelto no se vuelve a rechazar', async () => {
    if (!mysqlUp) return;
    await resolve(SUPER(), 'claim_1', { decision: 'rejected', message: 'No procede.' });

    const segundo = await resolve(SUPER(), 'claim_1', { decision: 'rejected', message: 'Sigue sin proceder.' });
    expect(segundo.status).toBe(400);
    expect(segundo.body.error).toBe('claim_already_resolved');
    expect((await claimRow('claim_1')).resolution_message).toBe('No procede.');
  });

  it('LLA-08 un reclamo rechazado tampoco se puede aceptar despues', async () => {
    if (!mysqlUp) return;
    await resolve(SUPER(), 'claim_1', { decision: 'rejected', message: 'No procede.' });

    const res = await resolve(SUPER(), 'claim_1', { decision: 'accepted', message: 'Me arrepenti.' });
    expect(res.body.error).toBe('claim_already_resolved');
    expect(!!(await callRow('jose_3')).deleted).toBe(false);
  });

  it('LLA-08 dos rechazos simultaneos: solo uno prospera (transaccion + reintento)', async () => {
    if (!mysqlUp) return;
    const [a, b] = await Promise.all([
      resolve(SUPER(), 'claim_1', { decision: 'rejected', message: 'No procede (A).' }),
      resolve(SUPER(), 'claim_1', { decision: 'rejected', message: 'No procede (B).' })
    ]);

    expect([a.status, b.status].sort()).toEqual([200, 400]);
    expect((await auditEntries('claim_rejected')).length).toBe(1);
  });

  it('LLA-08 solo el superadmin puede rechazar: un admin recibe 403 y el reclamo sigue pendiente', async () => {
    if (!mysqlUp) return;
    const res = await resolve(JOSE(), 'claim_1', { decision: 'rejected', message: 'No procede.' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('insufficient_role');
    expect((await claimRow('claim_1')).status).toBe('pending');
  });

  it('LLA-08 rechaza una decision invalida o una respuesta vacia', async () => {
    if (!mysqlUp) return;
    const decisionInvalida = await resolve(SUPER(), 'claim_1', { decision: 'quizas', message: 'algo' });
    expect(decisionInvalida.status).toBe(400);
    expect(decisionInvalida.body.error).toBe('invalid_decision');

    const sinMensaje = await resolve(SUPER(), 'claim_1', { decision: 'rejected', message: '   ' });
    expect(sinMensaje.status).toBe(400);
    expect(sinMensaje.body.error).toBe('message_required');

    expect((await claimRow('claim_1')).status).toBe('pending');
  });

  it('LLA-08 la falla al rechazar queda en el panel de salud y en system_errors', async () => {
    if (!mysqlUp) return;
    const res = await resolve(SUPER(), 'no_existe', { decision: 'rejected', message: 'No procede.' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('claim_not_found');

    const logs = await logsOfKind('claim_resolve_failed');
    expect(logs.length).toBe(1);
    expect(JSON.stringify(logs[0].context)).toContain('rejected');
    expect((await systemErrors()).length).toBe(1);
  });
});
