/**
 * Asigna roles (custom claims) a usuarios de Firebase Auth ya creados en la
 * consola. Los usuarios se crean manualmente; este script solo les pone el rol.
 *
 * Uso:
 *   npm run set-claims -- correo@empresa.com superadmin
 *   npm run set-claims -- otro@empresa.com admin
 *   npm run set-claims -- correo@empresa.com none    # quita el rol
 *
 * Requiere ADC (o GOOGLE_APPLICATION_CREDENTIALS) con permiso sobre Auth.
 */
import { auth } from '../src/firebase.js';

async function main() {
  const [email, role] = process.argv.slice(2);
  if (!email || !role) {
    console.error('Uso: npm run set-claims -- <email> <admin|superadmin|none>');
    process.exit(1);
  }
  if (!['admin', 'superadmin', 'none'].includes(role)) {
    console.error('Rol invalido. Usa: admin | superadmin | none');
    process.exit(1);
  }

  const user = await auth().getUserByEmail(email);
  const claims = role === 'none' ? {} : { role };
  await auth().setCustomUserClaims(user.uid, claims);
  console.log(`OK: ${email} -> role=${role === 'none' ? '(ninguno)' : role}`);
  console.log('El usuario debe cerrar sesion y volver a entrar para refrescar el token.');
}

main().catch((e) => {
  console.error('Fallo:', e.message);
  process.exit(1);
});
