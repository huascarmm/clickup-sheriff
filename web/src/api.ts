/**
 * Cliente de la API del panel. Adjunta el ID token de Firebase en cada request.
 * El panel llama a /api/* (mismo origen: Firebase Hosting reescribe hacia Cloud Run).
 */
import { auth } from './firebase.js';

async function authHeader(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) throw new Error('No hay sesion.');
  const token = await user.getIdToken();
  return { Authorization: `Bearer ${token}` };
}

async function handle(res: Response) {
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok || body.ok === false) {
    throw new Error(mapError(body.error || `Error ${res.status}`));
  }
  return body;
}

function mapError(code: string): string {
  const map: Record<string, string> = {
    forbidden: 'Tu correo no esta autorizado para este panel.',
    no_role: 'Tu cuenta no tiene un rol asignado. Pide a un superadmin que te lo asigne.',
    insufficient_role: 'No tienes permiso para esta accion.',
    not_linked: 'Tu correo no esta vinculado a ninguna persona del equipo. Avisa al superadmin.',
    reason_required: 'Debes indicar un motivo.',
    message_required: 'Debes escribir un mensaje de respuesta.',
    justification_too_short: 'La justificacion es demasiado corta.',
    not_your_call: 'Solo puedes reclamar tus propias llamadas.',
    call_already_annulled: 'Esa llamada ya fue anulada.',
    claim_already_exists: 'Ya existe un reclamo vigente para esa llamada.',
    claim_already_resolved: 'Ese reclamo ya fue resuelto.',
    not_found: 'No se encontro el registro.',
    bad_token: 'Tu sesion expiro. Vuelve a entrar.',
    no_token: 'Tu sesion expiro. Vuelve a entrar.'
  };
  return map[code] || code;
}

// ---------- Tipos ----------
export type AlertType = 'QA_36H' | 'FIXING_QA_36H' | 'ATRASO_PLAZO';
export type ClaimStatus = 'pending' | 'accepted' | 'rejected';

export interface Call {
  id: string;
  timestampLocal: string;
  timestampMs: number;
  dateKey: string;
  periodKey: string;
  taskId: string;
  taskName: string;
  taskUrl: string;
  currentStatus: string;
  alertType: AlertType;
  personKey: string;
  personName: string;
  reason: string;
  hoursElapsed: number;
  dueDateLocal: string;
  statusChangeLocal: string;
  tolerance: string;
  isTolerance: boolean;
  weeklyCountAfter: number;
  periodAttentionCountAfter: number | null;
  slackOk: boolean;
  slackError: string;
  message: string;
  deleted: boolean;
  deletedBy?: string;
  deletedReason?: string;
  claimId?: string;
}

export interface Claim {
  id: string;
  callId: string;
  taskId: string;
  taskName: string;
  taskUrl: string;
  alertType: AlertType;
  callTimestampLocal: string;
  personKey: string;
  personName: string;
  requestedByEmail: string;
  requestedByName: string;
  requestedBySlackId: string;
  justification: string;
  status: ClaimStatus;
  createdAtMs: number;
  resolvedByEmail?: string;
  resolvedAtMs?: number;
  resolutionMessage?: string;
}

export interface Person {
  person_key: string;
  nombre_visible: string;
  qa_string: string;
  clickup_user_id: string;
  clickup_username: string;
  clickup_email: string;
  login_email: string;
  slack_user_id: string;
  activo: boolean;
  notas: string;
}

export interface Settings {
  qaFieldId: string;
  statusChangeFieldId: string;
  plazoFieldId: string;
  qaFieldLabel: string;
  statusChangeFieldLabel: string;
  plazoFieldLabel: string;
  qaStatusName: string;
  fixingQaStatusName: string;
  ignoredStatuses: string[];
  qaHoursLimit: number;
  fixingHoursLimit: number;
  overdueWeeklyTolerance: number;
  resetPeriodMonths: number;
  timezone: string;
  slackChannelName: string;
  slackChannelId: string;
  plazoHourDefault: number;
  plazoMinuteDefault: number;
  testClickupListId: string;
  testSlackChannelId: string;
  testAssigneePersonKey: string;
}

export interface StatsBreakdown {
  totalAlerts: number;
  tolerances: number;
  formalCalls: number;
  annulled: number;
  formalByReason: Record<AlertType, number>;
  slackFailures: number;
}

export interface SystemLog {
  id: string;
  severity: 'info' | 'warn' | 'error';
  kind: string;
  message: string;
  taskId?: string;
  action?: string;
  status?: string;
  timestampLocal: string;
  timestampMs: number;
}

type Filters = Record<string, string | undefined>;
function qs(params: Filters): string {
  return new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
}

