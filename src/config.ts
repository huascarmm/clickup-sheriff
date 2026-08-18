/**
 * Configuracion en dos capas:
 *  - SECRETOS (env / Secret Manager): tokens y el webhook secret. Nunca en la BD.
 *  - SETTINGS (tabla MySQL settings, fila unica id=1): parametros de negocio
 *    editables desde el panel. Si la fila no existe todavia, se usan defaults
 *    (asi el sistema arranca con base VACIA sin romperse).
 */
import type { RowDataPacket } from 'mysql2/promise';
import { pool } from './db.js';
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
  // Campos personalizados de ClickUp por ID (se completan desde el panel).
  qaFieldId: '',
  statusChangeFieldId: '',
  plazoFieldId: '',
  qaFieldLabel: 'REVISOR',
  statusChangeFieldLabel: 'time_status_change',
  plazoFieldLabel: 'plazo_hora',

  qaStatusName: 'QA',
  fixingQaStatusName: 'FIXING QA',
  // Estados terminales o de planificacion que NUNCA generan llamada de atencion.
  // La empresa usa PRODUCTION como estado terminal (ver manual de ClickUp).
  ignoredStatuses: ['production', 'done', 'closed', 'completado'],

  qaHoursLimit: 36,
  fixingHoursLimit: 36,
  overdueWeeklyTolerance: 2,
  resetPeriodMonths: 3,
  timezone: 'America/La_Paz',

  slackChannelName: 'reglamento-y-qa',
  slackChannelId: '',

  plazoHourDefault: 4,
  plazoMinuteDefault: 0,

  testClickupListId: '',
  testSlackChannelId: '',
  testAssigneePersonKey: ''
};

interface SettingsRow extends RowDataPacket {
  qa_field_id: string;
  status_change_field_id: string;
  plazo_field_id: string;
  qa_field_label: string;
  status_change_field_label: string;
  plazo_field_label: string;
  qa_status_name: string;
  fixing_qa_status_name: string;
  ignored_statuses: string[] | null;
  qa_hours_limit: number;
  fixing_hours_limit: number;
  overdue_weekly_tolerance: number;
  reset_period_months: number;
  timezone: string;
  slack_channel_name: string;
  slack_channel_id: string;
  plazo_hour_default: number;
  plazo_minute_default: number;
  test_clickup_list_id: string;
  test_slack_channel_id: string;
  test_assignee_person_key: string;
  updated_at: string | null;
  updated_by: string | null;
}

function rowToSettings(row: SettingsRow): Settings {
  return {
    qaFieldId: row.qa_field_id,
    statusChangeFieldId: row.status_change_field_id,
    plazoFieldId: row.plazo_field_id,
    qaFieldLabel: row.qa_field_label,
    statusChangeFieldLabel: row.status_change_field_label,
    plazoFieldLabel: row.plazo_field_label,
    qaStatusName: row.qa_status_name,
    fixingQaStatusName: row.fixing_qa_status_name,
    ignoredStatuses: row.ignored_statuses || [],
    qaHoursLimit: row.qa_hours_limit,
    fixingHoursLimit: row.fixing_hours_limit,
    overdueWeeklyTolerance: row.overdue_weekly_tolerance,
    resetPeriodMonths: row.reset_period_months,
    timezone: row.timezone,
    slackChannelName: row.slack_channel_name,
    slackChannelId: row.slack_channel_id,
    plazoHourDefault: row.plazo_hour_default,
    plazoMinuteDefault: row.plazo_minute_default,
    testClickupListId: row.test_clickup_list_id,
    testSlackChannelId: row.test_slack_channel_id,
    testAssigneePersonKey: row.test_assignee_person_key,
    updatedAt: row.updated_at ?? undefined,
    updatedBy: row.updated_by ?? undefined
  };
}

/** Lee settings de MySQL; si la fila no existe, devuelve defaults. */
export async function getSettings(): Promise<Settings> {
  const [rows] = await pool().query<SettingsRow[]>('SELECT * FROM settings WHERE id = 1');
  if (!rows.length) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...rowToSettings(rows[0]) };
}

