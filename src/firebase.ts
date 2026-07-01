/**
 * Inicializacion de firebase-admin.
 * - En Cloud Run usa Application Default Credentials (ADC), sin claves en disco.
 * - Apunta a la base Firestore CON NOMBRE: llamadas_atencion (no la (default)).
 * - En tests/local respeta FIRESTORE_EMULATOR_HOST automaticamente.
 */
import { initializeApp, getApps, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { readFileSync } from 'node:fs';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || 'llamadas_atencion';

let _db: Firestore | null = null;
let _auth: Auth | null = null;

function ensureApp() {
  if (getApps().length) return;

  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (keyPath && !process.env.FIRESTORE_EMULATOR_HOST) {
    const credentials = JSON.parse(readFileSync(keyPath, 'utf8'));
    initializeApp({ credential: cert(credentials), projectId: PROJECT_ID });
  } else if (process.env.FIRESTORE_EMULATOR_HOST) {
    // Con el emulador no hacen falta credenciales reales.
    initializeApp({ projectId: PROJECT_ID || 'demo-llamadas' });
  } else {
    initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  }
}

export function db(): Firestore {
  if (_db) return _db;
  ensureApp();
  _db = getFirestore(DATABASE_ID);
  return _db;
}

export function auth(): Auth {
  if (_auth) return _auth;
  ensureApp();
  _auth = getAuth();
  return _auth;
}

export { DATABASE_ID, PROJECT_ID };
