/**
 * Endpoints de webhook para ClickUp.
 *
 *   POST /webhooks/clickup?action=attentionCheck   -> llamada de atencion
 *   POST /webhooks/clickup                         -> validateDueTime (default)
 *
 * Autenticacion del webhook: header "X-Webhook-Secret" (recomendado) o
 * parametro ?secret= en la URL (compatibilidad con configuraciones previas).
 */
import { Router, type Request, type Response } from 'express';
import { db } from '../firebase.js';
import { getSettings, type Secrets } from '../config.js';
import { logger } from '../logger.js';
import { ClickUpService } from '../services/clickup.js';
import { SlackService } from '../services/slack.js';
import { listPeople, makePersonResolver } from '../services/people.js';
import { runAttentionCheck, previewAttention, logSystemError, type AttentionDeps } from '../services/attention.js';
import { validateDueTime, extractTaskId } from '../services/validateDueTime.js';
import type { ClickUpTask } from '../domain/types.js';

export function makeWebhookRouter(secrets: Secrets): Router {
  const router = Router();
  const clickup = new ClickUpService(secrets.clickupToken);
  const slack = new SlackService(secrets.slackBotToken);

  router.post('/clickup', async (req: Request, res: Response) => {
    const action = (req.query.action as string) || 'validateDueTime';
    // El secret puede llegar por header (recomendado: ClickUp guarda los headers
    // como sensibles y no se pueden volver a ver una vez configurados) o por el
    // parametro ?secret= de la URL (compatibilidad con configuraciones previas).
    const headerSecret = (req.headers['x-webhook-secret'] as string) || '';
    const receivedSecret = headerSecret || (req.query.secret as string) || '';

    if (receivedSecret !== secrets.webhookSecret) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    try {
      if (action === 'attentionCheck') {
        return await handleAttentionCheck(req, res, { clickup, slack });
      }
      return await handleValidateDueTime(req, res, { clickup });
    } catch (err) {
      const e = err as Error;
      logger.error('webhook_error', { action, message: e.message });
      await logSystemError(db(), e, { action, query: req.query });
      return res.status(500).json({ ok: false, error: e.message });
    }
  });

  return router;
}

async function handleAttentionCheck(
  req: Request,
  res: Response,
  svc: { clickup: ClickUpService; slack: SlackService }
) {
  const settings = await getSettings();
  const body = (req.body || {}) as Record<string, any>;
  const ctx = buildTaskContextFromWebhook(req, body);

  if (!ctx.taskId) throw new Error('No se pudo extraer el ID de la tarea desde el webhook.');

  // IMPORTANTE: el webhook se usa SOLO como disparador (nos da el task_id).
  // Nunca confiamos en el estado/campos que trae el webhook, porque ClickUp
  // puede mandarlo con retraso, reintentarlo, o dispararlo cuando la tarea ya
  // cambio de estado (p.ej. ya paso a PRODUCTION). Siempre consultamos el
  // estado ACTUAL de la tarea a ClickUp y evaluamos las reglas contra eso.
  let task: ClickUpTask;
  try {
    task = await svc.clickup.getTask(ctx.taskId);
  } catch (err) {
    // Si no podemos confirmar el estado actual, NO emitimos: mejor no alertar
    // que emitir una llamada de atencion sobre datos sin verificar.
    const e = err as Error;
    logger.warn('attention_skip_fetch_failed', { taskId: ctx.taskId, message: e.message });
    await logSystemError(db(), e, { stage: 'getTask', taskId: ctx.taskId });
    return res.status(502).json({ ok: false, error: 'no_se_pudo_verificar_tarea', taskId: ctx.taskId });
  }

  const people = await listPeople(db());
  const resolver = makePersonResolver(people);

  let channelId = settings.slackChannelId;
  if (!channelId && settings.slackChannelName) {
    channelId = await svc.slack.resolveChannelId(settings.slackChannelName);
  }

  const deps: AttentionDeps = {
    db: db(),
    settings,
    people: resolver,
    slack: { channelId, post: (ch, text) => svc.slack.postMessage(ch, text) }
  };

  // Modo verificacion: evalua contra datos reales sin escribir ni postear.
  if (req.query.dryRun === '1' || req.query.dryRun === 'true') {
    const preview = await previewAttention(task, deps);
    return res.json(preview);
  }

  const result = await runAttentionCheck(task, deps);
  return res.json(result);
}

async function handleValidateDueTime(req: Request, res: Response, svc: { clickup: ClickUpService }) {
  const settings = await getSettings();
  const body = (req.body || {}) as Record<string, any>;
  // ClickUp envia el id de la tarea en el body JSON (payload.id, confirmado en
  // developer.clickup.com/docs/automationwebhookpayload). Como respaldo, tambien
  // aceptamos ?task_id= por si la automatizacion se configura para mandarlo por
  // URL (igual que attentionCheck), para no depender de una sola fuente.
  const q = req.query as Record<string, string>;
  const taskId = q.task_id || extractTaskId(body);
  if (!taskId) throw new Error('No se pudo extraer el ID de la tarea desde el webhook.');

  const task = await svc.clickup.getTask(taskId);
  const result = await validateDueTime(task, settings, svc.clickup);
  return res.json(result);
}

// --- Helpers para construir la tarea desde el webhook (portados del original) ---

interface TaskContext {
  taskId: string | null;
  taskName: string;
  taskUrl: string;
  statusName: string;
  assigneesText: string;
  dueDateMs: number | null;
  qaString: string;
  timeStatusChangeMs: number | null;
}

function buildTaskContextFromWebhook(req: Request, body: Record<string, any>): TaskContext {
  const q = req.query as Record<string, string>;
  const payload = body.payload || {};
  const timeMgmt = payload.time_mgmt || {};

  return {
    taskId: q.task_id || payload.id || body.task_id || body.id || null,
    taskName: q.task_name || payload.name || '',
    taskUrl: q.task_link || payload.url || '',
    statusName: q.status_name || getPayloadStatusName(payload) || '',
    assigneesText: q.assignees || '',
    dueDateMs: parseClickUpDateValue(timeMgmt.due_date || q.due_date_ms || q.due_date_text || ''),
    qaString: q.qa_string || q.qa || '',
    timeStatusChangeMs: parseClickUpDateValue(q.time_status_change || q.status_change || '')
  };
}

function getPayloadStatusName(payload: any): string {
  if (!payload) return '';
  if (typeof payload.status === 'string') return payload.status;
  if (payload.status && payload.status.status) return payload.status.status;
  if (payload.status_name) return payload.status_name;
  return '';
}

function parseClickUpDateValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const text = String(value).trim();
  if (/^\d{12,}$/.test(text)) return Number(text);
  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) return parsed.getTime();
  return null;
}
