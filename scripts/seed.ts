/**
 * Seed idempotente. Poblarlo NO es obligatorio para desplegar (el sistema
 * arranca con base vacia usando defaults), pero deja las 5 personas del equipo
 * y la config inicial listas.
 *
 * Uso:
 *   FIREBASE_PROJECT_ID=... npm run seed            # contra Firestore real (ADC)
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 npm run seed   # contra el emulador
 *
 * Flags:
 *   --people-only   solo personas
 *   --config-only   solo config
 *   --force         sobreescribe config aunque ya exista
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { db } from '../src/firebase.js';
import { upsertPerson } from '../src/services/people.js';
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
      await upsertPerson(db(), p);
      console.log(`  persona: ${p.person_key} (${p.nombre_visible})`);
    }
    console.log(`Personas cargadas: ${people.length}`);
  }

  if (!peopleOnly) {
    const config = JSON.parse(readFileSync(join(seedsDir, 'config.json'), 'utf8')) as Settings;
    const ref = db().doc('config/settings');
    const existing = await ref.get();
    if (existing.exists && !force) {
      console.log('config/settings ya existe (usa --force para sobreescribir). Omitido.');
    } else {
      await ref.set({ ...config, updatedBy: 'seed', updatedAt: new Date() }, { merge: true });
      console.log('config/settings escrito.');
    }
  }

  console.log('Seed completo.');
}

main().catch((e) => {
  console.error('Seed fallo:', e);
  process.exit(1);
});