/** Guarda (merge) settings desde el panel: fusiona en JS y sobreescribe la fila completa. */
export async function saveSettings(patch: Partial<Settings>, updatedBy: string): Promise<Settings> {
  const clean = sanitizeSettings(patch);
  const current = await getSettings();
  const merged: Settings = { ...current, ...clean };

  await pool().query(
    `INSERT INTO settings (
      id, qa_field_id, status_change_field_id, plazo_field_id, qa_field_label,
      status_change_field_label, plazo_field_label, qa_status_name, fixing_qa_status_name,
      ignored_statuses, qa_hours_limit, fixing_hours_limit, overdue_weekly_tolerance,
      reset_period_months, timezone, slack_channel_name, slack_channel_id,
      plazo_hour_default, plazo_minute_default, test_clickup_list_id, test_slack_channel_id,
      test_assignee_person_key, updated_at, updated_by
    ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)
    ON DUPLICATE KEY UPDATE
      qa_field_id=VALUES(qa_field_id), status_change_field_id=VALUES(status_change_field_id),
      plazo_field_id=VALUES(plazo_field_id), qa_field_label=VALUES(qa_field_label),
      status_change_field_label=VALUES(status_change_field_label), plazo_field_label=VALUES(plazo_field_label),
      qa_status_name=VALUES(qa_status_name), fixing_qa_status_name=VALUES(fixing_qa_status_name),
      ignored_statuses=VALUES(ignored_statuses), qa_hours_limit=VALUES(qa_hours_limit),
      fixing_hours_limit=VALUES(fixing_hours_limit), overdue_weekly_tolerance=VALUES(overdue_weekly_tolerance),
      reset_period_months=VALUES(reset_period_months), timezone=VALUES(timezone),
      slack_channel_name=VALUES(slack_channel_name), slack_channel_id=VALUES(slack_channel_id),
      plazo_hour_default=VALUES(plazo_hour_default), plazo_minute_default=VALUES(plazo_minute_default),
      test_clickup_list_id=VALUES(test_clickup_list_id), test_slack_channel_id=VALUES(test_slack_channel_id),
      test_assignee_person_key=VALUES(test_assignee_person_key), updated_at=VALUES(updated_at),
      updated_by=VALUES(updated_by)`,
    [
      merged.qaFieldId, merged.statusChangeFieldId, merged.plazoFieldId, merged.qaFieldLabel,
      merged.statusChangeFieldLabel, merged.plazoFieldLabel, merged.qaStatusName, merged.fixingQaStatusName,
      JSON.stringify(merged.ignoredStatuses || []), merged.qaHoursLimit, merged.fixingHoursLimit,
      merged.overdueWeeklyTolerance, merged.resetPeriodMonths, merged.timezone, merged.slackChannelName,
      merged.slackChannelId, merged.plazoHourDefault, merged.plazoMinuteDefault, merged.testClickupListId,
      merged.testSlackChannelId, merged.testAssigneePersonKey, updatedBy
    ]
  );

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

  if (patch.qaFieldId !== undefined) out.qaFieldId = str(patch.qaFieldId);
  if (patch.statusChangeFieldId !== undefined) out.statusChangeFieldId = str(patch.statusChangeFieldId);
  if (patch.plazoFieldId !== undefined) out.plazoFieldId = str(patch.plazoFieldId);
  if (patch.qaFieldLabel !== undefined) out.qaFieldLabel = str(patch.qaFieldLabel);
  if (patch.statusChangeFieldLabel !== undefined) out.statusChangeFieldLabel = str(patch.statusChangeFieldLabel);
  if (patch.plazoFieldLabel !== undefined) out.plazoFieldLabel = str(patch.plazoFieldLabel);

  if (patch.qaStatusName !== undefined) out.qaStatusName = str(patch.qaStatusName);
  if (patch.fixingQaStatusName !== undefined) out.fixingQaStatusName = str(patch.fixingQaStatusName);
  if (patch.ignoredStatuses !== undefined) {
    const arr = Array.isArray(patch.ignoredStatuses)
      ? patch.ignoredStatuses
      : String(patch.ignoredStatuses).split(',');
    out.ignoredStatuses = arr.map((s) => str(s).toLowerCase()).filter(Boolean);
  }

  if (patch.qaHoursLimit !== undefined) out.qaHoursLimit = num(patch.qaHoursLimit, 1, 2000, 36);
  if (patch.fixingHoursLimit !== undefined) out.fixingHoursLimit = num(patch.fixingHoursLimit, 1, 2000, 36);
  if (patch.overdueWeeklyTolerance !== undefined) out.overdueWeeklyTolerance = num(patch.overdueWeeklyTolerance, 0, 100, 2);
  if (patch.resetPeriodMonths !== undefined) out.resetPeriodMonths = num(patch.resetPeriodMonths, 1, 12, 3);
  if (patch.timezone !== undefined) out.timezone = str(patch.timezone) || 'America/La_Paz';

  if (patch.slackChannelName !== undefined) out.slackChannelName = str(patch.slackChannelName).replace(/^#/, '');
  if (patch.slackChannelId !== undefined) out.slackChannelId = str(patch.slackChannelId);

  if (patch.plazoHourDefault !== undefined) out.plazoHourDefault = num(patch.plazoHourDefault, 0, 23, 4);
  if (patch.plazoMinuteDefault !== undefined) out.plazoMinuteDefault = num(patch.plazoMinuteDefault, 0, 59, 0);

  if (patch.testClickupListId !== undefined) out.testClickupListId = str(patch.testClickupListId);
  if (patch.testSlackChannelId !== undefined) out.testSlackChannelId = str(patch.testSlackChannelId);
  if (patch.testAssigneePersonKey !== undefined) out.testAssigneePersonKey = str(patch.testAssigneePersonKey);

  return out;
}
