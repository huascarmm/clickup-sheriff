/**
 * Reemplazo de src/firebase.ts para los tests del panel.
 *
 * El login real es Google + Firebase Auth: el panel manda un ID token y el
 * middleware lo verifica y lee el custom claim de rol. Aqui el "token" es texto
 * plano con la forma "<rol>:<correo>", que basta para reproducir los cuatro
 * caminos que le importan a la matriz:
 *
 *   superadmin:boss@x.com  -> login exitoso con rol de superadmin
 *   admin:jose@x.com       -> login exitoso con rol de admin
 *   none:otro@x.com        -> token valido pero SIN claim de rol
 *   bad:quien@x.com        -> token invalido (verifyIdToken lanza)
 */
import type { Auth } from 'firebase-admin/auth';

export const PROJECT_ID = 'test-project';

export type FakeRole = 'superadmin' | 'admin' | 'none' | 'bad';

/** Arma el valor del header Authorization para un rol y correo dados. */
export function bearer(role: FakeRole, email: string): string {
  return `Bearer ${role}:${email}`;
}

export function auth(): Auth {
  const fake = {
    async verifyIdToken(token: string) {
      const [role, email = ''] = String(token).split(':');
      if (role === 'bad') throw new Error('Firebase ID token has invalid signature');
      const decoded: Record<string, unknown> = { uid: `uid_${email}`, email };
      // 'none' simula al usuario que entra con Google pero al que nadie le
      // asigno rol todavia (scripts/set-claims.ts).
      if (role === 'superadmin' || role === 'admin') decoded.role = role;
      return decoded;
    }
  };
  return fake as unknown as Auth;
}
