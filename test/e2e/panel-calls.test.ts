/**
 * LLA-04 y LLA-05 — Listar y filtrar llamadas de atencion desde el panel.
 *
 *   LLA-04  GET /api/me/calls     el admin ve SOLO las suyas
 *   LLA-05  GET /api/admin/calls  el superadmin ve las de todos
 *
 * Nota sobre la matriz: la API no implementa paginacion (aplica un LIMIT fijo de
 * 2000 en /api/me/calls y 3000 en /api/admin/calls). Lo que se prueba aqui son
 * los filtros y el alcance de los datos segun el rol.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { clearAll, isMysqlUp } from '../helpers.js';
import { bearer, makePanelApp, seedCall, seedPerson } from '../support/panel.js';

vi.mock('../../src/firebase.js', () => import('../support/firebaseMock.js'));

let app: any;
let mysqlUp = true;

const SUPER = () => bearer('superadmin', 'boss@x.com');
const JOSE = () => bearer('admin', 'jose@x.com');
const MEL = () => bearer('admin', 'mel@x.com');

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

  // Jose: dos vigentes (una vieja de otra semana) y una anulada.
  await seedCall({
    id: 'jose_1', personKey: 'Jose', alertType: 'ATRASO_PLAZO', currentStatus: 'doing',
    dateKey: '2026-08-10', weekKey: '2026-08-10', taskId: 'AAA111', taskName: 'Página de login'
  });
  await seedCall({
    id: 'jose_2', personKey: 'Jose', alertType: 'QA_36H', currentStatus: 'QA',
    dateKey: '2026-08-17', taskId: 'BBB222', taskName: 'Pago duplicado'
  });
  await seedCall({
    id: 'jose_3', personKey: 'Jose', alertType: 'ATRASO_PLAZO', currentStatus: 'doing',
    dateKey: '2026-08-17', taskId: 'CCC333', taskName: 'Reporte mensual', deleted: true
  });
  // Mel: una vigente, que Jose NO debe ver.
  await seedCall({
    id: 'mel_1', personKey: 'Mel', alertType: 'MANUAL', currentStatus: '',
    dateKey: '2026-08-17', taskId: 'DDD444', taskName: 'Llamada manual'
  });
});

/** Ids devueltos por el listado, ordenados para comparar sin depender del orden. */
function ids(body: any): string[] {
  return body.calls.map((c: any) => c.id).sort();
}

describe('LLA-04 (admin) listar y filtrar mis llamadas', () => {
  it('LLA-04 el admin solo ve sus propias llamadas vigentes', async () => {
    if (!mysqlUp) return;
    const res = await request(app).get('/api/me/calls').set('Authorization', JOSE());

    expect(res.status).toBe(200);
    expect(ids(res.body)).toEqual(['jose_1', 'jose_2']); // ni las de Mel ni la anulada
    expect(res.body.calls.every((c: any) => c.personKey === 'Jose')).toBe(true);
  });

  it('LLA-04 filtra por tipo de alerta y por estado de la tarea', async () => {
    if (!mysqlUp) return;
    const porTipo = await request(app).get('/api/me/calls?alertType=QA_36H').set('Authorization', JOSE());
    expect(ids(porTipo.body)).toEqual(['jose_2']);

    // El estado se compara normalizado (sin acentos ni mayusculas).
    const porEstado = await request(app).get('/api/me/calls?status=qa').set('Authorization', JOSE());
    expect(ids(porEstado.body)).toEqual(['jose_2']);
  });

  it('LLA-04 filtra por rango de fechas', async () => {
    if (!mysqlUp) return;
    const desde = await request(app).get('/api/me/calls?from=2026-08-15').set('Authorization', JOSE());
    expect(ids(desde.body)).toEqual(['jose_2']);

    const hasta = await request(app).get('/api/me/calls?to=2026-08-15').set('Authorization', JOSE());
    expect(ids(hasta.body)).toEqual(['jose_1']);

    const rango = await request(app)
      .get('/api/me/calls?from=2026-08-01&to=2026-08-31')
      .set('Authorization', JOSE());
    expect(ids(rango.body)).toEqual(['jose_1', 'jose_2']);
  });

  it('LLA-04 filtra por nombre de tarea ignorando acentos y mayusculas, y tambien por id', async () => {
    if (!mysqlUp) return;
    const porNombre = await request(app).get('/api/me/calls?taskName=PAGINA').set('Authorization', JOSE());
    expect(ids(porNombre.body)).toEqual(['jose_1']);

    const porId = await request(app).get('/api/me/calls?taskName=BBB222').set('Authorization', JOSE());
    expect(ids(porId.body)).toEqual(['jose_2']);
  });

  it('LLA-04 includeDeleted=true agrega las anuladas, que por defecto no aparecen', async () => {
    if (!mysqlUp) return;
    const conAnuladas = await request(app).get('/api/me/calls?includeDeleted=true').set('Authorization', JOSE());
    expect(ids(conAnuladas.body)).toEqual(['jose_1', 'jose_2', 'jose_3']);
    expect(conAnuladas.body.calls.find((c: any) => c.id === 'jose_3').deleted).toBe(true);
  });

  it('LLA-04 los filtros se combinan entre si', async () => {
    if (!mysqlUp) return;
    const res = await request(app)
      .get('/api/me/calls?includeDeleted=true&alertType=ATRASO_PLAZO&from=2026-08-15')
      .set('Authorization', JOSE());
    expect(ids(res.body)).toEqual(['jose_3']);
  });

  it('LLA-04 un usuario del panel sin persona vinculada no puede listar (403 not_linked)', async () => {
    if (!mysqlUp) return;
    const res = await request(app).get('/api/me/calls').set('Authorization', bearer('admin', 'boss@x.com'));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('not_linked');
  });
});

