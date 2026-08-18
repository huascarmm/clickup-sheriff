/**
 * LLA-12 y LLA-13 — Estadisticas del periodo.
 *
 *   LLA-12  GET /api/me/stats     el admin ve SOLO las suyas
 *   LLA-13  GET /api/admin/stats  el superadmin ve el total y el desglose por persona
 *
 * El contador que importa es formalCalls: llamadas formales vigentes del periodo
 * (las tolerancias y las anuladas no cuentan). El calculo puro esta cubierto en
 * test/unit/stats.test.ts; aqui se prueba contra la base y a traves de la API.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { clearAll, isMysqlUp } from '../helpers.js';
import { getPeriodKey } from '../../src/domain/time.js';
import { DEFAULT_SETTINGS } from '../../src/config.js';
import { bearer, makePanelApp, seedCall, seedPerson, PERIOD } from '../support/panel.js';

vi.mock('../../src/firebase.js', () => import('../support/firebaseMock.js'));

let app: any;
let mysqlUp = true;

const OTRO_PERIODO = '2026_P2';

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
  await seedPerson({ person_key: 'Mel', login_email: 'mel@x.com' });

  // Jose en el periodo vigente: 2 tolerancias, 2 formales (una QA_36H) y 1 anulada.
  await seedCall({ id: 'j_tol_1', personKey: 'Jose', isTolerance: true });
  await seedCall({ id: 'j_tol_2', personKey: 'Jose', isTolerance: true });
  await seedCall({ id: 'j_for_1', personKey: 'Jose', alertType: 'ATRASO_PLAZO' });
  await seedCall({ id: 'j_for_2', personKey: 'Jose', alertType: 'QA_36H' });
  await seedCall({ id: 'j_anulada', personKey: 'Jose', alertType: 'ATRASO_PLAZO', deleted: true });
  // Jose en el periodo anterior: no debe mezclarse.
  await seedCall({ id: 'j_viejo', personKey: 'Jose', periodKey: OTRO_PERIODO });
  // Mel en el periodo vigente.
  await seedCall({ id: 'm_for_1', personKey: 'Mel', alertType: 'MANUAL' });
});

describe('LLA-12 (admin) ver mis estadisticas', () => {
  it('LLA-12 el conteo del periodo coincide con las llamadas de la persona', async () => {
    if (!mysqlUp) return;
    const res = await request(app).get(`/api/me/stats?period=${PERIOD}`).set('Authorization', JOSE());

    expect(res.status).toBe(200);
    expect(res.body.periodKey).toBe(PERIOD);
    expect(res.body.stats).toMatchObject({
      totalAlerts: 5,
      tolerances: 2,
      formalCalls: 2, // el numero critico: las anuladas y las tolerancias no cuentan
      annulled: 1
    });
    expect(res.body.stats.formalByReason).toMatchObject({ ATRASO_PLAZO: 1, QA_36H: 1, MANUAL: 0 });
  });

  it('LLA-12 las estadisticas no incluyen las llamadas de otras personas', async () => {
    if (!mysqlUp) return;
    const res = await request(app).get(`/api/me/stats?period=${PERIOD}`).set('Authorization', JOSE());
    // La formal MANUAL de Mel quedaria fuera del desglose de Jose.
    expect(res.body.stats.formalByReason.MANUAL).toBe(0);
    expect(res.body.stats.totalAlerts).toBe(5);
  });

  it('LLA-12 el parametro period acota el periodo consultado', async () => {
    if (!mysqlUp) return;
    const anterior = await request(app).get(`/api/me/stats?period=${OTRO_PERIODO}`).set('Authorization', JOSE());
    expect(anterior.body.periodKey).toBe(OTRO_PERIODO);
    expect(anterior.body.stats.totalAlerts).toBe(1);
    expect(anterior.body.stats.formalCalls).toBe(1);
  });

  it('LLA-12 sin parametro usa el periodo vigente segun la configuracion', async () => {
    if (!mysqlUp) return;
    const res = await request(app).get('/api/me/stats').set('Authorization', JOSE());
    const esperado = getPeriodKey(new Date(), DEFAULT_SETTINGS.timezone, DEFAULT_SETTINGS.resetPeriodMonths);
    expect(res.body.periodKey).toBe(esperado);
    expect(res.body.resetPeriodMonths).toBe(DEFAULT_SETTINGS.resetPeriodMonths);
  });

  it('LLA-12 un usuario sin persona vinculada no puede ver estadisticas (403 not_linked)', async () => {
    if (!mysqlUp) return;
    const res = await request(app).get('/api/me/stats').set('Authorization', bearer('admin', 'boss@x.com'));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('not_linked');
  });
});

describe('LLA-13 (superadmin) ver las estadisticas de todos', () => {
  it('LLA-13 el total global incluye las llamadas de todas las personas', async () => {
    if (!mysqlUp) return;
    const res = await request(app).get(`/api/admin/stats?period=${PERIOD}`).set('Authorization', SUPER());

    expect(res.status).toBe(200);
    expect(res.body.periodKey).toBe(PERIOD);
    expect(res.body.stats).toMatchObject({
      totalAlerts: 6, // 5 de Jose + 1 de Mel
      tolerances: 2,
      formalCalls: 3,
      annulled: 1
    });
    expect(res.body.stats.formalByReason).toMatchObject({ ATRASO_PLAZO: 1, QA_36H: 1, MANUAL: 1 });
  });

  it('LLA-13 el desglose por persona trae a cada una con su propio conteo', async () => {
    if (!mysqlUp) return;
    const res = await request(app).get(`/api/admin/stats?period=${PERIOD}`).set('Authorization', SUPER());

    expect(Object.keys(res.body.stats.byPerson).sort()).toEqual(['Jose', 'Mel']);
    expect(res.body.stats.byPerson.Jose).toMatchObject({ formalCalls: 2, tolerances: 2, annulled: 1 });
    expect(res.body.stats.byPerson.Mel).toMatchObject({ formalCalls: 1, tolerances: 0, annulled: 0 });
  });

  it('LLA-13 el total global coincide con la suma del desglose por persona', async () => {
    if (!mysqlUp) return;
    const res = await request(app).get(`/api/admin/stats?period=${PERIOD}`).set('Authorization', SUPER());
    const personas = Object.values(res.body.stats.byPerson) as any[];

    const suma = (campo: string) => personas.reduce((acc, p) => acc + p[campo], 0);
    expect(suma('totalAlerts')).toBe(res.body.stats.totalAlerts);
    expect(suma('formalCalls')).toBe(res.body.stats.formalCalls);
    expect(suma('tolerances')).toBe(res.body.stats.tolerances);
    expect(suma('annulled')).toBe(res.body.stats.annulled);
  });

  it('LLA-13 el parametro period acota el periodo consultado', async () => {
    if (!mysqlUp) return;
    const res = await request(app).get(`/api/admin/stats?period=${OTRO_PERIODO}`).set('Authorization', SUPER());
    expect(res.body.stats.totalAlerts).toBe(1);
    expect(Object.keys(res.body.stats.byPerson)).toEqual(['Jose']);
  });

  it('LLA-13 un admin no puede ver las estadisticas globales (403)', async () => {
    if (!mysqlUp) return;
    const res = await request(app).get('/api/admin/stats').set('Authorization', JOSE());
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('insufficient_role');
  });
});
