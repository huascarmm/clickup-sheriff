/**
 * Utilidades para los tests del panel (API con token de Firebase).
 *
 * Monta la app con supertest, sin puerto, y siembra datos directamente en MySQL.
 * El mock de Firebase Auth vive en test/support/firebaseMock.ts; cada archivo de
 * test lo activa con vi.mock antes de importar la app.
 */
import type { Express } from 'express';
import type { RowDataPacket } from 'mysql2/promise';
import { testDb } from '../helpers.js';
import { CALLS_COLLECTION } from '../../src/services/attention.js';
import { CLAIMS_COLLECTION } from '../../src/services/claims.js';
import type { AlertType, Person } from '../../src/domain/types.js';

export { bearer, type FakeRole } from './firebaseMock.js';

/** Correos habilitados en el panel (allowlist ADMIN_EMAILS). */
export const ADMIN_EMAILS = ['boss@x.com', 'jose@x.com', 'mel@x.com'];

export const WEBHOOK_SECRET = 'test-secret';

/** Momento fijo para que las claves de semana/periodo sean estables. */
export const NOW = Date.UTC(2026, 7, 17, 12, 0);
export const WEEK = '2026-08-17';
export const PERIOD = '2026_P3';

export async function makePanelApp(adminEmails: string[] = ADMIN_EMAILS): Promise<Express> {
  const { createApp } = await import('../../src/app.js');
  return createApp({
    clickupToken: 'x',
    slackBotToken: 'x',
    webhookSecret: WEBHOOK_SECRET,
    adminEmails,
    allowedOrigin: '',
    port: 0
  });
}

export function person(partial: Partial<Person> & { person_key: string }): Person {
  return {
    nombre_visible: partial.person_key,
    qa_string: partial.person_key,
    clickup_user_id: '',
    clickup_username: partial.person_key,
    clickup_email: '',
    login_email: '',
    slack_user_id: `U${partial.person_key.toUpperCase()}`,
    activo: true,
    notas: '',
    ...partial
  };
}

/** Inserta una persona en la tabla people. */
export async function seedPerson(partial: Partial<Person> & { person_key: string }): Promise<Person> {
  const p = person(partial);
  await testDb().query(
    `INSERT INTO people (person_key, nombre_visible, qa_string, clickup_user_id, clickup_username,
      clickup_email, login_email, slack_user_id, activo, notas)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      p.person_key, p.nombre_visible, p.qa_string, p.clickup_user_id, p.clickup_username,
      p.clickup_email, p.login_email, p.slack_user_id, p.activo, p.notas
    ]
  );
  return p;
}

export interface CallSeed {
  id: string;
  personKey: string;
  personName?: string;
  alertType?: AlertType;
  taskId?: string;
  taskName?: string;
  currentStatus?: string;
  dateKey?: string;
  weekKey?: string;
  periodKey?: string;
  timestampMs?: number;
  isTolerance?: boolean;
  tolerance?: string;
  weeklyCountAfter?: number;
  periodAttentionCountAfter?: number | null;
  slackOk?: boolean;
  deleted?: boolean;
  origin?: 'webhook' | 'manual';
}

/** Inserta una llamada de atencion ya "cerrada" (sin pasar por el servicio). */
export async function seedCall(seed: CallSeed): Promise<CallSeed> {
  const isTolerance = seed.isTolerance ?? false;
  await testDb().query(
    `INSERT INTO ${CALLS_COLLECTION}
     (id, timestamp_ms, timestamp_local, date_key, week_key, period_key, task_id, task_name, task_url,
      current_status, alert_type, person_key, person_name, slack_user_id, reason, tolerance, is_tolerance,
      weekly_count_after, period_attention_count_after, slack_ok, message, origin, deleted)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      seed.id,
      seed.timestampMs ?? NOW,
      '2026-08-17 08:00',
      seed.dateKey ?? '2026-08-17',
      seed.weekKey ?? WEEK,
      seed.periodKey ?? PERIOD,
      seed.taskId ?? `task_${seed.id}`,
      seed.taskName ?? `Tarea ${seed.id}`,
      `https://app.clickup.com/t/${seed.taskId ?? seed.id}`,
      seed.currentStatus ?? 'doing',
      seed.alertType ?? 'ATRASO_PLAZO',
      seed.personKey,
      seed.personName ?? seed.personKey,
      `U${seed.personKey.toUpperCase()}`,
      `Motivo ${seed.id}`,
      seed.tolerance ?? (isTolerance ? 'SI 1/2' : 'NO 3/2'),
      isTolerance,
      seed.weeklyCountAfter ?? 1,
      seed.periodAttentionCountAfter ?? (isTolerance ? null : 1),
      seed.slackOk ?? true,
      `Mensaje ${seed.id}`,
      seed.origin ?? 'webhook',
      seed.deleted ?? false
    ]
  );
  return seed;
}

