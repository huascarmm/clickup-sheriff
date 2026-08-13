/**
 * Seed idempotente. Poblarlo NO es obligatorio para desplegar (el sistema
 * arranca con base vacia usando defaults), pero deja las 5 personas del equipo
 * y la config inicial listas.
 *
 * Uso:
 *   MYSQL_HOST=... MYSQL_USER=... MYSQL_PASSWORD=... MYSQL_DATABASE=... npm run seed
 *
 * Flags:
 *   --people-only   solo personas
 *   --config-only   solo config
 *   --force         sobreescribe config aunque ya exista
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { RowDataPacket } from 'mysql2/promise';
import { pool } from '../src/db.js';
import { upsertPerson } from '../src/services/people.js';
import { saveSettings } from '../src/config.js';
import type { Person, Settings } from '../src/domain/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const seedsDir = join(__dirname, '..', 'seeds');

async function main() {
  const args = new Set(process.argv.slice(2));
  const peopleOnly = args.has('--people-only');
  const configOnly = args.has('--config-only');
  const force = args.has('--force');

  if (!configOnly) {
    const people = JSON.parse(readFileSync(join(seedsDir, 'people.json'), 'utf8')) as Person[];
    for (const p of people) {
      await upsertPerson(pool(), p);
      console.log(`  persona: ${p.person_key} (${p.nombre_visible})`);
    }
    console.log(`Personas cargadas: ${people.length}`);
  }

  if (!peopleOnly) {
    const config = JSON.parse(readFileSync(join(seedsDir, 'config.json'), 'utf8')) as Settings;
    const [existing] = await pool().query<RowDataPacket[]>('SELECT id FROM settings WHERE id = 1');
    if (existing.length && !force) {
      console.log('settings ya existe (usa --force para sobreescribir). Omitido.');
    } else {
      await saveSettings(config, 'seed');
      console.log('settings escrito.');
    }
  }

  console.log('Seed completo.');
  await pool().end();
}

main().catch((e) => {
  console.error('Seed fallo:', e);
  process.exit(1);
});
