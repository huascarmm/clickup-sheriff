/**
 * Tipos del dominio. Un solo lugar donde vive la forma de los datos.
 */

export type AlertType = 'QA_36H' | 'FIXING_QA_36H' | 'ATRASO_PLAZO';

export const VALID_ALERT_TYPES: readonly AlertType[] = [
  'QA_36H',
  'FIXING_QA_36H',
  'ATRASO_PLAZO'
];

export type Role = 'admin' | 'superadmin';

/** Persona del equipo (reemplaza la hoja config_personas). */
export interface Person {
  person_key: string;
  nombre_visible: string;
  qa_string: string;
  clickup_user_id: string;
  clickup_username: string;
  clickup_email: string;
  slack_user_id: string;
  activo: boolean;
  notas: string;
}

/** Configuracion editable desde el panel (documento config/settings). */
export interface Settings {
  qaFieldName: string;
  statusChangeFieldName: string;
  qaStatusName: string;
  fixingQaStatusName: string;
  qaHoursLimit: number;
  fixingHoursLimit: number;
  overdueWeeklyTolerance: number;
  timezone: string;
  ignoredStatuses: string[];
  slackChannelName: string;
  slackChannelId: string;
  // Para el validador de plazo (validateDueTime):
  plazoHourDefault: number; // hora "default" de ClickUp (04:00)
  plazoMinuteDefault: number;
  plazoFieldName: string; // nombre del custom field checkbox
  plazoFieldId: string; // id opcional del custom field
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
  timestampMs: number;
  dateKey: string; // yyyy-MM-dd (dia local)
  weekKey: string; // lunes de la semana ISO, yyyy-MM-dd
  quarter: string; // yyyy_Qn
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
  quarterlyAttentionCountAfter: number | null;
  slackOk: boolean;
  slackTs: string;
  slackError: string;
  message: string;
  deleted: boolean;
  deletedBy?: string;
  deletedReason?: string;
  deletedAt?: unknown;
  createdAt?: unknown;
}
