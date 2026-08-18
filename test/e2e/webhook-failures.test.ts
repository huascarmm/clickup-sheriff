/**
 * LLA-02 — Registro de log ante una falla del webhook.
 *
 * Todo webhook se dispara por una razon; cuando el flujo NO termina en llamada de
 * atencion, el superadmin tiene que poder enterarse. Aqui se prueban las dos
 * fallas posibles: no poder consultar la tarea a ClickUp (502, no se emite nada)
 * y un error del propio procesamiento (500). Ambas deben dejar rastro en
 * system_errors (detalle tecnico) y en system_logs (panel de salud).
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { RowDataPacket } from 'mysql2/promise';
import { testDb, clearAll, isMysqlUp } from '../helpers.js';
import { CALLS_COLLECTION } from '../../src/services/attention.js';
import { logsOfKind, systemErrors, WEBHOOK_SECRET } from '../support/panel.js';

// ClickUp que falla al consultar la tarea (red caida, token invalido, 404...).
vi.mock('../../src/services/clickup.js', () => ({
  ClickUpService: class {
    async getTask(id: string) {
      throw new Error(`clickup_no_responde:${id}`);
    }
    async setCheckboxField() {}
  }
}));

vi.mock('../../src/services/slack.js', async (orig) => {
  const actual = (await orig()) as any;
  return {
    ...actual,
    SlackService: class {
      async postMessage() {
        return { ok: true, ts: '1.1', error: '' };
      }
      async resolveChannelId() {
        return 'C123';
      }
    }
  };
});

let app: any;
let mysqlUp = true;

beforeAll(async () => {
  mysqlUp = await isMysqlUp();
  if (!mysqlUp) console.warn('\n[SKIP] MySQL no disponible.\n');
  const { createApp } = await import('../../src/app.js');
  app = createApp({
    clickupToken: 'x',
    slackBotToken: 'x',
    webhookSecret: WEBHOOK_SECRET,
    adminEmails: [],
    allowedOrigin: '',
    port: 0
  });
});

beforeEach(async () => {
  if (mysqlUp) await clearAll();
});

async function countCalls(): Promise<number> {
  const [rows] = await testDb().query<RowDataPacket[]>(`SELECT COUNT(*) AS c FROM ${CALLS_COLLECTION}`);
  return Number(rows[0].c);
}

describe('LLA-02 registro de log ante una falla', () => {
  it('LLA-02 si no se puede consultar la tarea a ClickUp responde 502 y NO emite llamada', async () => {
    if (!mysqlUp) return;
    const res = await request(app)
      .post(`/webhooks/clickup?action=attentionCheck&secret=${WEBHOOK_SECRET}`)
      .send({ payload: { id: 'task_caida' } });

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('no_se_pudo_verificar_tarea');
    expect(await countCalls()).toBe(0);
  });

  it('LLA-02 la falla al consultar la tarea queda en system_logs y system_errors', async () => {
    if (!mysqlUp) return;
    await request(app)
      .post(`/webhooks/clickup?action=attentionCheck&secret=${WEBHOOK_SECRET}`)
      .send({ payload: { id: 'task_caida' } });

    const logs = await logsOfKind('fetch_failed');
    expect(logs.length).toBe(1);
    expect(logs[0].severity).toBe('error');
    expect(logs[0].task_id).toBe('task_caida');
    expect(String(logs[0].message)).toContain('clickup_no_responde');

    const errors = await systemErrors();
    expect(errors.length).toBe(1);
    expect(String(errors[0].message)).toContain('clickup_no_responde:task_caida');
  });

  it('LLA-02 un error de procesamiento responde 500 y queda registrado como webhook_error', async () => {
    if (!mysqlUp) return;
    // Sin id de tarea en el payload el handler no puede continuar.
    const res = await request(app)
      .post(`/webhooks/clickup?action=attentionCheck&secret=${WEBHOOK_SECRET}`)
      .send({ payload: {} });

    expect(res.status).toBe(500);
    expect(res.body.ok).toBe(false);

    const logs = await logsOfKind('webhook_error');
    expect(logs.length).toBe(1);
    expect(logs[0].severity).toBe('error');
    expect(logs[0].action).toBe('attentionCheck');
    expect((await systemErrors()).length).toBe(1);
  });
});
