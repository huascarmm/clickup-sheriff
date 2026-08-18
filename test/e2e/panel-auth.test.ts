/**
 * LLA-01 — Inicio de sesion con Google.
 *
 * El login en si ocurre en el navegador (Firebase Auth + Google). Lo que puede y
 * debe probarse en el backend es lo que llega despues: el ID token, la allowlist
 * de correos (ADMIN_EMAILS) y el custom claim de rol. Se cubren los cuatro
 * caminos de la matriz: login exitoso, login cancelado (nunca llega token),
 * correo sin acceso al panel y correo sin rol de Firebase.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { clearAll, isMysqlUp } from '../helpers.js';
import { ADMIN_EMAILS, bearer, makePanelApp, seedPerson } from '../support/panel.js';

vi.mock('../../src/firebase.js', () => import('../support/firebaseMock.js'));

let app: any;
let mysqlUp = true;

beforeAll(async () => {
  mysqlUp = await isMysqlUp();
  if (!mysqlUp) console.warn('\n[SKIP] MySQL no disponible.\n');
  app = await makePanelApp();
});

beforeEach(async () => {
  if (!mysqlUp) return;
  await clearAll();
  await seedPerson({ person_key: 'Jose', login_email: 'jose@x.com' });
});

describe('LLA-01 inicio de sesion con Google', () => {
  it('LLA-01 login exitoso: un superadmin obtiene su correo y su rol', async () => {
    if (!mysqlUp) return;
    const res = await request(app).get('/api/admin/me').set('Authorization', bearer('superadmin', 'boss@x.com'));
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: 'boss@x.com', role: 'superadmin' });
  });

  it('LLA-01 login exitoso: un admin obtiene su perfil con su persona vinculada', async () => {
    if (!mysqlUp) return;
    const res = await request(app).get('/api/me/profile').set('Authorization', bearer('admin', 'jose@x.com'));
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: 'jose@x.com', role: 'admin' });
    expect(res.body.linked).toBe(true);
    expect(res.body.person.person_key).toBe('Jose');
  });

  it('LLA-01 login exitoso pero sin persona en people: entra al panel sin vinculo', async () => {
    if (!mysqlUp) return;
    const res = await request(app).get('/api/me/profile').set('Authorization', bearer('admin', 'mel@x.com'));
    expect(res.status).toBe(200);
    expect(res.body.linked).toBe(false);
    expect(res.body.person).toBeNull();
  });

  it('LLA-01 login cancelado por el usuario: sin token la API responde 401 no_token', async () => {
    const res = await request(app).get('/api/admin/calls');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('no_token');
  });

  it('LLA-01 token invalido (login fallido) responde 401 bad_token', async () => {
    const res = await request(app).get('/api/admin/me').set('Authorization', bearer('bad', 'boss@x.com'));
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('bad_token');
  });

  it('LLA-01 correo sin acceso al panel (fuera de la allowlist) responde 403 forbidden', async () => {
    if (!mysqlUp) return;
    expect(ADMIN_EMAILS).not.toContain('ajeno@x.com');
    const res = await request(app).get('/api/admin/me').set('Authorization', bearer('superadmin', 'ajeno@x.com'));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('forbidden');
  });

  it('LLA-01 correo sin rol de Firebase responde 403 no_role', async () => {
    if (!mysqlUp) return;
    const res = await request(app).get('/api/me/profile').set('Authorization', bearer('none', 'jose@x.com'));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('no_role');
  });

  it('LLA-01 un admin no alcanza las rutas de superadmin (403 insufficient_role)', async () => {
    if (!mysqlUp) return;
    const res = await request(app).get('/api/admin/me').set('Authorization', bearer('admin', 'jose@x.com'));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('insufficient_role');
  });
});
