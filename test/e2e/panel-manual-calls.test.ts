/**
 * LLA-03 — Registrar una llamada de atencion manualmente (POST /api/admin/manual-calls).
 *
 * La ruta es exclusiva del superadmin: registra la llamada con el mismo flujo que
 * las automaticas (tolerancia, periodo, Slack), deja auditoria de quien la creo y
 * un evento en el panel de salud. Aqui se prueba la ruta HTTP: proteccion por
 * rol, validaciones, verificacion en la base y registro de log cuando falla.
 *
 * El conteo en si (que cuente como las demas, que se combine con las automaticas
 * y que aguante concurrencia) se prueba en test/integration/attention.test.ts.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { RowDataPacket } from 'mysql2/promise';
import { testDb, clearAll, isMysqlUp } from '../helpers.js';
import { CALLS_COLLECTION } from '../../src/services/attention.js';
import { saveSettings } from '../../src/config.js';
import { auditEntries, bearer, logsOfKind, makePanelApp, seedPerson, systemErrors } from '../support/panel.js';

vi.mock('../../src/firebase.js', () => import('../support/firebaseMock.js'));

// Slack: postear funciona, pero resolver el canal por nombre FALLA. Asi, con
// slackChannelId configurado el flujo va bien y sin el se provoca una falla real
// dentro de la ruta (Slack caido), que es lo que debe quedar registrado.
vi.mock('../../src/services/slack.js', async (orig) => {
  const actual = (await orig()) as any;
  return {
    ...actual,
    SlackService: class {
      async postMessage() {
        return { ok: true, ts: '1.1', error: '' };
      }
      async resolveChannelId() {
        throw new Error('slack_no_responde');
      }
    }
  };
});

let app: any;
let mysqlUp = true;

beforeAll(async () => {
  mysqlUp = await isMysqlUp();
  if (!mysqlUp) console.warn('\n[SKIP] MySQL no disponible.\n');
  app = await makePanelApp();
});

beforeEach(async () => {
  if (!mysqlUp) return;
  await clearAll();
  await seedPerson({ person_key: 'Jose', login_email: 'jose@x.com' });
  await seedPerson({ person_key: 'Mel', login_email: 'mel@x.com', activo: false });
  await saveSettings({ slackChannelId: 'C123' }, 'test');
});

function postManual(token: string, body: Record<string, unknown>) {
  return request(app).post('/api/admin/manual-calls').set('Authorization', token).send(body);
}

describe('LLA-03 llamada de atencion manual: registro por el panel', () => {
  it('LLA-03 el superadmin registra la llamada y queda en la base con su origen y autor', async () => {
    if (!mysqlUp) return;
    const res = await postManual(bearer('superadmin', 'boss@x.com'), {
      personKey: 'Jose',
      reason: 'incumplio el acuerdo del daily',
      comment: 'segunda vez esta semana'
    });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const [rows] = await testDb().query<RowDataPacket[]>(`SELECT * FROM ${CALLS_COLLECTION}`);
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe(res.body.call.id);
    expect(rows[0].person_key).toBe('Jose');
    expect(rows[0].alert_type).toBe('MANUAL');
    expect(rows[0].origin).toBe('manual');
    expect(rows[0].created_by_email).toBe('boss@x.com');
    expect(rows[0].reason).toBe('incumplio el acuerdo del daily');
    expect(rows[0].comment).toBe('segunda vez esta semana');
  });

  it('LLA-03 el registro deja auditoria y evento de salud', async () => {
    if (!mysqlUp) return;
    await postManual(bearer('superadmin', 'boss@x.com'), { personKey: 'Jose', reason: 'llego tarde' });

    const audit = await auditEntries('manual_call');
    expect(audit.length).toBe(1);
    expect(audit[0].by_email).toBe('boss@x.com');
    expect(audit[0].person_key).toBe('Jose');
    expect(audit[0].reason).toBe('llego tarde');

    const logs = await logsOfKind('manual_raised');
    expect(logs.length).toBe(1);
    expect(logs[0].severity).toBe('info');
    expect(String(logs[0].message)).toContain('boss@x.com');
  });

  it('LLA-03 solo el superadmin puede registrar: un admin recibe 403 y no se registra nada', async () => {
    if (!mysqlUp) return;
    const res = await postManual(bearer('admin', 'jose@x.com'), { personKey: 'Jose', reason: 'motivo valido' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('insufficient_role');

    const [rows] = await testDb().query<RowDataPacket[]>(`SELECT * FROM ${CALLS_COLLECTION}`);
    expect(rows.length).toBe(0);
  });

  it('LLA-03 sin rol de Firebase tampoco se puede registrar (403 no_role)', async () => {
    if (!mysqlUp) return;
    const res = await postManual(bearer('none', 'jose@x.com'), { personKey: 'Jose', reason: 'motivo valido' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('no_role');
  });

  it('LLA-03 rechaza datos invalidos: sin persona, razon corta, persona inexistente o inactiva', async () => {
    if (!mysqlUp) return;
    const token = bearer('superadmin', 'boss@x.com');

    const sinPersona = await postManual(token, { reason: 'motivo valido' });
    expect(sinPersona.status).toBe(400);
    expect(sinPersona.body.error).toBe('person_required');

    const razonCorta = await postManual(token, { personKey: 'Jose', reason: 'no' });
    expect(razonCorta.status).toBe(400);
    expect(razonCorta.body.error).toBe('reason_too_short');

    const inexistente = await postManual(token, { personKey: 'Fantasma', reason: 'motivo valido' });
    expect(inexistente.status).toBe(404);
    expect(inexistente.body.error).toBe('person_not_found');

    const inactiva = await postManual(token, { personKey: 'Mel', reason: 'motivo valido' });
    expect(inactiva.status).toBe(400);
    expect(inactiva.body.error).toBe('person_inactive');

    const [rows] = await testDb().query<RowDataPacket[]>(`SELECT * FROM ${CALLS_COLLECTION}`);
    expect(rows.length).toBe(0);
  });

  it('LLA-03 si el registro falla queda log en el panel de salud y en system_errors', async () => {
    if (!mysqlUp) return;
    // Sin canal configurado hay que resolverlo por nombre contra Slack, que falla.
    await saveSettings({ slackChannelId: '' }, 'test');

    const res = await postManual(bearer('superadmin', 'boss@x.com'), { personKey: 'Jose', reason: 'motivo valido' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('slack_no_responde');

    const logs = await logsOfKind('manual_failed');
    expect(logs.length).toBe(1);
    expect(logs[0].severity).toBe('error');
    expect(logs[0].action).toBe('manual_call');

    const errors = await systemErrors();
    expect(errors.length).toBe(1);
    expect(String(errors[0].message)).toContain('slack_no_responde');
  });
});
