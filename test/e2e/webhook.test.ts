/**
 * Test end-to-end: golpea el endpoint HTTP real (via supertest) con un payload
 * de webhook de ClickUp y verifica que:
 *   - rechaza secret invalido,
 *   - crea la fila en MySQL,
 *   - es idempotente a nivel HTTP.
 *
 * Mockeamos la red saliente (ClickUp y Slack) con vi.mock para no depender de
 * servicios externos. Requiere MySQL (ver test/helpers.ts).
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { RowDataPacket } from 'mysql2/promise';
import { testDb, clearAll, isMysqlUp } from '../helpers.js';
import { CALLS_COLLECTION } from '../../src/services/attention.js';
import { saveSettings } from '../../src/config.js';

// Mock de ClickUpService: devuelve el estado ACTUAL de la tarea segun su id,
// para simular que el estado real puede diferir del que traeria el webhook.
vi.mock('../../src/services/clickup.js', () => {
  const H = 3600_000;
  return {
    ClickUpService: class {
      async getTask(id: string) {
        // Una tarea que "ya paso a PRODUCTION" cuando llega el webhook.
        if (id.startsWith('prod_')) {
          return {
            id,
            name: 'Tarea ya en produccion',
            status: { status: 'PRODUCTION' },
            due_date: Date.now() - 100 * H,
            assignees: [{ username: 'Jose' }],
            custom_fields: []
          };
        }
        // Tarea vencida en ejecucion (caso normal que si alerta).
        return {
          id,
          name: 'Tarea E2E',
          status: { status: 'doing' },
          due_date: Date.now() - 10 * H,
          assignees: [{ username: 'Jose' }],
          custom_fields: []
        };
      }
      async setCheckboxField() {}
    }
  };
});

// Mock de SlackService: no envia nada real.
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

const SECRET = 'test-secret';

beforeAll(async () => {
  mysqlUp = await isMysqlUp();
  if (!mysqlUp) {
    console.warn('\n[SKIP] MySQL no disponible.\n');
  }
  const { createApp } = await import('../../src/app.js');
  app = createApp({
    clickupToken: 'x',
    slackBotToken: 'x',
    webhookSecret: SECRET,
    adminEmails: [],
    allowedOrigin: '',
    port: 0
  });
});

beforeEach(async () => {
  if (!mysqlUp) return;
  await clearAll();
  // Sembramos una persona para que resuelva a "Jose".
  await testDb().query(
    `INSERT INTO people (person_key, nombre_visible, qa_string, clickup_username, slack_user_id, activo)
     VALUES (?, ?, ?, ?, ?, ?)`,
    ['Jose', 'Jose', 'Jose', 'Jose', 'UJOSE', true]
  );
  await saveSettings({ slackChannelId: 'C123' }, 'test');
});

describe('e2e webhook', () => {
  it('rechaza secret invalido con 401', async () => {
    const res = await request(app)
      .post('/webhooks/clickup?action=attentionCheck&secret=malo')
      .send({ payload: { id: '86e1f5cnb' } });
    expect(res.status).toBe(401);
  });

  it('acepta el secret por header X-Webhook-Secret (metodo recomendado)', async () => {
    if (!mysqlUp) return;
    const res = await request(app)
      .post('/webhooks/clickup?action=attentionCheck')
      .set('X-Webhook-Secret', SECRET)
      .send({ payload: { id: '86e1f5cnb_hdr' } });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('procesa un webhook valido y crea la llamada', async () => {
    if (!mysqlUp) return;
    const res = await request(app)
      .post(`/webhooks/clickup?action=attentionCheck&secret=${SECRET}`)
      .send({ payload: { id: '86e1f5cnb' } });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const [rows] = await testDb().query<RowDataPacket[]>(`SELECT * FROM ${CALLS_COLLECTION}`);
    expect(rows.length).toBe(1);
    expect(rows[0].alert_type).toBe('ATRASO_PLAZO');
    expect(rows[0].person_key).toBe('Jose');
  });

  it('es idempotente: dos webhooks iguales = una llamada', async () => {
    if (!mysqlUp) return;
    await request(app).post(`/webhooks/clickup?action=attentionCheck&secret=${SECRET}`).send({ payload: { id: '86e1f5cnb' } });
    const res2 = await request(app).post(`/webhooks/clickup?action=attentionCheck&secret=${SECRET}`).send({ payload: { id: '86e1f5cnb' } });
    expect(res2.body.alreadyLogged).toBe(true);

    const [rows] = await testDb().query<RowDataPacket[]>(`SELECT * FROM ${CALLS_COLLECTION}`);
    expect(rows.length).toBe(1);
  });

  it('NO emite llamada si la tarea ya paso a PRODUCTION (verifica estado fresco)', async () => {
    if (!mysqlUp) return;
    // El webhook dice "attentionCheck", pero al consultar ClickUp la tarea ya
    // esta en PRODUCTION. No debe crearse ninguna llamada de atencion.
    const res = await request(app)
      .post(`/webhooks/clickup?action=attentionCheck&secret=${SECRET}`)
      .send({ payload: { id: 'prod_86e1f5cnb', status: { status: 'QA' } } });
    expect(res.status).toBe(200);
    expect(res.body.ignored).toBe(true);

    const [rows] = await testDb().query<RowDataPacket[]>(`SELECT * FROM ${CALLS_COLLECTION}`);
    expect(rows.length).toBe(0);
  });

  it('health responde ok', async () => {
    const res = await request(app).get('/health');
    expect(res.body).toEqual({ ok: true });
  });

  it('la API admin exige token', async () => {
    const res = await request(app).get('/api/admin/calls');
    expect(res.status).toBe(401);
  });
});
