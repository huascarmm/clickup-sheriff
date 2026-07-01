/**
 * Rate limit simple en memoria (suficiente para el volumen de webhooks de
 * ClickUp). Patron tomado de socio-funnel: poda periodica del Map.
 */
import type { Request, Response, NextFunction } from 'express';

const RL_WIN = 60_000;
const RL_MAX = 120; // los 3 batches de ClickUp pueden traer muchas tareas juntas

const hits = new Map<string, { c: number; t: number }>();

setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of hits) if (now - rec.t > RL_WIN) hits.delete(ip);
}, RL_WIN).unref();

export function rateLimit(req: Request, res: Response, next: NextFunction) {
  const ip = String(req.headers['x-forwarded-for'] || req.ip || 'x').split(',')[0].trim();
  const now = Date.now();
  const rec = hits.get(ip) || { c: 0, t: now };
  if (now - rec.t > RL_WIN) {
    rec.c = 0;
    rec.t = now;
  }
  rec.c++;
  hits.set(ip, rec);
  if (rec.c > RL_MAX) return res.status(429).json({ ok: false, error: 'rate_limited' });
  next();
}
