/**
 * Fabrica de la app Express. Separada del server para poder montarla en tests
 * (supertest) sin levantar un puerto.
 */
import express, { type Express } from 'express';
import { loadSecrets, type Secrets } from './config.js';
import { makeRequireAuth } from './middleware/auth.js';
import { rateLimit } from './middleware/rateLimit.js';
import { makeWebhookRouter } from './webhooks/clickup.js';
import { makeAdminRouter } from './admin/routes.js';
import { makeMeRouter } from './me/routes.js';
import { makeInternalRouter } from './internal/routes.js';

export function createApp(secretsOverride?: Secrets): Express {
  const secrets = secretsOverride || loadSecrets();
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));

  // CORS solo si el panel corre en otro origen sin rewrite de Firebase Hosting.
  app.use((req, res, next) => {
    if (secrets.allowedOrigin) {
      res.set('Access-Control-Allow-Origin', secrets.allowedOrigin);
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
      if (req.method === 'OPTIONS') return res.status(204).end();
    }
    next();
  });

  // Salud (Cloud Run / uptime checks).
  app.get('/health', (_req, res) => res.json({ ok: true }));

  // Webhooks de ClickUp (auth por secret, con rate limit).
  app.use('/webhooks', rateLimit, makeWebhookRouter(secrets));

  // Rutas internas para Cloud Scheduler (auth por secret).
  app.use('/internal', makeInternalRouter(secrets));

  // API del panel (auth por ID token de Firebase + roles).
  const requireAuth = makeRequireAuth(secrets.adminEmails);
  app.use('/api/me', requireAuth, makeMeRouter());
  app.use('/api/admin', requireAuth, makeAdminRouter(secrets));

  return app;
}
