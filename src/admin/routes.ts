/**
 * API del panel de administracion.
 *
 * Roles:
 *  - admin:      ver llamadas de atencion, detalle, stats, personas, config.
 *  - superadmin: ademas puede ELIMINAR llamadas (con motivo -> audit_log) y
 *                editar personas y configuracion.
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
import type { AttentionCall } from '../domain/types.js';

const AUDIT_COLLECTION = 'audit_log';

export function makeAdminRouter(): Router {
  const router = Router();

  // --- Llamadas de atencion: listado con filtros ---
  router.get('/calls', requireRole('admin'), async (req: Request, res: Response) => {
    try {
      const { person, alertType, from, to, includeDeleted } = req.query as Record<string, string>;
      let q = db().collection(CALLS_COLLECTION).orderBy('timestampMs', 'desc').limit(2000);
      if (person) q = q.where('personKey', '==', person) as typeof q;
      if (alertType) q = q.where('alertType', '==', alertType) as typeof q;

      const snap = await q.get();
      let calls = snap.docs.map((d) => d.data() as AttentionCall);

      if (includeDeleted !== 'true') calls = calls.filter((c) => !c.deleted);
      if (from) calls = calls.filter((c) => c.dateKey >= from);
      if (to) calls = calls.filter((c) => c.dateKey <= to);

      res.json({ ok: true, calls });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  // --- Detalle de una llamada (para explicar una queja) ---
  router.get('/calls/:id', requireRole('admin'), async (req: Request, res: Response) => {
    const snap = await db().collection(CALLS_COLLECTION).doc(String(req.params.id)).get();
    if (!snap.exists) return res.status(404).json({ ok: false, error: 'not_found' });
    res.json({ ok: true, call: snap.data() });
  });

  // --- Stats agregadas ---
  router.get('/stats', requireRole('admin'), async (_req: Request, res: Response) => {
    try {
      const snap = await db().collection(CALLS_COLLECTION).limit(10000).get();
      const stats = {
        total: 0,
        byAlertType: {} as Record<string, number>,
        byPerson: {} as Record<string, number>,
        tolerances: 0,
        formalCalls: 0,
        slackFailures: 0,
        deleted: 0
      };
      snap.forEach((d) => {
        const x = d.data() as AttentionCall;
        if (x.deleted) {
          stats.deleted++;
          return;
        }
        stats.total++;
        stats.byAlertType[x.alertType] = (stats.byAlertType[x.alertType] || 0) + 1;
        stats.byPerson[x.personName || x.personKey] = (stats.byPerson[x.personName || x.personKey] || 0) + 1;
        if (x.isTolerance) stats.tolerances++;
        else stats.formalCalls++;
        if (!x.slackOk) stats.slackFailures++;
      });
      res.json({ ok: true, stats });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  // --- Eliminar una llamada (SOLO superadmin, con motivo, con auditoria) ---
  router.delete('/calls/:id', requireRole('superadmin'), async (req: Request, res: Response) => {
    try {
      const id = String(req.params.id);
      const reason = String((req.body || {}).reason || '').trim();
      if (!reason) return res.status(400).json({ ok: false, error: 'reason_required' });

      const ref = db().collection(CALLS_COLLECTION).doc(id);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ ok: false, error: 'not_found' });

      const before = snap.data() as AttentionCall;
      // Soft-delete: conservamos el registro pero deja de contar para tolerancia.
      await ref.set(
        { deleted: true, deletedBy: req.user!.email, deletedReason: reason, deletedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
      await db().collection(AUDIT_COLLECTION).add({
        action: 'delete_call',
        callId: id,
        reason,
        by: req.user!.email,
        snapshot: before,
        at: FieldValue.serverTimestamp()
      });

      res.json({ ok: true, id });
    } catch (e) {
      res.status(500).json({ ok: false, error: (e as Error).message });
    }
  });

  // --- Auditoria de eliminaciones (superadmin) ---
  router.get('/audit', requireRole('superadmin'), async (_req: Request, res: Response) => {
    const snap = await db().collection(AUDIT_COLLECTION).orderBy('at', 'desc').limit(1000).get();
    const entries = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.json({ ok: true, entries });
  });

  // --- Personas (config de cuentas). Ver: admin. Editar: superadmin. ---
  router.get('/people', requireRole('admin'), async (_req: Request, res: Response) => {
    const people = await listPeople(db());
    res.json({ ok: true, people });
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

  // --- Configuracion. Ver: admin. Editar: superadmin. ---
  router.get('/config', requireRole('admin'), async (_req: Request, res: Response) => {
    const settings = await getSettings();
    res.json({ ok: true, settings });
  });

  router.patch('/config', requireRole('superadmin'), async (req: Request, res: Response) => {
    try {
      const settings = await saveSettings(req.body || {}, req.user!.email);
      res.json({ ok: true, settings });
    } catch (e) {
      res.status(400).json({ ok: false, error: (e as Error).message });
    }
  });

  // --- Quien soy / que rol tengo (para que el panel muestre lo correcto) ---
  router.get('/me', requireRole('admin'), (req: Request, res: Response) => {
    res.json({ ok: true, user: req.user });
  });

  return router;
}
