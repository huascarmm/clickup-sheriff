/** Entrypoint de Cloud Run. */
import { createApp } from './app.js';
import { loadSecrets } from './config.js';
import { logger } from './logger.js';

const secrets = loadSecrets();
const app = createApp(secrets);

app.listen(secrets.port, () => {
  logger.info('server_started', { port: secrets.port });
});