export interface ClaimSeed {
  id: string;
  callId: string;
  personKey: string;
  requestedByEmail: string;
  status?: 'pending' | 'accepted' | 'rejected';
  justification?: string;
  createdAtMs?: number;
}

/** Inserta un reclamo ya existente (para los listados). */
export async function seedClaim(seed: ClaimSeed): Promise<ClaimSeed> {
  await testDb().query(
    `INSERT INTO ${CLAIMS_COLLECTION}
     (id, call_id, task_id, task_name, task_url, alert_type, call_timestamp_local, person_key, person_name,
      requested_by_email, requested_by_name, requested_by_slack_id, justification, status, created_at_ms)
     VALUES (?, ?, ?, ?, ?, 'ATRASO_PLAZO', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      seed.id,
      seed.callId,
      `task_${seed.callId}`,
      `Tarea ${seed.callId}`,
      '',
      '2026-08-17 08:00',
      seed.personKey,
      seed.personKey,
      seed.requestedByEmail.toLowerCase(),
      seed.personKey,
      `U${seed.personKey.toUpperCase()}`,
      seed.justification ?? 'En el daily se acordo anularla',
      seed.status ?? 'pending',
      seed.createdAtMs ?? NOW
    ]
  );
  return seed;
}

export interface LogSeed {
  severity: 'info' | 'warn' | 'error';
  kind: string;
  message?: string;
  action?: string;
  taskId?: string;
  timestampMs?: number;
}

/**
 * Inserta un evento de salud con timestamp explicito (logEvent usa Date.now(),
 * que no sirve para probar el orden del listado).
 */
export async function seedLog(seed: LogSeed): Promise<void> {
  await testDb().query(
    `INSERT INTO system_logs (severity, kind, message, task_id, action, status, context, timestamp_ms, timestamp_local)
     VALUES (?, ?, ?, ?, ?, '', '{}', ?, ?)`,
    [
      seed.severity,
      seed.kind,
      seed.message ?? `Evento ${seed.kind}`,
      seed.taskId ?? '',
      seed.action ?? '',
      seed.timestampMs ?? NOW,
      '2026-08-17 08:00'
    ]
  );
}

/** Filas de system_logs de un tipo dado (para verificar el registro de fallas). */
export async function logsOfKind(kind: string): Promise<RowDataPacket[]> {
  const [rows] = await testDb().query<RowDataPacket[]>('SELECT * FROM system_logs WHERE kind = ?', [kind]);
  return rows;
}

/** Filas de system_errors (detalle tecnico de la falla). */
export async function systemErrors(): Promise<RowDataPacket[]> {
  const [rows] = await testDb().query<RowDataPacket[]>('SELECT * FROM system_errors');
  return rows;
}

/** Entradas de auditoria de una accion dada. */
export async function auditEntries(action: string): Promise<RowDataPacket[]> {
  const [rows] = await testDb().query<RowDataPacket[]>('SELECT * FROM audit_log WHERE action = ?', [action]);
  return rows;
}
