/**
 * Config del cliente Firebase (solo Auth). Estos valores NO son secretos: son
 * la config publica del proyecto. Se leen de variables VITE_* en build.
 *
 * Copia web/.env.example a web/.env y completa con los datos de tu proyecto
 * (Configuracion del proyecto -> Tus apps -> SDK de configuracion).
 */
import { initializeApp } from 'firebase/app';
import { getAuth, setPersistence, browserLocalPersistence } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
setPersistence(auth, browserLocalPersistence).catch(() => {});
