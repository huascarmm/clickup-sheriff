/**
 * LLA-14 y LLA-15 — Personas (tabla people, la que reemplazo a config_personas).
 *
 *   LLA-14  GET /api/admin/people        ver las personas registradas
 *   LLA-15  PUT /api/admin/people/:key   agregar o actualizar una persona
 *
 * Es la configuracion de la que dependen las reglas (resolver el assignee o el
 * campo QA de ClickUp a una persona real), asi que solo el superadmin la toca.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { RowDataPacket } from 'mysql2/promise';
import { testDb, clearAll, isMysqlUp } from '../helpers.js';
import { bearer, logsOfKind, makePanelApp, seedPerson, systemErrors } from '../support/panel.js';

vi.mock('../../src/firebase.js', () => import('../support/firebaseMock.js'));

let app: any;
let mysqlUp = true;

const SUPER = () => bearer('superadmin', 'boss@x.com');
const JOSE = () => bearer('admin', 'jose@x.com');

beforeAll(async () => {
  mysqlUp = await isMysqlUp();
  if (!mysqlUp) console.warn('\n[SKIP] MySQL no disponible.\n');
  app = await makePanelApp();
});

beforeEach(async () => {
  if (!mysqlUp) return;
  await clearAll();
  await seedPerson({ person_key: 'Jose', nombre_visible: 'Jose Perez', login_email: 'jose@x.com' });
  await seedPerson({ person_key: 'Mel', nombre_visible: 'Melissa', login_email: 'mel@x.com', activo: false });
});

async function peopleRows(): Promise<RowDataPacket[]> {
  const [rows] = await testDb().query<RowDataPacket[]>('SELECT * FROM people ORDER BY person_key');
  return rows;
}

describe('LLA-14 ver personas', () => {
  it('LLA-14 el superadmin ve las personas registradas, activas e inactivas', async () => {
    if (!mysqlUp) return;
    const res = await request(app).get('/api/admin/people').set('Authorization', SUPER());

    expect(res.status).toBe(200);
    expect(res.body.people.map((p: any) => p.person_key).sort()).toEqual(['Jose', 'Mel']);
    const mel = res.body.people.find((p: any) => p.person_key === 'Mel');
    expect(mel.activo).toBe(false);
    expect(mel.nombre_visible).toBe('Melissa');
  });

  it('LLA-14 un admin no puede ver la lista de personas (403)', async () => {
    if (!mysqlUp) return;
    const res = await request(app).get('/api/admin/people').set('Authorization', JOSE());
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('insufficient_role');
  });
});

describe('LLA-15 agregar personas', () => {
  it('LLA-15 el superadmin agrega una persona y queda registrada en la base', async () => {
    if (!mysqlUp) return;
    const res = await request(app)
      .put('/api/admin/people/Ana')
      .set('Authorization', SUPER())
      .send({
        nombre_visible: 'Ana Torres',
        qa_string: 'Ana;Anita',
        clickup_username: 'ana',
        login_email: 'ana@x.com',
        slack_user_id: 'UANA',
        activo: true
      });

    expect(res.status).toBe(200);
    expect(res.body.person.person_key).toBe('Ana');

    const filas = await peopleRows();
    expect(filas.map((p) => p.person_key)).toEqual(['Ana', 'Jose', 'Mel']);
    const ana = filas.find((p) => p.person_key === 'Ana')!;
    expect(ana.nombre_visible).toBe('Ana Torres');
    expect(ana.qa_string).toBe('Ana;Anita');
    expect(ana.slack_user_id).toBe('UANA');
    expect(!!ana.activo).toBe(true);
  });

  it('LLA-15 guardar la misma clave actualiza los datos en vez de duplicar la persona', async () => {
    if (!mysqlUp) return;
    const res = await request(app)
      .put('/api/admin/people/Jose')
      .set('Authorization', SUPER())
      .send({ nombre_visible: 'Jose Perez Lopez', login_email: 'jose@x.com', activo: false });

    expect(res.status).toBe(200);
    const filas = await peopleRows();
    expect(filas.length).toBe(2); // sigue habiendo dos personas
    const jose = filas.find((p) => p.person_key === 'Jose')!;
    expect(jose.nombre_visible).toBe('Jose Perez Lopez');
    expect(!!jose.activo).toBe(false);
  });

  it('LLA-15 normaliza el correo de login a minusculas y recorta los espacios', async () => {
    if (!mysqlUp) return;
    const res = await request(app)
      .put('/api/admin/people/Ana')
      .set('Authorization', SUPER())
      .send({ nombre_visible: '  Ana Torres  ', login_email: '  ANA@X.COM  ' });

    expect(res.body.person.login_email).toBe('ana@x.com');
    expect(res.body.person.nombre_visible).toBe('Ana Torres');

    const ana = (await peopleRows()).find((p) => p.person_key === 'Ana')!;
    expect(ana.login_email).toBe('ana@x.com');
  });

  it('LLA-15 rechaza una clave de persona vacia', async () => {
    if (!mysqlUp) return;
    const res = await request(app)
      .put('/api/admin/people/%20')
      .set('Authorization', SUPER())
      .send({ nombre_visible: 'Sin clave' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('person_key');
    expect((await peopleRows()).length).toBe(2);
  });

  it('LLA-15 rechaza datos invalidos para la base y deja el log de la falla', async () => {
    if (!mysqlUp) return;
    const res = await request(app)
      .put('/api/admin/people/Ana')
      .set('Authorization', SUPER())
      .send({ nombre_visible: 'x'.repeat(300) }); // no cabe en la columna

    expect(res.status).toBe(400);
    expect((await peopleRows()).length).toBe(2); // no se guardo nada

    const logs = await logsOfKind('person_save_failed');
    expect(logs.length).toBe(1);
    expect(logs[0].severity).toBe('error');
    expect(logs[0].action).toBe('save_person');
    expect(JSON.stringify(logs[0].context)).toContain('Ana');
    expect((await systemErrors()).length).toBe(1);
  });

  it('LLA-15 solo el superadmin puede agregar personas (403)', async () => {
    if (!mysqlUp) return;
    const res = await request(app)
      .put('/api/admin/people/Ana')
      .set('Authorization', JOSE())
      .send({ nombre_visible: 'Ana Torres' });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('insufficient_role');
    expect((await peopleRows()).length).toBe(2);
  });
});
