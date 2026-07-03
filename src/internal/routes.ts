/**
 * Rutas internas, protegidas por el WEBHOOK_SECRET (no por login).
 * Pensadas para que Cloud Scheduler las invoque periodicamente.
 *
 *   POST /internal/live-verify?secret=...   verificacion en vivo (diaria)
 */
import { Router, type Request, type Response } from 'express';
import { db } from '../firebase.js';
import type { Secrets } from '../config.js';
import { ClickUpService } from '../services/clickup.js';
import { SlackService } from '../services/slack.js';
import { runLiveVerification } from '../services/liveVerify.js';
import { logger } from '../logger.js';

export function makeInternalRouter(secrets: Secrets): Router {
  const router = Router();

  router.post('/live-verify', async (req: Request, res: Response) => {
    const headerSecret = (req.headers['x-webhook-secret'] as string) || '';
    const received = headerSecret || (req.query.secret as string) || '';
    if (received !== secrets.webhookSecret) {
      return res.status(401).json({ ok: false, error: 'Unauthorized' });
    }
    try {
      const clickup = new ClickUpService(secrets.clickupToken);
      const slack = new SlackService(secrets.slackBotToken);
      const result = await runLiveVerification(db(), clickup, slack);
      logger.info('live_verify_cron', { ok: result.ok });
      return res.status(result.ok ? 200 : 500).json({ ok: result.ok, result });
    } catch (e) {
      return res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  return router;
}
