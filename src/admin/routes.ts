/**
 * API del panel de SUPERADMIN.
 *
 * El superadmin gestiona reclamos, ve la salud del sistema (logs), estadisticas
 * globales, personas y configuracion, y puede lanzar la verificacion en vivo.
 *
 * El cliente nunca toca MySQL directo: todo pasa por aqui.
 */
import { Router, type Request, type Response } from 'express';
import type { RowDataPacket } from 'mysql2/promise';
import { pool } from '../db.js';
import { getSettings, saveSettings } from '../config.js';
import { requireRole } from '../middleware/auth.js';
import { listPeople, upsertPerson, deletePerson, makePersonResolver } from '../services/people.js';
import { CALLS_COLLECTION, raiseManualAttention, rowToAttentionCall, type AttentionCallRow } from '../services/attention.js';
import { listClaims, resolveClaim } from '../services/claims.js';
import { listSystemLogs, logEvent, logRouteFailure } from '../services/systemLog.js';
import { globalStats } from '../services/stats.js';
import { getPeriodKey } from '../domain/time.js';
import { normalize } from '../domain/clickupTask.js';
import { ClickUpService } from '../services/clickup.js';
import { SlackService } from '../services/slack.js';
import { runLiveVerification } from '../services/liveVerify.js';
import type { ClaimStatus, LogSeverity } from '../domain/types.js';
import type { Secrets } from '../config.js';

const AUDIT_COLLECTION = 'audit_log';

