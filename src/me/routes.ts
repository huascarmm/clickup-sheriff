/**
 * API de auto-servicio para un ADMIN (miembro del equipo).
 * Todo queda acotado a SUS propias llamadas de atencion, resueltas por el correo
 * de Google con el que inicio sesion (= persona en la tabla people).
 *
 *   GET  /api/me/profile          quien soy + mi persona
 *   GET  /api/me/calls            mis llamadas (con filtros)
 *   GET  /api/me/stats            mis estadisticas del periodo
 *   GET  /api/me/claims           mis reclamos y su estado
 *   POST /api/me/claims           solicitar anulacion de UNA de mis llamadas
 */
import { Router, type Request, type Response } from 'express';
import { db } from '../firebase.js';
import { getSettings } from '../config.js';
import { requireRole } from '../middleware/auth.js';
import { getPersonByLoginEmail } from '../services/people.js';
import { CALLS_COLLECTION } from '../services/attention.js';
import { createClaim, listClaims } from '../services/claims.js';
import { personStats } from '../services/stats.js';
import { getPeriodKey } from '../domain/time.js';
import { normalize } from '../domain/clickupTask.js';
import type { AttentionCall, Person } from '../domain/types.js';

async function resolveSelf(req: Request): Promise<Person | null> {
  const email = req.user?.email || '';
  return getPersonByLoginEmail(db(), email);
}

function applyCallFilters(calls: AttentionCall[], q: Record<string, string>): AttentionCall[] {
  let out = calls;
  if (q.includeDeleted !== 'true') out = out.filter((c) => !c.deleted);
  if (q.alertType) out = out.filter((c) => c.alertType === q.alertType);
  if (q.status) out = out.filter((c) => normalize(c.currentStatus) === normalize(q.status));
  if (q.from) out = out.filter((c) => c.dateKey >= q.from);
  if (q.to) out = out.filter((c) => c.dateKey <= q.to);
  if (q.taskName) {
    const needle = normalize(q.taskName);
    out = out.filter((c) => normalize(c.taskName).includes(needle) || c.taskId.includes(q.taskName));
  }
  return out;
}

export function makeMeRouter(): Router {
  const router = Router();

  router.get('/profile', requireRole('admin'), async (req: Request, res: Response) => {
    const person = await resolveSelf(req);
    res.json({ ok: true, user: req.user, person, linked: !!person });
  });

  router.get('/calls', requireRole('admin'), async (req: Request, res: Response) => {
    const person = await resolveSelf(req);
    if (!person) return res.status(403).json({ ok: false, error: 'not_linked' });
    const snap = await db()
      .collection(CALLS_COLLECTION)
      .where('personKey', '==', person.person_key)
      .orderBy('timestampMs', 'desc')
      .limit(2000)
      .get();
    const calls = applyCallFilters(
      snap.docs.map((d) => d.data() as AttentionCall),
      req.query as Record<string, string>
    );
    res.json({ ok: true, calls });
  });

  router.get('/stats', requireRole('admin'), async (req: Request, res: Response) => {
    const person = await resolveSelf(req);
    if (!person) return res.status(403).json({ ok: false, error: 'not_linked' });
    const settings = await getSettings();
    const periodKey = (req.query.period as string) || getPeriodKey(new Date(), settings.timezone, settings.resetPeriodMonths);
    const stats = await personStats(db(), person.person_key, periodKey);
    res.json({ ok: true, periodKey, resetPeriodMonths: settings.resetPeriodMonths, stats });
  });

  router.get('/claims', requireRole('admin'), async (req: Request, res: Response) => {
    const person = await resolveSelf(req);
    if (!person) return res.status(403).json({ ok: false, error: 'not_linked' });
    const claims = await listClaims(db(), { requesterEmail: req.user!.email });
    res.json({ ok: true, claims });
  });

  router.post('/claims', requireRole('admin'), async (req: Request, res: Response) => {
    const person = await resolveSelf(req);
    if (!person) return res.status(403).json({ ok: false, error: 'not_linked' });
    try {
      const { callId, justification } = req.body || {};
      const claim = await createClaim(db(), {
        callId: String(callId || ''),
        justification: String(justification || ''),
        requester: person,
        requesterEmail: req.user!.email
      });
      res.json({ ok: true, claim });
    } catch (e) {
      res.status(400).json({ ok: false, error: (e as Error).message });
    }
  });

  return router;
}
