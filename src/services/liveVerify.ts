/**
 * Verificacion en vivo (realista) contra ClickUp y Slack REALES.
 *
 * Objetivo (punto del usuario): en cada despliegue y periodicamente (cronjob),
 * comprobar que la cadena completa funciona de verdad:
 *   1. Crea una tarea de PRUEBA en una lista dedicada de ClickUp, vencida.
 *   2. Ejecuta la evaluacion (misma logica que un webhook real) posteando al
 *      canal de Slack de PRUEBA (no al canal real del equipo).
 *   3. Verifica que se genero la llamada y que Slack respondio ok.
 *   4. LIMPIA todo: borra el mensaje de Slack, la tarea de ClickUp y el registro
 *      en Firestore, para no ensuciar datos reales.
 *
 * Todo con lista y canal DEDICADOS de prueba (configurables en Settings).
 */
import type { Firestore } from 'firebase-admin/firestore';
import type { Settings } from '../domain/types.js';
import { getSettings } from '../config.js';
import { ClickUpService } from './clickup.js';
import { SlackService } from './slack.js';
import { listPeople, makePersonResolver } from './people.js';
import { runAttentionCheck, CALLS_COLLECTION, type AttentionDeps } from './attention.js';
import { logEvent } from './systemLog.js';

export interface LiveVerifyResult {
  ok: boolean;
  steps: Array<{ step: string; ok: boolean; detail?: string }>;
  createdTaskId?: string;
  callId?: string;
  cleanedUp: boolean;
}

export async function runLiveVerification(
  db: Firestore,
  clickup: ClickUpService,
  slack: SlackService
): Promise<LiveVerifyResult> {
  const settings = await getSettings();
  const steps: LiveVerifyResult['steps'] = [];
  const push = (step: string, ok: boolean, detail?: string) => steps.push({ step, ok, detail });

  const listId = settings.testClickupListId;
  const testChannel = settings.testSlackChannelId;
  if (!listId || !testChannel) {
    const msg = 'Falta configurar testClickupListId y/o testSlackChannelId en Settings.';
    await logEvent(db, settings.timezone, { severity: 'warn', kind: 'live_verify_skipped', message: msg });
    return { ok: false, steps: [{ step: 'config', ok: false, detail: msg }], cleanedUp: true };
  }

  let createdTaskId: string | undefined;
  let callId: string | undefined;
  let slackTs = '';
  let cleanedUp = false;

  try {
    // 1) Crear tarea de prueba vencida, asignada a la persona de prueba (si hay).
    const people = await listPeople(db);
    const assignee = people.find((p) => p.person_key === settings.testAssigneePersonKey) || people[0];
    const assigneeIds = assignee && assignee.clickup_user_id ? [Number(assignee.clickup_user_id)] : undefined;
    const overdueMs = Date.now() - 10 * 3600_000;
    const task = await clickup.createTask(listId, {
      name: `[VERIFICACION AUTOMATICA] ${new Date().toISOString()}`,
      due_date: overdueMs,
      assignees: assigneeIds
    });
    createdTaskId = task.id;
    push('crear_tarea_clickup', true, `taskId=${task.id}`);

    // 2) Ejecutar la evaluacion posteando al canal de PRUEBA.
    const resolver = makePersonResolver(people);
    const testSettings: Settings = { ...settings };
    const deps: AttentionDeps = {
      db,
      settings: testSettings,
      people: resolver,
      slack: { channelId: testChannel, post: (ch, text) => slack.postMessage(ch, text) }
    };
    // Traemos la tarea fresca (igual que el webhook real) y evaluamos.
    const fresh = await clickup.getTask(task.id);
    const result = await runAttentionCheck(fresh, deps);

    if ('raised' in result && result.raised) {
      callId = result.call.id;
      slackTs = result.call.slackTs;
      push('generar_llamada', true, `callId=${callId}`);
      push('post_slack', result.call.slackOk, result.call.slackError || 'ok');
    } else {
      const kind = 'ignored' in result ? 'ignored' : 'noAlert' in result ? 'noAlert' : 'alreadyLogged' in result ? 'alreadyLogged' : 'unknown';
      push('generar_llamada', false, `resultado inesperado: ${kind}`);
    }
  } catch (err) {
    push('ejecucion', false, (err as Error).message);
  } finally {
    // 4) Limpieza (siempre): Slack -> ClickUp -> Firestore.
    try {
      if (slackTs) await slack.deleteMessage(testChannel, slackTs);
      if (callId) await db.collection(CALLS_COLLECTION).doc(callId).delete();
      if (createdTaskId) await clickup.deleteTask(createdTaskId);
      cleanedUp = true;
      push('limpieza', true);
    } catch (cleanupErr) {
      push('limpieza', false, (cleanupErr as Error).message);
    }
  }

  const ok = steps.every((s) => s.ok);
  await logEvent(db, settings.timezone, {
    severity: ok ? 'info' : 'error',
    kind: 'live_verify',
    message: ok ? 'Verificacion en vivo OK' : 'Verificacion en vivo FALLO',
    context: { steps }
  });

  return { ok, steps, createdTaskId, callId, cleanedUp };
}
