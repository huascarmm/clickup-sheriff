/**
 * API del Panel de revisor. Abierta a TODOS los roles del panel (admin y
 * superadmin): es informacion del equipo, no de una persona.
 *
 *   GET /api/review/goals   proyectos con sus metas; marca las vencidas
 *
 * "Vencida" se calcula aqui, con la fecha de hoy en settings.timezone, para que
 * todos los navegadores vean lo mismo sin importar su zona horaria.
 */
import { Router, type Request, type Response } from 'express';
import { pool } from '../db.js';
import { getSettings } from '../config.js';
import { requireRole } from '../middleware/auth.js';
import { listGoalProjects } from '../services/goals.js';
import { formatDateKey } from '../domain/time.js';

export function makeReviewRouter(): Router {
  const router = Router();

  router.get('/goals', requireRole('admin'), async (_req: Request, res: Response) => {
    try {
      const settings = await getSettings();
      const todayKey = formatDateKey(new Date(), settings.timezone);
      const snapshot = await listGoalProjects(pool(), todayKey);
      res.json({ ok: true, todayKey, timezone: settings.timezone, ...snapshot });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  return router;
}
