/**
 * Tipos del dominio. Un solo lugar donde vive la forma de los datos.
 */

export type AlertType = 'QA_36H' | 'FIXING_QA_36H' | 'ATRASO_PLAZO';

export const VALID_ALERT_TYPES: readonly AlertType[] = [
  'QA_36H',
  'FIXING_QA_36H',
  'ATRASO_PLAZO'
];

/** Etiqueta legible por tipo de alerta (para paneles y mensajes). */
export const ALERT_TYPE_LABEL: Record<AlertType, string> = {
  QA_36H: 'Atraso en QA (36h)',
  FIXING_QA_36H: 'Atraso en FIXING QA (36h)',
  ATRASO_PLAZO: 'Atraso de plazo'
};

export type Role = 'admin' | 'superadmin';

/** Persona del equipo (reemplaza la hoja config_personas). */
export interface Person {
  person_key: string;
  nombre_visible: string;
  qa_string: string;
  clickup_user_id: string;
  clickup_username: string;
  clickup_email: string;
  /** Correo de Google con el que la persona inicia sesion en el panel admin. */
  login_email: string;
  slack_user_id: string;
  activo: boolean;
  notas: string;
}

/**
 * Configuracion editable desde el panel (documento config/settings).
 * IMPORTANTE: los campos personalizados de ClickUp se referencian por ID
 * (no por nombre) para reducir errores. El nombre queda solo como etiqueta.
 */
export interface Settings {
  // --- Campos personalizados de ClickUp (por ID) ---
  qaFieldId: string; // campo que contiene al REVISOR
  statusChangeFieldId: string; // campo con la fecha de ultimo cambio de estado
  plazoFieldId: string; // campo checkbox del validador de plazo
  // Etiquetas legibles (solo informativas, no se usan para la logica):
  qaFieldLabel: string;
  statusChangeFieldLabel: string;
  plazoFieldLabel: string;

  // --- Estados (por nombre, segun el manual de ClickUp) ---
  qaStatusName: string;
  fixingQaStatusName: string;
  ignoredStatuses: string[];

  // --- Reglas de negocio ---
  qaHoursLimit: number;
  fixingHoursLimit: number;
  overdueWeeklyTolerance: number;
  /** Cada cuantos meses se reinician los contadores de periodo (default 3). */
  resetPeriodMonths: number;
  timezone: string;

  // --- Slack ---
  slackChannelName: string;
  slackChannelId: string;

  // --- Validador de plazo ---
  plazoHourDefault: number;
  plazoMinuteDefault: number;

  // --- Verificacion en vivo (lista y canal de PRUEBA dedicados) ---
  testClickupListId: string;
  testSlackChannelId: string;
  testAssigneePersonKey: string;

  updatedAt?: unknown;
  updatedBy?: string;
}

/** Assignee simplificado de una tarea de ClickUp. */
export interface Assignee {
  id: string;
  username: string;
  name: string;
  email: string;
}

/** Custom field de una tarea de ClickUp (forma minima que usamos). */
export interface ClickUpCustomField {
  id?: string;
  name: string;
  type?: string;
  value?: unknown;
  type_config?: { options?: Array<{ id?: string; name?: string; orderindex?: number }> };
}

/** Tarea de ClickUp (forma minima que usamos). */
export interface ClickUpTask {
  id: string;
  name?: string;
  url?: string;
  status?: string | { status?: string };
  due_date?: number | string | null;
  assignees?: Array<{ id?: string; username?: string; name?: string; email?: string }>;
  custom_fields?: ClickUpCustomField[];
  time_mgmt?: { due_date?: number | string };
}

/** Resultado de evaluar una tarea: o no aplica, o hay que llamar la atencion. */
export interface AlertDecision {
  alertType: AlertType;
  person: Person;
  reason: string;
  hoursElapsed: number;
  statusChangeMs: number | null;
  dueDateMs: number | null;
}

/** Registro persistido de una llamada de atencion (coleccion attention_calls). */
export interface AttentionCall {
  id: string; // {dateKey}_{taskId}_{alertType}
  timestampLocal: string;
  timestampMs: number; // hora exacta (epoch ms)
  dateKey: string; // yyyy-MM-dd (dia local)
  weekKey: string; // lunes de la semana ISO, yyyy-MM-dd
  periodKey: string; // periodo de reinicio (yyyy_Pn segun resetPeriodMonths)
  taskId: string;
  taskName: string;
  taskUrl: string;
  currentStatus: string;
  alertType: AlertType;
  personKey: string;
  personName: string;
  slackUserId: string;
  reason: string;
  hoursElapsed: number;
  dueDateLocal: string;
  statusChangeLocal: string;
  tolerance: string; // "SI 1/2" | "NO 3/2"
  isTolerance: boolean;
  weeklyCountAfter: number;
  periodAttentionCountAfter: number | null;
  slackOk: boolean;
  slackTs: string;
  slackError: string;
  message: string;
  deleted: boolean; // anulada (no cuenta para contadores)
  deletedBy?: string;
  deletedReason?: string;
  deletedAt?: unknown;
  claimId?: string; // reclamo que la anulo (si aplica)
  createdAt?: unknown;
}

/** Reclamo de anulacion de una llamada de atencion (coleccion claims). */
export type ClaimStatus = 'pending' | 'accepted' | 'rejected';

export interface Claim {
  id: string;
  callId: string;
  // Datos denormalizados de la llamada para mostrar sin joins.
  taskId: string;
  taskName: string;
  taskUrl: string;
  alertType: AlertType;
  callTimestampLocal: string;
  personKey: string;
  personName: string;
  // Quien reclama.
  requestedByEmail: string;
  requestedByName: string;
  requestedBySlackId: string;
  justification: string;
  status: ClaimStatus;
  createdAt?: unknown;
  createdAtMs: number;
  // Resolucion.
  resolvedByEmail?: string;
  resolvedAtMs?: number;
  resolutionMessage?: string;
}

/** Evento de sistema para el panel de salud (coleccion system_logs). */
export type LogSeverity = 'info' | 'warn' | 'error';

export interface SystemLog {
  id?: string;
  severity: LogSeverity;
  kind: string; // p.ej. webhook_raised, webhook_no_alert, webhook_error, fetch_failed
  message: string;
  taskId?: string;
  action?: string;
  status?: string;
  context?: Record<string, unknown>;
  timestampMs: number;
  timestampLocal: string;
  createdAt?: unknown;
}
