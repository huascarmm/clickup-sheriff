/**
 * LLA-17 — Listar los logs del sistema (GET /api/admin/logs).
 *
 * Es el panel de salud del superadmin: todo webhook se dispara por una razon y en
 * la mayoria de casos deberia terminar en llamada de atencion; cuando no, queda
 * un evento aqui. Sirve para ver el estado actual del sistema, asi que solo lo ve
 * el superadmin.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { clearAll, isMysqlUp, testDb } from '../helpers.js';
import { logEvent } from '../../src/services/systemLog.js';
import { bearer, makePanelApp, seedLog, seedPerson, NOW } from '../support/panel.js';

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

  await seedLog({ severity: 'info', kind: 'webhook_raised', message: 'Llamada emitida', timestampMs: NOW });
  await seedLog({ severity: 'warn', kind: 'webhook_no_alert', message: 'No amerito llamada', timestampMs: NOW + 1000 });
  await seedLog({ severity: 'error', kind: 'fetch_failed', message: 'ClickUp no responde', timestampMs: NOW + 2000 });
  await seedLog({ severity: 'error', kind: 'webhook_error', message: 'Fallo el webhook', timestampMs: NOW + 3000 });
});

describe('LLA-17 listar logs del sistema', () => {
  it('LLA-17 el superadmin ve los eventos del mas reciente al mas antiguo', async () => {
    if (!mysqlUp) return;
    const res = await request(app).get('/api/admin/logs').set('Authorization', SUPER());

    expect(res.status).toBe(200);
    expect(res.body.logs.map((l: any) => l.kind)).toEqual([
      'webhook_error',
      'fetch_failed',
      'webhook_no_alert',
      'webhook_raised'
    ]);
    expect(res.body.logs[0].message).toBe('Fallo el webhook');
  });

  it('LLA-17 filtra por severidad', async () => {
    if (!mysqlUp) return;
    const errores = await request(app).get('/api/admin/logs?severity=error').set('Authorization', SUPER());
    expect(errores.body.logs.map((l: any) => l.kind)).toEqual(['webhook_error', 'fetch_failed']);

    const avisos = await request(app).get('/api/admin/logs?severity=warn').set('Authorization', SUPER());
    expect(avisos.body.logs.map((l: any) => l.kind)).toEqual(['webhook_no_alert']);
  });

  it('LLA-17 filtra por tipo de evento', async () => {
    if (!mysqlUp) return;
    const res = await request(app).get('/api/admin/logs?kind=webhook_raised').set('Authorization', SUPER());
    expect(res.body.logs.length).toBe(1);
    expect(res.body.logs[0].message).toBe('Llamada emitida');
  });

  it('LLA-17 un evento recien registrado por el sistema aparece en el listado', async () => {
    if (!mysqlUp) return;
    await logEvent(testDb(), 'America/La_Paz', {
      severity: 'info',
      kind: 'manual_raised',
      message: 'Llamada manual a Jose por boss@x.com',
      action: 'manual_call'
    });

    const res = await request(app).get('/api/admin/logs?kind=manual_raised').set('Authorization', SUPER());
    expect(res.body.logs.length).toBe(1);
    expect(res.body.logs[0].action).toBe('manual_call');
    expect(res.body.logs[0].timestampLocal).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('LLA-17 un admin no puede ver los logs del sistema (403)', async () => {
    if (!mysqlUp) return;
    const res = await request(app).get('/api/admin/logs').set('Authorization', JOSE());
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('insufficient_role');
  });
});
