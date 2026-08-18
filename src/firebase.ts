/**
 * Inicializacion de firebase-admin, SOLO para Auth (roles/permisos siguen en
 * Firebase Auth via custom claims). Los datos de negocio viven en MySQL
 * (src/db.ts) desde la migracion fuera de Firestore.
 * - En Cloud Run usa Application Default Credentials (ADC), sin claves en disco.
 */
import { initializeApp, getApps, cert, applicationDefault } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { readFileSync } from 'node:fs';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;

let _auth: Auth | null = null;

function ensureApp() {
  if (getApps().length) return;

  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (keyPath) {
    const credentials = JSON.parse(readFileSync(keyPath, 'utf8'));
    initializeApp({ credential: cert(credentials), projectId: PROJECT_ID });
  } else {
    initializeApp({ credential: applicationDefault(), projectId: PROJECT_ID });
  }
}

export function auth(): Auth {
  if (_auth) return _auth;
  ensureApp();
  _auth = getAuth();
  return _auth;
}

export { PROJECT_ID };
