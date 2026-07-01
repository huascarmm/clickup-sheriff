/**
 * Configuracion en dos capas:
 *  - SECRETOS (env / Secret Manager): tokens y el webhook secret. Nunca en la BD.
 *  - SETTINGS (Firestore config/settings): parametros de negocio editables desde
 *    el panel. Si el documento no existe todavia, se usan defaults (asi el
 *    sistema arranca con base VACIA sin romperse).
 */
import { db } from './firebase.js';
import type { Settings } from './domain/types.js';

export interface Secrets {
  clickupToken: string;
  slackBotToken: string;
  webhookSecret: string;
  adminEmails: string[];
  allowedOrigin: string;
  port: number;
}

export function loadSecrets(): Secrets {
  return {
    clickupToken: process.env.CLICKUP_TOKEN || '',
    slackBotToken: process.env.SLACK_BOT_TOKEN || '',
    webhookSecret: process.env.WEBHOOK_SECRET || '',
    adminEmails: (process.env.ADMIN_EMAILS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    allowedOrigin: process.env.ALLOWED_ORIGIN || '',
    port: Number(process.env.PORT || 8080)
  };
}

export const DEFAULT_SETTINGS: Settings = {
  qaFieldName: 'QA',
  statusChangeFieldName: 'time_status_change',
  qaStatusName: 'QA',
  fixingQaStatusName: 'FIXING QA',
  qaHoursLimit: 36,
  fixingHoursLimit: 36,
  overdueWeeklyTolerance: 2,
  timezone: 'America/La_Paz',
  // Estados terminales o de planificacion que NUNCA generan llamada de atencion.
  // La empresa usa PRODUCTION como estado terminal (ver manual de ClickUp).
  ignoredStatuses: ['production', 'done', 'closed', 'completado'],
  slackChannelName: 'reglamento-y-qa',
  slackChannelId: '',
  plazoHourDefault: 4,
  plazoMinuteDefault: 0,
  plazoFieldName: 'plazo_hora',
  plazoFieldId: ''
};

const SETTINGS_DOC = 'config/settings';

/** Lee settings de Firestore; si no existe, devuelve defaults. */
export async function getSettings(): Promise<Settings> {
  const snap = await db().doc(SETTINGS_DOC).get();
  if (!snap.exists) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...(snap.data() as Partial<Settings>) };
}

/** Guarda (merge) settings desde el panel. */
export async function saveSettings(patch: Partial<Settings>, updatedBy: string): Promise<Settings> {
  const clean = sanitizeSettings(patch);
  await db()
    .doc(SETTINGS_DOC)
    .set({ ...clean, updatedBy, updatedAt: new Date() }, { merge: true });
  return getSettings();
}

/** Valida y normaliza el patch de settings que llega del panel. */
export function sanitizeSettings(patch: Partial<Settings>): Partial<Settings> {
  const out: Partial<Settings> = {};
  const str = (v: unknown) => String(v ?? '').trim();
  const num = (v: unknown, min: number, max: number, dflt: number) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) return dflt;
    return n;
  };

  if (patch.qaFieldName !== undefined) out.qaFieldName = str(patch.qaFieldName);
  if (patch.statusChangeFieldName !== undefined) out.statusChangeFieldName = str(patch.statusChangeFieldName);
  if (patch.qaStatusName !== undefined) out.qaStatusName = str(patch.qaStatusName);
  if (patch.fixingQaStatusName !== undefined) out.fixingQaStatusName = str(patch.fixingQaStatusName);
  if (patch.qaHoursLimit !== undefined) out.qaHoursLimit = num(patch.qaHoursLimit, 1, 2000, 36);
  if (patch.fixingHoursLimit !== undefined) out.fixingHoursLimit = num(patch.fixingHoursLimit, 1, 2000, 36);
  if (patch.overdueWeeklyTolerance !== undefined) out.overdueWeeklyTolerance = num(patch.overdueWeeklyTolerance, 0, 100, 2);
  if (patch.timezone !== undefined) out.timezone = str(patch.timezone) || 'America/La_Paz';
  if (patch.ignoredStatuses !== undefined) {
    const arr = Array.isArray(patch.ignoredStatuses)
      ? patch.ignoredStatuses
      : String(patch.ignoredStatuses).split(',');
    out.ignoredStatuses = arr.map((s) => str(s).toLowerCase()).filter(Boolean);
  }
  if (patch.slackChannelName !== undefined) out.slackChannelName = str(patch.slackChannelName).replace(/^#/, '');
  if (patch.slackChannelId !== undefined) out.slackChannelId = str(patch.slackChannelId);
  if (patch.plazoHourDefault !== undefined) out.plazoHourDefault = num(patch.plazoHourDefault, 0, 23, 4);
  if (patch.plazoMinuteDefault !== undefined) out.plazoMinuteDefault = num(patch.plazoMinuteDefault, 0, 59, 0);
  if (patch.plazoFieldName !== undefined) out.plazoFieldName = str(patch.plazoFieldName);
  if (patch.plazoFieldId !== undefined) out.plazoFieldId = str(patch.plazoFieldId);
  return out;
}
