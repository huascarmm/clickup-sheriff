/**
 * Utilidades compartidas por los tests de integracion/e2e.
 * Conectan a la BASE CON NOMBRE (llamadas-atencion) del emulador de Firestore.
 *
 * Requiere el emulador corriendo:
 *   firebase emulators:start --only firestore
 * o el script npm run emulator del README.
 */
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

export const TEST_PROJECT = 'demo-llamadas';
export const TEST_DB = 'llamadas-atencion';

process.env.FIREBASE_PROJECT_ID = TEST_PROJECT;
process.env.FIRESTORE_DATABASE_ID = TEST_DB;
if (!process.env.FIRESTORE_EMULATOR_HOST) {
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080';
}

let _db: Firestore | null = null;

export function testDb(): Firestore {
  if (_db) return _db;
  if (!getApps().length) initializeApp({ projectId: TEST_PROJECT });
  _db = getFirestore(TEST_DB);
  return _db;
}

/** Borra una coleccion completa (para aislar tests). */
export async function clearCollection(name: string): Promise<void> {
  const db = testDb();
  const snap = await db.collection(name).get();
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

export async function clearAll(): Promise<void> {
  await Promise.all([
    clearCollection('attention_calls'),
    clearCollection('people'),
    clearCollection('audit_log'),
    clearCollection('system_errors')
  ]);
  // config/settings
  await testDb().doc('config/settings').delete().catch(() => {});
}

/**
 * Detecta si el emulador esta disponible SIN colgarse: si no responde en unos
 * segundos, asumimos que no esta y los tests se saltan.
 */
export async function isEmulatorUp(timeoutMs = 3000): Promise<boolean> {
  const ping = testDb()
    .doc('__ping__/x')
    .get()
    .then(() => true)
    .catch(() => false);
  const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs));
  return Promise.race([ping, timeout]);
}
