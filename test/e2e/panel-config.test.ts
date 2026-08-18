/**
 * LLA-16 — Actualizar la configuracion de administrador
 * (GET/PATCH /api/admin/config, fila unica de la tabla settings).
 *
 * Son los parametros de negocio que gobiernan todo el sistema (tolerancia
 * semanal, duracion del periodo, limites de horas, canal de Slack, estados
 * ignorados), asi que el patch se sanea antes de guardarse: un valor fuera de
 * rango no puede dejar el sistema en un estado incoherente.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { RowDataPacket } from 'mysql2/promise';
import { testDb, clearAll, isMysqlUp } from '../helpers.js';
import { DEFAULT_SETTINGS } from '../../src/config.js';
import { bearer, logsOfKind, makePanelApp, seedPerson, systemErrors } from '../support/panel.js';

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
});

function patchConfig(token: string, body: Record<string, unknown>) {
  return request(app).patch('/api/admin/config').set('Authorization', token).send(body);
}

async function settingsRow(): Promise<RowDataPacket | undefined> {
  const [rows] = await testDb().query<RowDataPacket[]>('SELECT * FROM settings WHERE id = 1');
  return rows[0];
}

describe('LLA-16 actualizar configuracion de administrador', () => {
  it('LLA-16 el superadmin guarda la configuracion y queda registrada en la base', async () => {
    if (!mysqlUp) return;
    const res = await patchConfig(SUPER(), {
      overdueWeeklyTolerance: 3,
      resetPeriodMonths: 6,
      qaHoursLimit: 48,
      slackChannelId: 'C999'
    });

    expect(res.status).toBe(200);
    expect(res.body.settings).toMatchObject({
      overdueWeeklyTolerance: 3,
      resetPeriodMonths: 6,
      qaHoursLimit: 48,
      slackChannelId: 'C999'
    });

    const fila = await settingsRow();
    expect(Number(fila!.overdue_weekly_tolerance)).toBe(3);
    expect(Number(fila!.reset_period_months)).toBe(6);
    expect(fila!.updated_by).toBe('boss@x.com');
    expect(fila!.updated_at).toBeTruthy();
  });

  it('LLA-16 GET /config devuelve lo que se acaba de guardar', async () => {
    if (!mysqlUp) return;
    await patchConfig(SUPER(), { overdueWeeklyTolerance: 4, timezone: 'America/Bogota' });

    const res = await request(app).get('/api/admin/config').set('Authorization', SUPER());
    expect(res.status).toBe(200);
    expect(res.body.settings.overdueWeeklyTolerance).toBe(4);
    expect(res.body.settings.timezone).toBe('America/Bogota');
    expect(res.body.settings.updatedBy).toBe('boss@x.com');
  });

  it('LLA-16 el patch es parcial: no pisa el resto de la configuracion', async () => {
    if (!mysqlUp) return;
    await patchConfig(SUPER(), { overdueWeeklyTolerance: 4, slackChannelId: 'C999' });
    const res = await patchConfig(SUPER(), { qaHoursLimit: 24 });

    expect(res.body.settings.qaHoursLimit).toBe(24);
    expect(res.body.settings.overdueWeeklyTolerance).toBe(4); // lo anterior sigue
    expect(res.body.settings.slackChannelId).toBe('C999');
  });

  it('LLA-16 los valores fuera de rango se rechazan y vuelven al valor por defecto', async () => {
    if (!mysqlUp) return;
    const res = await patchConfig(SUPER(), {
      overdueWeeklyTolerance: 500, // max 100
      resetPeriodMonths: 99, // max 12
      qaHoursLimit: 0, // min 1
      plazoHourDefault: 45 // max 23
    });

    expect(res.body.settings.overdueWeeklyTolerance).toBe(DEFAULT_SETTINGS.overdueWeeklyTolerance);
    expect(res.body.settings.resetPeriodMonths).toBe(DEFAULT_SETTINGS.resetPeriodMonths);
    expect(res.body.settings.qaHoursLimit).toBe(DEFAULT_SETTINGS.qaHoursLimit);
    expect(res.body.settings.plazoHourDefault).toBe(DEFAULT_SETTINGS.plazoHourDefault);
  });

  it('LLA-16 normaliza el canal de Slack y la lista de estados ignorados', async () => {
    if (!mysqlUp) return;
    const res = await patchConfig(SUPER(), {
      slackChannelName: '#reglamento-y-qa',
      ignoredStatuses: 'PRODUCTION, Done , closed',
      timezone: '   '
    });

    expect(res.body.settings.slackChannelName).toBe('reglamento-y-qa');
    expect(res.body.settings.ignoredStatuses).toEqual(['production', 'done', 'closed']);
    expect(res.body.settings.timezone).toBe(DEFAULT_SETTINGS.timezone); // vacio -> default
  });

  it('LLA-16 la falla al guardar queda registrada en el panel de salud', async () => {
    if (!mysqlUp) return;
    const res = await patchConfig(SUPER(), { timezone: 'A'.repeat(300) }); // no cabe en la columna

    expect(res.status).toBe(400);
    expect(await settingsRow()).toBeUndefined(); // no se guardo nada

    const logs = await logsOfKind('config_save_failed');
    expect(logs.length).toBe(1);
    expect(logs[0].severity).toBe('error');
    expect(logs[0].action).toBe('save_config');
    expect((await systemErrors()).length).toBe(1);
  });

  it('LLA-16 solo el superadmin puede actualizar la configuracion (403)', async () => {
    if (!mysqlUp) return;
    const res = await patchConfig(JOSE(), { overdueWeeklyTolerance: 5 });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('insufficient_role');
    expect(await settingsRow()).toBeUndefined();
  });
});
