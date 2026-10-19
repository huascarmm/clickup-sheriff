/**
 * Webhook de metas por proyecto (Panel de revisor).
 *
 *   POST /webhooks/goals   -> reemplaza la lista completa de proyectos y metas
 *
 * Misma autenticacion que el webhook de ClickUp (X-Webhook-Secret o ?secret=)
 * y mismo rate limit (se monta bajo /webhooks en app.ts). El formato del body
 * esta documentado en src/domain/goals.ts.
 */
import { Router, type Request, type Response } from 'express';
import { pool } from '../db.js';
import { getSettings, type Secrets } from '../config.js';
import { logger } from '../logger.js';
import { parseGoalsPayload } from '../domain/goals.js';
import { replaceGoals } from '../services/goals.js';
import { logSystemError } from '../services/attention.js';
import { logEvent } from '../services/systemLog.js';
import { hasValidWebhookSecret } from './secret.js';

export function makeGoalsWebhookRouter(secrets: Secrets): Router {
  const router = Router();

  router.post('/goals', async (req: Request, res: Response) => {
    if (!hasValidWebhookSecret(req, secrets.webhookSecret)) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }

    const parsed = parseGoalsPayload(req.body);
    if (!parsed.ok) {
      await logEvent(pool(), 'America/La_Paz', {
        severity: 'warn',
        kind: 'goals_rejected',
        message: `Webhook de metas rechazado: ${parsed.error}`,
        action: 'goals'
      });
      return res.status(400).json({ ok: false, error: 'invalid_payload', detail: parsed.error });
    }

    try {
      const saved = await replaceGoals(parsed.projects, Date.now());
      const settings = await getSettings();
      await logEvent(pool(), settings.timezone, {
        severity: 'info',
        kind: 'goals_received',
        message: `Metas actualizadas: ${saved.projects} proyectos, ${saved.goals} metas`,
        action: 'goals'
      });
      return res.json({ ok: true, ...saved });
    } catch (err) {
      const e = err as Error;
      logger.error('goals_webhook_error', { message: e.message });
      await logSystemError(pool(), e, { action: 'goals' });
      await logEvent(pool(), 'America/La_Paz', {
        severity: 'error',
        kind: 'webhook_error',
        message: e.message,
        action: 'goals'
      });
      return res.status(500).json({ ok: false, error: e.message });
    }
  });

  return router;
}