// ---------- Cliente ----------
export const api = {
  /** Detecta el rol probando primero superadmin y luego admin. */
  async whoami(): Promise<{ email: string; role: 'admin' | 'superadmin' | null }> {
    try {
      const b = await handle(await fetch('/api/admin/me', { headers: await authHeader() }));
      return { email: b.user.email, role: 'superadmin' };
    } catch {
      /* no es superadmin */
    }
    const b = await handle(await fetch('/api/me/profile', { headers: await authHeader() }));
    return { email: b.user.email, role: b.user.role || 'admin' };
  },

  // ----- Admin (auto-servicio) -----
  me: {
    async profile(): Promise<{ user: any; person: Person | null; linked: boolean }> {
      return handle(await fetch('/api/me/profile', { headers: await authHeader() }));
    },
    async calls(filters: Filters = {}): Promise<Call[]> {
      const b = await handle(await fetch(`/api/me/calls?${qs(filters)}`, { headers: await authHeader() }));
      return b.calls;
    },
    async stats(period?: string): Promise<{ periodKey: string; resetPeriodMonths: number; stats: StatsBreakdown }> {
      return handle(await fetch(`/api/me/stats?${qs({ period })}`, { headers: await authHeader() }));
    },
    async claims(): Promise<Claim[]> {
      const b = await handle(await fetch('/api/me/claims', { headers: await authHeader() }));
      return b.claims;
    },
    async createClaim(callId: string, justification: string): Promise<Claim> {
      const b = await handle(
        await fetch('/api/me/claims', {
          method: 'POST',
          headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
          body: JSON.stringify({ callId, justification })
        })
      );
      return b.claim;
    }
  },

  // ----- Superadmin -----
  admin: {
    async calls(filters: Filters = {}): Promise<Call[]> {
      const b = await handle(await fetch(`/api/admin/calls?${qs(filters)}`, { headers: await authHeader() }));
      return b.calls;
    },
    async call(id: string): Promise<Call> {
      const b = await handle(await fetch(`/api/admin/calls/${encodeURIComponent(id)}`, { headers: await authHeader() }));
      return b.call;
    },
    async annul(id: string, reason: string): Promise<void> {
      await handle(
        await fetch(`/api/admin/calls/${encodeURIComponent(id)}`, {
          method: 'DELETE',
          headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason })
        })
      );
    },
    async claims(status?: ClaimStatus): Promise<Claim[]> {
      const b = await handle(await fetch(`/api/admin/claims?${qs({ status })}`, { headers: await authHeader() }));
      return b.claims;
    },
    async resolveClaim(id: string, decision: 'accepted' | 'rejected', message: string): Promise<Claim> {
      const b = await handle(
        await fetch(`/api/admin/claims/${encodeURIComponent(id)}/resolve`, {
          method: 'POST',
          headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
          body: JSON.stringify({ decision, message })
        })
      );
      return b.claim;
    },
    async stats(period?: string): Promise<{ periodKey: string; resetPeriodMonths: number; stats: StatsBreakdown & { byPerson: Record<string, StatsBreakdown> } }> {
      return handle(await fetch(`/api/admin/stats?${qs({ period })}`, { headers: await authHeader() }));
    },
    async logs(filters: Filters = {}): Promise<SystemLog[]> {
      const b = await handle(await fetch(`/api/admin/logs?${qs(filters)}`, { headers: await authHeader() }));
      return b.logs;
    },
    async people(): Promise<Person[]> {
      const b = await handle(await fetch('/api/admin/people', { headers: await authHeader() }));
      return b.people;
    },
    async savePerson(p: Person): Promise<Person> {
      const b = await handle(
        await fetch(`/api/admin/people/${encodeURIComponent(p.person_key)}`, {
          method: 'PUT',
          headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
          body: JSON.stringify(p)
        })
      );
      return b.person;
    },
    async deletePerson(key: string): Promise<void> {
      await handle(await fetch(`/api/admin/people/${encodeURIComponent(key)}`, { method: 'DELETE', headers: await authHeader() }));
    },
    async config(): Promise<Settings> {
      const b = await handle(await fetch('/api/admin/config', { headers: await authHeader() }));
      return b.settings;
    },
    async saveConfig(patch: Partial<Settings>): Promise<Settings> {
      const b = await handle(
        await fetch('/api/admin/config', {
          method: 'PATCH',
          headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
          body: JSON.stringify(patch)
        })
      );
      return b.settings;
    },
    async liveVerify(): Promise<any> {
      return handle(await fetch('/api/admin/live-verify', { method: 'POST', headers: await authHeader() }));
    }
  }
};

/** Link para escribir por Slack a una persona (abre DM). */
export function slackDmLink(slackUserId: string): string {
  return `https://slack.com/app_redirect?channel=${encodeURIComponent(slackUserId)}`;
}