function rowToAuditEntry(row: RowDataPacket) {
  return {
    id: String(row.id),
    action: row.action,
    claimId: row.claim_id ?? undefined,
    callId: row.call_id ?? undefined,
    personKey: row.person_key ?? undefined,
    by: row.by_email,
    reason: row.reason ?? undefined,
    comment: row.comment ?? undefined,
    message: row.message ?? undefined,
    snapshot: row.snapshot ?? undefined,
    at: row.at
  };
}

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
      const params: unknown[] = [];
      let sql = `SELECT * FROM ${CALLS_COLLECTION}`;
      if (q.person) {
        sql += ' WHERE person_key = ?';
        params.push(q.person);
      }
      sql += ' ORDER BY timestamp_ms DESC LIMIT 3000';
      const [rows] = await pool().query<AttentionCallRow[]>(sql, params);
      let calls = rows.map(rowToAttentionCall);
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
    const [rows] = await pool().query<AttentionCallRow[]>(`SELECT * FROM ${CALLS_COLLECTION} WHERE id = ?`, [
      String(req.params.id)
    ]);
    if (!rows.length) return res.status(404).json({ ok: false, error: 'not_found' });
    res.json({ ok: true, call: rowToAttentionCall(rows[0]) });
  });

  // --- Anular manualmente (ademas del flujo de reclamos) ---
  router.delete('/calls/:id', requireRole('superadmin'), async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const reason = String((req.body || {}).reason || '').trim();
      if (!reason) return res.status(400).json({ ok: false, error: 'reason_required' });
      const [rows] = await pool().query<AttentionCallRow[]>(`SELECT * FROM ${CALLS_COLLECTION} WHERE id = ?`, [id]);
      if (!rows.length) return res.status(404).json({ ok: false, error: 'not_found' });
      const before = rowToAttentionCall(rows[0]);
      await pool().query(
        `UPDATE ${CALLS_COLLECTION} SET deleted = TRUE, deleted_by = ?, deleted_reason = ?, deleted_at = NOW() WHERE id = ?`,
        [req.user!.email, reason, id]
      );
      await pool().query(
        `INSERT INTO ${AUDIT_COLLECTION} (action, call_id, reason, by_email, snapshot, at) VALUES (?, ?, ?, ?, ?, NOW())`,
        ['delete_call', id, reason, req.user!.email, JSON.stringify(before)]
      );
      res.json({ ok: true, id });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  // --- Reclamos ---
  router.get('/claims', requireRole('superadmin'), async (req: Request, res: Response) => {
    const status = req.query.status as ClaimStatus | undefined;
    const claims = await listClaims(pool(), { status });
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
      const claim = await resolveClaim({
        claimId: String(req.params.id),
        decision,
        message,
        resolverEmail: req.user!.email
      });
      res.json({ ok: true, claim });
    } catch (e) {
      await logRouteFailure(pool(), e as Error, {
        kind: 'claim_resolve_failed',
        action: 'resolve_claim',
        context: {
          route: 'admin/claims/:id/resolve',
          claimId: String(req.params.id),
          decision: String((req.body || {}).decision || ''),
          byEmail: req.user?.email
        }
      });
      res.status(400).json({ ok: false, error: (e as Error).message });
    }
  });

  // --- Estadisticas globales del periodo ---
  router.get('/stats', requireRole('superadmin'), async (req: Request, res: Response) => {
    const settings = await getSettings();
    const periodKey = (req.query.period as string) || getPeriodKey(new Date(), settings.timezone, settings.resetPeriodMonths);
    const stats = await globalStats(pool(), periodKey);
    res.json({ ok: true, periodKey, resetPeriodMonths: settings.resetPeriodMonths, stats });
  });

  // --- Salud del sistema (logs) ---
  router.get('/logs', requireRole('superadmin'), async (req: Request, res: Response) => {
    const severity = req.query.severity as LogSeverity | undefined;
    const kind = req.query.kind as string | undefined;
    const logs = await listSystemLogs(pool(), { severity, kind, limit: 500 });
    res.json({ ok: true, logs });
  });

  // --- Auditoria ---
  router.get('/audit', requireRole('superadmin'), async (_req: Request, res: Response) => {
    const [rows] = await pool().query<RowDataPacket[]>(`SELECT * FROM ${AUDIT_COLLECTION} ORDER BY at DESC LIMIT 1000`);
    res.json({ ok: true, entries: rows.map(rowToAuditEntry) });
  });

  // --- Personas ---
  router.get('/people', requireRole('superadmin'), async (_req: Request, res: Response) => {
    res.json({ ok: true, people: await listPeople(pool()) });
  });

  router.put('/people/:key', requireRole('superadmin'), async (req: Request, res: Response) => {
    try {
      const person = await upsertPerson(pool(), { ...(req.body || {}), person_key: String(req.params.key) });
      res.json({ ok: true, person });
    } catch (e) {
      await logRouteFailure(pool(), e as Error, {
        kind: 'person_save_failed',
        action: 'save_person',
        context: { route: 'admin/people/:key', personKey: String(req.params.key), byEmail: req.user?.email }
      });
      res.status(400).json({ ok: false, error: (e as Error).message });
    }
  });

  router.delete('/people/:key', requireRole('superadmin'), async (req: Request, res: Response) => {
    await deletePerson(pool(), String(req.params.key));
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
      await logRouteFailure(pool(), e as Error, {
        kind: 'config_save_failed',
        action: 'save_config',
        context: { route: 'admin/config', byEmail: req.user?.email }
      });
      res.status(400).json({ ok: false, error: (e as Error).message });
    }
  });

  // --- Llamada de atencion MANUAL (solo superadmin) ---
  // Registra una llamada creada a mano: razon + comentario + persona asignada.
  // Sigue el mismo flujo que las automaticas (tolerancia, periodo, Slack) y deja
  // constancia de quien la creo.
  router.post('/manual-calls', requireRole('superadmin'), async (req: Request, res: Response) => {
    try {
      const body = (req.body || {}) as { personKey?: string; reason?: string; comment?: string };
      const personKey = String(body.personKey || '').trim();
      const reason = String(body.reason || '').trim();
      const comment = String(body.comment || '').trim();
      if (!personKey) return res.status(400).json({ ok: false, error: 'person_required' });
      if (reason.length < 3) return res.status(400).json({ ok: false, error: 'reason_too_short' });

      const settings = await getSettings();
      const people = await listPeople(pool());
      const person = people.find((p) => p.person_key === personKey);
      if (!person) return res.status(404).json({ ok: false, error: 'person_not_found' });
      if (!person.activo) return res.status(400).json({ ok: false, error: 'person_inactive' });

      // Resolver el canal igual que el webhook (por id, o por nombre si no hay id).
      const slack = new SlackService(secrets.slackBotToken);
      let channelId = settings.slackChannelId;
      if (!channelId && settings.slackChannelName) {
        channelId = await slack.resolveChannelId(settings.slackChannelName);
      }

      const result = await raiseManualAttention(
        { person, reason, comment, createdByEmail: req.user!.email },
        {
          db: pool(),
          settings,
          people: makePersonResolver(people),
          slack: { channelId, post: (ch, text) => slack.postMessage(ch, text) }
        }
      );

      // Auditoria + log de salud.
      await pool().query(
        `INSERT INTO ${AUDIT_COLLECTION} (action, call_id, person_key, reason, comment, by_email, at) VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        ['manual_call', result.call.id, personKey, reason, comment, req.user!.email]
      );
      await logEvent(pool(), settings.timezone, {
        severity: 'info',
        kind: 'manual_raised',
        message: `Llamada manual a ${person.nombre_visible} por ${req.user!.email}: ${reason}`,
        action: 'manual_call'
      });

      res.json({ ok: true, call: result.call });
    } catch (e) {
      await logRouteFailure(pool(), e as Error, {
        kind: 'manual_failed',
        action: 'manual_call',
        context: {
          route: 'admin/manual-calls',
          personKey: String((req.body || {}).personKey || ''),
          byEmail: req.user?.email
        }
      });
      res.status(400).json({ ok: false, error: (e as Error).message });
    }
  });

  // --- Verificacion en vivo (manual desde el panel) ---
  router.post('/live-verify', requireRole('superadmin'), async (_req: Request, res: Response) => {
    try {
      const clickup = new ClickUpService(secrets.clickupToken);
      const slack = new SlackService(secrets.slackBotToken);
      const result = await runLiveVerification(pool(), clickup, slack);
      res.json({ ok: result.ok, result });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  return router;
}
