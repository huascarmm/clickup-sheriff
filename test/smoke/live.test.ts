/**
 * SMOKE TESTS EN VIVO — contra el sistema desplegado real y la base real.
 *
 * No corren por defecto (se saltan si faltan variables). Estan pensados para
 * ejecutarse a mano o en un workflow manual, para verificar que el flujo real
 * funciona de punta a punta contra ClickUp real, Firestore real y Slack real.
 *
 * Variables:
 *   SMOKE_API_URL         URL base del servicio de Cloud Run (sin barra final)
 *   SMOKE_WEBHOOK_SECRET  el WEBHOOK_SECRET real
 *   SMOKE_TASK_ID         id de una tarea real de ClickUp para probar
 *   FIREBASE_PROJECT_ID   proyecto (para leer/limpiar Firestore real vía ADC)
 *   SMOKE_ALLOW_WRITES=1  (opcional) habilita el test que SI escribe y postea a
 *                         Slack de verdad (flujo re-emision tras borrado)
 *
 * Ejecutar:
 *   SMOKE_API_URL=https://...run.app SMOKE_WEBHOOK_SECRET=... \
 *   SMOKE_TASK_ID=86e23vk5a FIREBASE_PROJECT_ID=tu-proyecto \
 *   npm run test:smoke
 *
 * Para incluir el test con escrituras reales (ojo: postea a Slack):
 *   ... SMOKE_ALLOW_WRITES=1 npm run test:smoke
 */
import { describe, it, expect, beforeAll } from 'vitest';

const API = process.env.SMOKE_API_URL || '';
const SECRET = process.env.SMOKE_WEBHOOK_SECRET || '';
const TASK_ID = process.env.SMOKE_TASK_ID || '';
const ALLOW_WRITES = process.env.SMOKE_ALLOW_WRITES === '1';
const DB_ID = process.env.FIRESTORE_DATABASE_ID || 'llamadas-atencion';

const configured = Boolean(API && SECRET && TASK_ID);

function webhookUrl(extra: Record<string, string> = {}): string {
  const q = new URLSearchParams({ action: 'attentionCheck', secret: SECRET, ...extra });
  return `${API}/webhooks/clickup?${q.toString()}`;
}

async function postWebhook(extra: Record<string, string> = {}) {
  const res = await fetch(webhookUrl(extra), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ payload: { id: TASK_ID } })
  });
  const body = await res.json();
  return { status: res.status, body };
}

beforeAll(() => {
  if (!configured) {
    console.warn(
      '\n[SKIP] Smoke tests en vivo. Define SMOKE_API_URL, SMOKE_WEBHOOK_SECRET y SMOKE_TASK_ID para correrlos.\n'
    );
  }
});

describe('smoke en vivo: salud y seguridad', () => {
  it('el servicio responde /health', async () => {
    if (!configured) return;
    const res = await fetch(`${API}/health`);
    const body = await res.json();
    expect(body.ok).toBe(true);
  });

  it('rechaza webhook con secret invalido', async () => {
    if (!configured) return;
    const res = await fetch(webhookUrl({ secret: 'secret-invalido' }), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payload: { id: TASK_ID } })
    });
    expect(res.status).toBe(401);
  });
});

describe('smoke en vivo: verificacion sin efectos (dry-run)', () => {
  // Este test es SEGURO: no escribe en Firestore ni postea a Slack. Verifica el
  // flujo real: fetch de la tarea a ClickUp real + evaluacion de reglas.
  it('dry-run evalua la tarea real y devuelve una decision coherente', async () => {
    if (!configured) return;
    const { status, body } = await postWebhook({ dryRun: '1' });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.dryRun).toBe(true);
    // wouldRaise puede ser true o false segun el estado actual de la tarea.
    expect(typeof body.wouldRaise).toBe('boolean');
    if (body.wouldRaise) {
      expect(['QA_36H', 'FIXING_QA_36H', 'ATRASO_PLAZO']).toContain(body.alertType);
      expect(body.personKey).toBeTruthy();
      expect(body.tolerancePreview).toMatch(/^(SI|NO)\s+\d+\/\d+$/);
    } else {
      // Si no amerita, deberia venir el estado (p.ej. production/to do).
      expect(body.status !== undefined).toBe(true);
    }
  });
});

describe('smoke en vivo: re-emision tras borrado (ESCRIBE de verdad)', () => {
  // Este test SI escribe en Firestore y postea a Slack. Solo corre con
  // SMOKE_ALLOW_WRITES=1. Verifica el bug corregido: una llamada eliminada debe
  // poder re-emitirse el mismo dia si la condicion sigue vigente.
  let admin: typeof import('firebase-admin/firestore') | null = null;
  let dbReal: import('firebase-admin/firestore').Firestore | null = null;

  beforeAll(async () => {
    if (!configured || !ALLOW_WRITES) return;
    // Conexion a Firestore REAL (sin emulador). Requiere ADC.
    delete process.env.FIRESTORE_EMULATOR_HOST;
    const appMod = await import('firebase-admin/app');
    const fsMod = await import('firebase-admin/firestore');
    if (!appMod.getApps().length) {
      appMod.initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID });
    }
    admin = fsMod;
    dbReal = fsMod.getFirestore(DB_ID);
  });

  it('una llamada eliminada se re-emite y se reenvia a Slack', async () => {
    if (!configured || !ALLOW_WRITES || !dbReal || !admin) return;

    // 1) Primera corrida: debe emitir o ya estar registrada.
    const first = await postWebhook();
    expect(first.body.ok).toBe(true);
    const call = first.body.call;
    expect(call?.id).toBeTruthy();
    const docId: string = call.id;

    // 2) Soft-delete directo en la base real.
    await dbReal
      .collection('attention_calls')
      .doc(docId)
      .set({ deleted: true, deletedBy: 'smoke-test', deletedReason: 'prueba automatizada' }, { merge: true });

    // 3) Vuelve a correr el webhook: debe RE-EMITIR (no alreadyLogged).
    const second = await postWebhook();
    expect(second.body.ok).toBe(true);
    expect(second.body.raised).toBe(true);
    expect(second.body.call.deleted).toBe(false);

    // 4) Limpieza: borrado duro del documento de prueba para no ensuciar datos.
    await dbReal.collection('attention_calls').doc(docId).delete();
  });
});
