/**
 * Cliente de Slack. Conserva la logica original: resolver el canal por nombre
 * si no hay ID, mencion por slack_user_id, escape de texto y el formato exacto
 * de los mensajes de aviso/llamada de atencion.
 */
import type { AttentionCall, Person } from '../domain/types.js';

export interface SlackPostResult {
  ok: boolean;
  ts: string;
  error: string;
}

export class SlackService {
  constructor(private token: string) {}

  async postMessage(channelId: string, text: string): Promise<SlackPostResult> {
    if (!this.token) throw new Error('Falta configurar SLACK_BOT_TOKEN.');
    if (!channelId) throw new Error('No se pudo obtener SLACK_CHANNEL_ID.');

    const res = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ channel: channelId, text, unfurl_links: false, unfurl_media: false })
    });
    const bodyText = await res.text();
    const body = JSON.parse(bodyText || '{}');
    if (!res.ok || !body.ok) {
      throw new Error(`Error Slack chat.postMessage. Status: ${res.status}. Body: ${bodyText}`);
    }
    return { ok: true, ts: body.ts || '', error: '' };
  }

  /** Borra un mensaje (limpieza tras la verificacion en vivo). */
  async deleteMessage(channelId: string, ts: string): Promise<void> {
    if (!ts) return;
    const res = await fetch('https://slack.com/api/chat.delete', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: channelId, ts })
    });
    const body = JSON.parse((await res.text()) || '{}');
    if (!res.ok || !body.ok) {
      throw new Error(`Error Slack chat.delete: ${body.error || res.status}`);
    }
  }

  /** Resuelve el ID de un canal por su nombre (paginado). */
  async resolveChannelId(channelName: string): Promise<string> {
    const clean = String(channelName || '').replace('#', '').trim();
    if (!clean) throw new Error('Falta configurar SLACK_CHANNEL_NAME o SLACK_CHANNEL_ID.');

    let cursor = '';
    do {
      const query = new URLSearchParams({
        exclude_archived: 'true',
        types: 'public_channel,private_channel',
        limit: '1000'
      });
      if (cursor) query.set('cursor', cursor);

      const res = await fetch(`https://slack.com/api/conversations.list?${query.toString()}`, {
        headers: { Authorization: `Bearer ${this.token}` }
      });
      const text = await res.text();
      const body = JSON.parse(text || '{}');
      if (!res.ok || !body.ok) {
        throw new Error(`Error Slack conversations.list. Status: ${res.status}. Body: ${text}`);
      }
      const found = (body.channels || []).find(
        (c: { name: string }) => normalizeName(c.name) === normalizeName(clean)
      );
      if (found) return found.id;
      cursor = body.response_metadata?.next_cursor || '';
    } while (cursor);

    throw new Error(`No se encontro el canal Slack con nombre: ${clean}`);
  }
}

function normalizeName(v: string): string {
  return String(v || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

export function cleanSlackUserId(value: string): string {
  return String(value || '').replace('<@', '').replace('>', '').trim();
}

export function escapeSlackText(value: string): string {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function slackPersonMention(person: Person): string {
  const id = cleanSlackUserId(person.slack_user_id || '');
  if (id) return `<@${id}>`;
  return escapeSlackText(person.nombre_visible || person.person_key || 'persona no configurada');
}

/**
 * Construye el texto del mensaje. Mismo formato que el original.
 * Recibe los campos ya calculados (tolerancia, contador trimestral).
 */
export function buildSlackMessage(input: {
  person: Person;
  taskUrl: string;
  taskName: string;
  alertType: AttentionCall['alertType'];
  reason: string;
  tolerance: string;
  isTolerance: boolean;
  periodAttentionCountAfter: number | null;
}): string {
  const personMention = slackPersonMention(input.person);
  const taskName = escapeSlackText(input.taskName || 'Tarea');
  const taskLink = `<${input.taskUrl}|${taskName}>`;

  let baseReason: string;
  if (input.alertType === 'QA_36H') baseReason = 'tarea con mas de 36 horas en estado QA';
  else if (input.alertType === 'FIXING_QA_36H') baseReason = 'tarea con mas de 36 horas en estado FIXING QA';
  else if (input.alertType === 'ATRASO_PLAZO') baseReason = 'tarea atrasada por vencimiento del plazo';
  else baseReason = input.reason || 'falta registrada';

  if (input.isTolerance) {
    return `🟡 Aviso de tolerancia (${input.tolerance}) para ${personMention}: ${baseReason}: ${taskLink}`;
  }
  return `⚠️ Llamada de atencion #${input.periodAttentionCountAfter} del periodo a ${personMention}: ${baseReason}. ${taskLink}`;
}
