/**
 * Cliente de la API del panel. Adjunta el ID token de Firebase en cada request.
 * El panel llama a /api/admin/* (mismo origen: Firebase Hosting reescribe /api
 * hacia el servicio de Cloud Run).
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
    const msg = body.error || `Error ${res.status}`;
    throw new Error(mapError(msg));
  }
  return body;
}

function mapError(code: string): string {
  const map: Record<string, string> = {
    forbidden: 'Tu correo no esta autorizado para este panel.',
    no_role: 'Tu cuenta no tiene un rol asignado. Pide a un superadmin que te lo asigne.',
    insufficient_role: 'Necesitas rol de superadmin para esta accion.',
    reason_required: 'Debes indicar un motivo.',
    not_found: 'No se encontro el registro.',
    bad_token: 'Tu sesion expiro. Vuelve a entrar.',
    no_token: 'Tu sesion expiro. Vuelve a entrar.'
  };
  return map[code] || code;
}

export interface Call {
  id: string;
  timestampLocal: string;
  timestampMs: number;
  dateKey: string;
  taskId: string;
  taskName: string;
  taskUrl: string;
  currentStatus: string;
  alertType: 'QA_36H' | 'FIXING_QA_36H' | 'ATRASO_PLAZO';
  personKey: string;
  personName: string;
  reason: string;
  hoursElapsed: number;
  dueDateLocal: string;
  statusChangeLocal: string;
  tolerance: string;
  isTolerance: boolean;
  weeklyCountAfter: number;
  quarterlyAttentionCountAfter: number | null;
  slackOk: boolean;
  slackError: string;
  message: string;
  deleted: boolean;
  deletedBy?: string;
  deletedReason?: string;
}

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
  plazoHourDefault: number;
  plazoMinuteDefault: number;
  plazoFieldName: string;
  plazoFieldId: string;
}

const BASE = '/api/admin';

export const api = {
  async me(): Promise<{ email: string; uid: string; role: 'admin' | 'superadmin' | null }> {
    const b = await handle(await fetch(`${BASE}/me`, { headers: await authHeader() }));
    return b.user;
  },

  async listCalls(params: Record<string, string> = {}): Promise<Call[]> {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
    const b = await handle(await fetch(`${BASE}/calls?${q}`, { headers: await authHeader() }));
    return b.calls;
  },

  async getCall(id: string): Promise<Call> {
    const b = await handle(await fetch(`${BASE}/calls/${encodeURIComponent(id)}`, { headers: await authHeader() }));
    return b.call;
  },

  async stats(): Promise<Record<string, any>> {
    const b = await handle(await fetch(`${BASE}/stats`, { headers: await authHeader() }));
    return b.stats;
  },

  async deleteCall(id: string, reason: string): Promise<void> {
    await handle(
      await fetch(`${BASE}/calls/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason })
      })
    );
  },

  async audit(): Promise<any[]> {
    const b = await handle(await fetch(`${BASE}/audit`, { headers: await authHeader() }));
    return b.entries;
  },

  async listPeople(): Promise<Person[]> {
    const b = await handle(await fetch(`${BASE}/people`, { headers: await authHeader() }));
    return b.people;
  },

  async savePerson(p: Person): Promise<Person> {
    const b = await handle(
      await fetch(`${BASE}/people/${encodeURIComponent(p.person_key)}`, {
        method: 'PUT',
        headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
        body: JSON.stringify(p)
      })
    );
    return b.person;
  },

  async deletePerson(key: string): Promise<void> {
    await handle(
      await fetch(`${BASE}/people/${encodeURIComponent(key)}`, {
        method: 'DELETE',
        headers: await authHeader()
      })
    );
  },

  async getConfig(): Promise<Settings> {
    const b = await handle(await fetch(`${BASE}/config`, { headers: await authHeader() }));
    return b.settings;
  },

  async saveConfig(patch: Partial<Settings>): Promise<Settings> {
    const b = await handle(
      await fetch(`${BASE}/config`, {
        method: 'PATCH',
        headers: { ...(await authHeader()), 'Content-Type': 'application/json' },
        body: JSON.stringify(patch)
      })
    );
    return b.settings;
  }
};
