/**
 * API del panel de SUPERADMIN.
 *
 * El superadmin gestiona reclamos, ve la salud del sistema (logs), estadisticas
 * globales, personas y configuracion, y puede lanzar la verificacion en vivo.
 *
 * El cliente nunca toca Firestore directo (las reglas lo bloquean): todo pasa
 * por aqui con firebase-admin.
 */
import { Router, type Request, type Response } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../firebase.js';
import { getSettings, saveSettings } from '../config.js';
import { requireRole } from '../middleware/auth.js';
import { listPeople, upsertPerson, deletePerson } from '../services/people.js';
import { CALLS_COLLECTION } from '../services/attention.js';
import { listClaims, resolveClaim } from '../services/claims.js';
import { listSystemLogs } from '../services/systemLog.js';
import { globalStats } from '../services/stats.js';
import { getPeriodKey } from '../domain/time.js';
import { normalize } from '../domain/clickupTask.js';
import { ClickUpService } from '../services/clickup.js';
import { SlackService } from '../services/slack.js';
import { runLiveVerification } from '../services/liveVerify.js';
import type { AttentionCall, ClaimStatus, LogSeverity } from '../domain/types.js';
import type { Secrets } from '../config.js';

const AUDIT_COLLECTION = 'audit_log';

export function makeAdminRouter(secrets: Secrets): Router {
  const router = Router();

  // --- Quien soy ---
  router.get('/me', requireRole('superadmin'), (req: Request, res: Response) => {
    res.json({ ok: true, user: req.user });
  });

  // --- Llamadas (todas) con filtros ---
  router.get('/calls', requireRole('superadmin'), async (req: Request, res: Response) => {
    try {
      const q = req.query as Record<string, string>;
      let query = db().collection(CALLS_COLLECTION).orderBy('timestampMs', 'desc').limit(3000);
      if (q.person) query = query.where('personKey', '==', q.person) as typeof query;
      const snap = await query.get();
      let calls = snap.docs.map((d) => d.data() as AttentionCall);
      if (q.includeDeleted !== 'true') calls = calls.filter((c) => !c.deleted);
      if (q.alertType) calls = calls.filter((c) => c.alertType === q.alertType);
      if (q.status) calls = calls.filter((c) => normalize(c.currentStatus) === normalize(q.status));
      if (q.from) calls = calls.filter((c) => c.dateKey >= q.from);
      if (q.to) calls = calls.filter((c) => c.dateKey <= q.to);
      if (q.taskName) {
        const needle = normalize(q.taskName);
        calls = calls.filter((c) => normalize(c.taskName).includes(needle) || c.taskId.includes(q.taskName));
      }
      res.json({ ok: true, calls });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  router.get('/calls/:id', requireRole('superadmin'), async (req: Request, res: Response) => {
    const snap = await db().collection(CALLS_COLLECTION).doc(String(req.params.id)).get();
    if (!snap.exists) return res.status(404).json({ ok: false, error: 'not_found' });
    res.json({ ok: true, call: snap.data() });
  });

  // --- Anular manualmente (ademas del flujo de reclamos) ---
  router.delete('/calls/:id', requireRole('superadmin'), async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const reason = String((req.body || {}).reason || '').trim();
      if (!reason) return res.status(400).json({ ok: false, error: 'reason_required' });
      const ref = db().collection(CALLS_COLLECTION).doc(id);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ ok: false, error: 'not_found' });
      const before = snap.data() as AttentionCall;
      await ref.set(
        { deleted: true, deletedBy: req.user!.email, deletedReason: reason, deletedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
      await db().collection(AUDIT_COLLECTION).add({
        action: 'delete_call', callId: id, reason, by: req.user!.email, snapshot: before, at: FieldValue.serverTimestamp()
      });
      res.json({ ok: true, id });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  // --- Reclamos ---
  router.get('/claims', requireRole('superadmin'), async (req: Request, res: Response) => {
    const status = req.query.status as ClaimStatus | undefined;
    const claims = await listClaims(db(), { status });
    res.json({ ok: true, claims });
  });

  router.post('/claims/:id/resolve', requireRole('superadmin'), async (req: Request, res: Response) => {
    try {
      const decision = String((req.body || {}).decision || '');
      const message = String((req.body || {}).message || '');
      if (decision !== 'accepted' && decision !== 'rejected') {
        return res.status(400).json({ ok: false, error: 'invalid_decision' });
      }
      if (!message.trim()) return res.status(400).json({ ok: false, error: 'message_required' });
      const claim = await resolveClaim(db(), {
        claimId: String(req.params.id),
        decision,
        message,
        resolverEmail: req.user!.email
      });
      res.json({ ok: true, claim });
    } catch (e) {
      res.status(400).json({ ok: false, error: (e as Error).message });
    }
  });

  // --- Estadisticas globales del periodo ---
  router.get('/stats', requireRole('superadmin'), async (req: Request, res: Response) => {
    const settings = await getSettings();
    const periodKey = (req.query.period as string) || getPeriodKey(new Date(), settings.timezone, settings.resetPeriodMonths);
    const stats = await globalStats(db(), periodKey);
    res.json({ ok: true, periodKey, resetPeriodMonths: settings.resetPeriodMonths, stats });
  });

  // --- Salud del sistema (logs) ---
  router.get('/logs', requireRole('superadmin'), async (req: Request, res: Response) => {
    const severity = req.query.severity as LogSeverity | undefined;
    const kind = req.query.kind as string | undefined;
    const logs = await listSystemLogs(db(), { severity, kind, limit: 500 });
    res.json({ ok: true, logs });
  });

  // --- Auditoria ---
  router.get('/audit', requireRole('superadmin'), async (_req: Request, res: Response) => {
    const snap = await db().collection(AUDIT_COLLECTION).orderBy('at', 'desc').limit(1000).get();
    res.json({ ok: true, entries: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
  });

  // --- Personas ---
  router.get('/people', requireRole('superadmin'), async (_req: Request, res: Response) => {
    res.json({ ok: true, people: await listPeople(db()) });
  });

  router.put('/people/:key', requireRole('superadmin'), async (req: Request, res: Response) => {
    try {
      const person = await upsertPerson(db(), { ...(req.body || {}), person_key: String(req.params.key) });
      res.json({ ok: true, person });
    } catch (e) {
      res.status(400).json({ ok: false, error: (e as Error).message });
    }
  });

  router.delete('/people/:key', requireRole('superadmin'), async (req: Request, res: Response) => {
    await deletePerson(db(), String(req.params.key));
    res.json({ ok: true, key: req.params.key });
  });

  // --- Configuracion ---
  router.get('/config', requireRole('superadmin'), async (_req: Request, res: Response) => {
    res.json({ ok: true, settings: await getSettings() });
  });

  router.patch('/config', requireRole('superadmin'), async (req: Request, res: Response) => {
    try {
      const settings = await saveSettings(req.body || {}, req.user!.email);
      res.json({ ok: true, settings });
    } catch (e) {
      res.status(400).json({ ok: false, error: (e as Error).message });
    }
  });

  // --- Verificacion en vivo (manual desde el panel) ---
  router.post('/live-verify', requireRole('superadmin'), async (_req: Request, res: Response) => {
    try {
      const clickup = new ClickUpService(secrets.clickupToken);
      const slack = new SlackService(secrets.slackBotToken);
      const result = await runLiveVerification(db(), clickup, slack);
      res.json({ ok: result.ok, result });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  return router;
}
