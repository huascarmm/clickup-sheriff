/**
 * Autenticacion compartida por los webhooks: header "X-Webhook-Secret"
 * (recomendado) o parametro ?secret= en la URL (compatibilidad con
 * configuraciones previas). Si llegan ambos, manda el header.
 */
import type { Request } from 'express';

export function hasValidWebhookSecret(req: Request, webhookSecret: string): boolean {
  const headerSecret = (req.headers['x-webhook-secret'] as string) || '';
  const receivedSecret = headerSecret || (req.query.secret as string) || '';
  return !!webhookSecret && receivedSecret === webhookSecret;
}