describe('LLA-05 (superadmin) listar y filtrar todas las llamadas', () => {
  it('LLA-05 el superadmin ve las llamadas de todas las personas', async () => {
    if (!mysqlUp) return;
    const res = await request(app).get('/api/admin/calls').set('Authorization', SUPER());

    expect(res.status).toBe(200);
    expect(ids(res.body)).toEqual(['jose_1', 'jose_2', 'mel_1']); // la anulada no
  });

  it('LLA-05 filtra por persona', async () => {
    if (!mysqlUp) return;
    const res = await request(app).get('/api/admin/calls?person=Mel').set('Authorization', SUPER());
    expect(ids(res.body)).toEqual(['mel_1']);
  });

  it('LLA-05 filtra por tipo, estado, fechas y nombre de tarea', async () => {
    if (!mysqlUp) return;
    const porTipo = await request(app).get('/api/admin/calls?alertType=MANUAL').set('Authorization', SUPER());
    expect(ids(porTipo.body)).toEqual(['mel_1']);

    const porEstado = await request(app).get('/api/admin/calls?status=QA').set('Authorization', SUPER());
    expect(ids(porEstado.body)).toEqual(['jose_2']);

    const porFecha = await request(app).get('/api/admin/calls?to=2026-08-15').set('Authorization', SUPER());
    expect(ids(porFecha.body)).toEqual(['jose_1']);

    const porTarea = await request(app).get('/api/admin/calls?taskName=pago').set('Authorization', SUPER());
    expect(ids(porTarea.body)).toEqual(['jose_2']);
  });

  it('LLA-05 includeDeleted=true muestra tambien las anuladas de cualquier persona', async () => {
    if (!mysqlUp) return;
    const res = await request(app).get('/api/admin/calls?includeDeleted=true').set('Authorization', SUPER());
    expect(ids(res.body)).toEqual(['jose_1', 'jose_2', 'jose_3', 'mel_1']);
  });

  it('LLA-05 el detalle de una llamada se consulta por id y responde 404 si no existe', async () => {
    if (!mysqlUp) return;
    const ok = await request(app).get('/api/admin/calls/jose_2').set('Authorization', SUPER());
    expect(ok.status).toBe(200);
    expect(ok.body.call.taskName).toBe('Pago duplicado');

    const noExiste = await request(app).get('/api/admin/calls/no_existe').set('Authorization', SUPER());
    expect(noExiste.status).toBe(404);
    expect(noExiste.body.error).toBe('not_found');
  });

  it('LLA-05 un admin no puede ver el listado global (403)', async () => {
    if (!mysqlUp) return;
    const res = await request(app).get('/api/admin/calls').set('Authorization', MEL());
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('insufficient_role');
  });
});
