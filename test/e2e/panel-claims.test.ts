/**
 * LLA-06, LLA-10 y LLA-11 — Reclamos: registro y listados.
 *
 *   LLA-06  POST /api/me/claims      el admin reclama UNA de SUS llamadas
 *   LLA-10  GET  /api/me/claims      el admin ve solo sus reclamos
 *   LLA-11  GET  /api/admin/claims   el superadmin ve todos, con filtro de estado
 *
 * La regla de negocio clave del registro es la idempotencia: una llamada no puede
 * tener dos reclamos vigentes a la vez.
 *
 * Nota sobre la matriz: los listados de reclamos no tienen paginacion (listClaims
 * aplica un LIMIT de 1000); lo que se prueba es el filtro y el alcance por rol.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { RowDataPacket } from 'mysql2/promise';
import { testDb, clearAll, isMysqlUp } from '../helpers.js';
import { CLAIMS_COLLECTION } from '../../src/services/claims.js';
import { bearer, logsOfKind, makePanelApp, seedCall, seedClaim, seedPerson, systemErrors, NOW } from '../support/panel.js';

vi.mock('../../src/firebase.js', () => import('../support/firebaseMock.js'));

let app: any;
let mysqlUp = true;

const SUPER = () => bearer('superadmin', 'boss@x.com');
const JOSE = () => bearer('admin', 'jose@x.com');
const MEL = () => bearer('admin', 'mel@x.com');

const JUSTIFICACION = 'En el daily se acordo anular esta llamada.';

beforeAll(async () => {
  mysqlUp = await isMysqlUp();
  if (!mysqlUp) console.warn('\n[SKIP] MySQL no disponible.\n');
  app = await makePanelApp();
});

beforeEach(async () => {
  if (!mysqlUp) return;
  await clearAll();
  await seedPerson({ person_key: 'Jose', login_email: 'jose@x.com' });
  await seedPerson({ person_key: 'Mel', login_email: 'mel@x.com' });
  await seedCall({ id: 'jose_1', personKey: 'Jose', timestampMs: NOW });
  await seedCall({ id: 'jose_2', personKey: 'Jose', timestampMs: NOW + 1000 });
  await seedCall({ id: 'jose_anulada', personKey: 'Jose', deleted: true });
  await seedCall({ id: 'mel_1', personKey: 'Mel' });
});

function postClaim(token: string, body: Record<string, unknown>) {
  return request(app).post('/api/me/claims').set('Authorization', token).send(body);
}

describe('LLA-06 registrar un reclamo', () => {
  it('LLA-06 el admin reclama su llamada mas reciente y queda pendiente en la base', async () => {
    if (!mysqlUp) return;
    const res = await postClaim(JOSE(), { callId: 'jose_2', justification: JUSTIFICACION });

    expect(res.status).toBe(200);
    expect(res.body.claim.status).toBe('pending');

    const [rows] = await testDb().query<RowDataPacket[]>(`SELECT * FROM ${CLAIMS_COLLECTION}`);
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe(res.body.claim.id);
    expect(rows[0].call_id).toBe('jose_2');
    expect(rows[0].person_key).toBe('Jose');
    expect(rows[0].requested_by_email).toBe('jose@x.com');
    expect(rows[0].justification).toBe(JUSTIFICACION);
    expect(rows[0].status).toBe('pending');
    expect(rows[0].resolved_by_email).toBeNull();
  });

  it('LLA-06 rechaza un segundo reclamo sobre una llamada que ya tiene uno pendiente', async () => {
    if (!mysqlUp) return;
    const primero = await postClaim(JOSE(), { callId: 'jose_2', justification: JUSTIFICACION });
    expect(primero.status).toBe(200);

    const segundo = await postClaim(JOSE(), { callId: 'jose_2', justification: 'insisto, hay que anularla' });
    expect(segundo.status).toBe(400);
    expect(segundo.body.error).toBe('claim_already_exists');

    const [rows] = await testDb().query<RowDataPacket[]>(`SELECT * FROM ${CLAIMS_COLLECTION}`);
    expect(rows.length).toBe(1); // sigue habiendo uno solo
  });

  it('LLA-06 no se puede reclamar la llamada de otra persona', async () => {
    if (!mysqlUp) return;
    const res = await postClaim(JOSE(), { callId: 'mel_1', justification: JUSTIFICACION });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('not_your_call');
  });

  it('LLA-06 rechaza una justificacion demasiado corta, una llamada inexistente o ya anulada', async () => {
    if (!mysqlUp) return;
    const corta = await postClaim(JOSE(), { callId: 'jose_1', justification: 'no' });
    expect(corta.body.error).toBe('justification_too_short');

    const inexistente = await postClaim(JOSE(), { callId: 'no_existe', justification: JUSTIFICACION });
    expect(inexistente.body.error).toBe('call_not_found');

    const anulada = await postClaim(JOSE(), { callId: 'jose_anulada', justification: JUSTIFICACION });
    expect(anulada.body.error).toBe('call_already_annulled');

    const [rows] = await testDb().query<RowDataPacket[]>(`SELECT * FROM ${CLAIMS_COLLECTION}`);
    expect(rows.length).toBe(0);
  });

  it('LLA-06 la falla al registrar queda en el panel de salud y en system_errors', async () => {
    if (!mysqlUp) return;
    await postClaim(JOSE(), { callId: 'mel_1', justification: JUSTIFICACION });

    const logs = await logsOfKind('claim_failed');
    expect(logs.length).toBe(1);
    expect(logs[0].severity).toBe('error');
    expect(logs[0].action).toBe('create_claim');
    expect(String(logs[0].message)).toContain('not_your_call');

    const errors = await systemErrors();
    expect(errors.length).toBe(1);
    expect(String(errors[0].message)).toContain('not_your_call');
  });

  it('LLA-06 un usuario sin persona vinculada no puede reclamar (403 not_linked)', async () => {
    if (!mysqlUp) return;
    const res = await postClaim(bearer('admin', 'boss@x.com'), { callId: 'jose_1', justification: JUSTIFICACION });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('not_linked');
  });
});

describe('LLA-10 (admin) listar y filtrar mis reclamos', () => {
  beforeEach(async () => {
    if (!mysqlUp) return;
    await seedClaim({ id: 'c_jose_1', callId: 'jose_1', personKey: 'Jose', requestedByEmail: 'jose@x.com', createdAtMs: NOW });
    await seedClaim({
      id: 'c_jose_2', callId: 'jose_2', personKey: 'Jose', requestedByEmail: 'jose@x.com',
      status: 'accepted', createdAtMs: NOW + 2000
    });
    await seedClaim({ id: 'c_mel_1', callId: 'mel_1', personKey: 'Mel', requestedByEmail: 'mel@x.com' });
  });

  it('LLA-10 el admin ve solo los reclamos que el mismo solicito', async () => {
    if (!mysqlUp) return;
    const res = await request(app).get('/api/me/claims').set('Authorization', JOSE());

    expect(res.status).toBe(200);
    expect(res.body.claims.map((c: any) => c.id).sort()).toEqual(['c_jose_1', 'c_jose_2']);
    expect(res.body.claims.every((c: any) => c.requestedByEmail === 'jose@x.com')).toBe(true);
  });

  it('LLA-10 el listado viene del mas reciente al mas antiguo y con su estado', async () => {
    if (!mysqlUp) return;
    const res = await request(app).get('/api/me/claims').set('Authorization', JOSE());

    expect(res.body.claims.map((c: any) => c.id)).toEqual(['c_jose_2', 'c_jose_1']);
    expect(res.body.claims[0].status).toBe('accepted');
    expect(res.body.claims[1].status).toBe('pending');
  });

  it('LLA-10 otro admin ve sus propios reclamos, no los ajenos', async () => {
    if (!mysqlUp) return;
    const res = await request(app).get('/api/me/claims').set('Authorization', MEL());
    expect(res.body.claims.map((c: any) => c.id)).toEqual(['c_mel_1']);
  });

  it('LLA-10 un usuario sin persona vinculada no puede listar reclamos (403 not_linked)', async () => {
    if (!mysqlUp) return;
    const res = await request(app).get('/api/me/claims').set('Authorization', bearer('admin', 'boss@x.com'));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('not_linked');
  });
});

describe('LLA-11 (superadmin) listar y filtrar todos los reclamos', () => {
  beforeEach(async () => {
    if (!mysqlUp) return;
    await seedClaim({ id: 'c_jose_1', callId: 'jose_1', personKey: 'Jose', requestedByEmail: 'jose@x.com' });
    await seedClaim({
      id: 'c_jose_2', callId: 'jose_2', personKey: 'Jose', requestedByEmail: 'jose@x.com', status: 'accepted'
    });
    await seedClaim({
      id: 'c_mel_1', callId: 'mel_1', personKey: 'Mel', requestedByEmail: 'mel@x.com', status: 'rejected'
    });
  });

  it('LLA-11 el superadmin ve los reclamos de todas las personas', async () => {
    if (!mysqlUp) return;
    const res = await request(app).get('/api/admin/claims').set('Authorization', SUPER());

    expect(res.status).toBe(200);
    expect(res.body.claims.map((c: any) => c.id).sort()).toEqual(['c_jose_1', 'c_jose_2', 'c_mel_1']);
  });

  it('LLA-11 filtra por estado: pendientes, aceptados y rechazados', async () => {
    if (!mysqlUp) return;
    const pendientes = await request(app).get('/api/admin/claims?status=pending').set('Authorization', SUPER());
    expect(pendientes.body.claims.map((c: any) => c.id)).toEqual(['c_jose_1']);

    const aceptados = await request(app).get('/api/admin/claims?status=accepted').set('Authorization', SUPER());
    expect(aceptados.body.claims.map((c: any) => c.id)).toEqual(['c_jose_2']);

    const rechazados = await request(app).get('/api/admin/claims?status=rejected').set('Authorization', SUPER());
    expect(rechazados.body.claims.map((c: any) => c.id)).toEqual(['c_mel_1']);
  });

  it('LLA-11 un admin no puede ver los reclamos de todos (403)', async () => {
    if (!mysqlUp) return;
    const res = await request(app).get('/api/admin/claims').set('Authorization', JOSE());
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('insufficient_role');
  });
});
