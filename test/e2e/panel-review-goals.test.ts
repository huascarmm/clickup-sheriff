/**
 * Panel de revisor: metas por proyecto.
 *
 *   POST /webhooks/goals      recibe la lista completa (secret + rate limit)
 *   GET  /api/review/goals    la muestra a cualquier rol con sesion
 *
 * Se prueba el webhook (auth, validacion, reemplazo por snapshot) y la lectura
 * (proteccion por rol, agrupacion por proyecto, orden, avance y plazo terminado).
 * Que una meta con plazo terminado cuente como "vencida" depende del umbral de
 * avance, que solo vive en el panel: el servidor no lo conoce.
 * Requiere MySQL (ver test/helpers.ts).
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import type { RowDataPacket } from 'mysql2/promise';
import { testDb, clearAll, isMysqlUp } from '../helpers.js';
import { bearer, logsOfKind, makePanelApp, seedPerson, WEBHOOK_SECRET } from '../support/panel.js';

vi.mock('../../src/firebase.js', () => import('../support/firebaseMock.js'));

let app: any;
let mysqlUp = true;

// Fechas lejanas para que "vencida" no dependa del dia en que corre el test.
const PAST = '2000-01-15';
const FUTURE = '2999-12-31';

beforeAll(async () => {
  mysqlUp = await isMysqlUp();
  if (!mysqlUp) console.warn('\n[SKIP] MySQL no disponible.\n');
  app = await makePanelApp();
});

beforeEach(async () => {
  if (!mysqlUp) return;
  await clearAll();
  await seedPerson({ person_key: 'Jose', nombre_visible: 'Jose Perez', login_email: 'jose@x.com' });
});

function postGoals(body: unknown, secret: string | null = WEBHOOK_SECRET) {
  const req = request(app).post('/webhooks/goals');
  if (secret !== null) req.set('X-Webhook-Secret', secret);
  return req.send(body as object);
}

const PAYLOAD = {
  projects: [
    {
      name: 'Portal clientes',
      goals: [
        { name: 'Pagos en linea', dueDate: FUTURE, completed: 0 },
        { name: 'MVP en staging', dueDate: PAST, completed: 26.5, personKey: 'Jose' }
      ]
    },
    { name: 'App movil', goals: [{ name: 'Beta cerrada', dueDate: FUTURE, personKey: 'desconocido' }] }
  ]
};

describe('POST /webhooks/goals', () => {
  it('rechaza sin secret o con secret incorrecto', async () => {
    if (!mysqlUp) return;
    expect((await postGoals(PAYLOAD, null)).status).toBe(401);
    expect((await postGoals(PAYLOAD, 'otro')).status).toBe(401);
    const [rows] = await testDb().query<RowDataPacket[]>('SELECT * FROM review_projects');
    expect(rows.length).toBe(0);
  });

  it('acepta el secret por ?secret= (igual que el webhook de ClickUp)', async () => {
    if (!mysqlUp) return;
    const res = await request(app).post(`/webhooks/goals?secret=${WEBHOOK_SECRET}`).send(PAYLOAD);
    expect(res.status).toBe(200);
  });

  it('guarda proyectos y metas y deja constancia en el panel de salud', async () => {
    if (!mysqlUp) return;
    const res = await postGoals(PAYLOAD);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, projects: 2, goals: 3 });

    const [goals] = await testDb().query<RowDataPacket[]>(
      "SELECT name, DATE_FORMAT(due_date, '%Y-%m-%d') AS due_date, completed, person_key FROM review_goals ORDER BY name"
    );
    expect(goals.map((g) => [g.name, g.due_date, g.completed, g.person_key])).toEqual([
      ['Beta cerrada', FUTURE, null, 'desconocido'],
      ['MVP en staging', PAST, '26.50', 'Jose'],
      ['Pagos en linea', FUTURE, '0.00', null]
    ]);
    expect((await logsOfKind('goals_received')).length).toBe(1);
  });

  it('cada webhook reemplaza la lista anterior por completo', async () => {
    if (!mysqlUp) return;
    await postGoals(PAYLOAD);
    await postGoals({ projects: [{ name: 'Solo uno', goals: [{ name: 'M', dueDate: FUTURE }] }] });

    const [projects] = await testDb().query<RowDataPacket[]>('SELECT name FROM review_projects');
    const [goals] = await testDb().query<RowDataPacket[]>('SELECT name FROM review_goals');
    expect(projects.map((p) => p.name)).toEqual(['Solo uno']);
    expect(goals.map((g) => g.name)).toEqual(['M']);
  });

  it('{ projects: [] } borra la lista previa', async () => {
    if (!mysqlUp) return;
    await postGoals(PAYLOAD);
    const res = await postGoals({ projects: [] });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, projects: 0, goals: 0 });

    const [projects] = await testDb().query<RowDataPacket[]>('SELECT * FROM review_projects');
    const [goals] = await testDb().query<RowDataPacket[]>('SELECT * FROM review_goals');
    expect(projects.length).toBe(0);
    expect(goals.length).toBe(0);
  });

  it('guarda las metas sin fecha con due_date NULL', async () => {
    if (!mysqlUp) return;
    const res = await postGoals({ projects: [{ name: 'P', goals: [{ name: 'Sin fecha' }, { name: 'Null', dueDate: null }] }] });
    expect(res.status).toBe(200);
    const [goals] = await testDb().query<RowDataPacket[]>('SELECT due_date FROM review_goals');
    expect(goals.map((g) => g.due_date)).toEqual([null, null]);
  });

  it('un payload invalido responde 400 con el detalle y NO toca la lista vigente', async () => {
    if (!mysqlUp) return;
    await postGoals(PAYLOAD);
    const res = await postGoals({ projects: [{ name: 'P', goals: [{ name: 'M', dueDate: '15/01/2000' }] }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_payload');
    expect(res.body.detail).toBe('projects[0].goals[0].dueDate debe ser una fecha yyyy-MM-dd');

    const [projects] = await testDb().query<RowDataPacket[]>('SELECT * FROM review_projects');
    expect(projects.length).toBe(2);
    expect((await logsOfKind('goals_rejected')).length).toBe(1);
  });
});

describe('GET /api/review/goals', () => {
  function getGoals(token?: string) {
    const req = request(app).get('/api/review/goals');
    if (token) req.set('Authorization', token);
    return req;
  }

  it('exige sesion y un rol', async () => {
    if (!mysqlUp) return;
    expect((await getGoals()).status).toBe(401);
    expect((await getGoals(bearer('bad', 'jose@x.com'))).status).toBe(401);
    expect((await getGoals(bearer('none', 'mel@x.com'))).status).toBe(403);
  });

  it.each([
    ['admin', 'jose@x.com'],
    ['superadmin', 'boss@x.com']
  ] as const)('%s ve todos los proyectos, agrupados, con su avance y el plazo terminado marcado', async (role, email) => {
    if (!mysqlUp) return;
    await postGoals(PAYLOAD);

    const res = await getGoals(bearer(role, email));
    expect(res.status).toBe(200);
    expect(res.body.todayKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof res.body.receivedAtMs).toBe('number');

    // Proyectos por nombre; metas por fecha (la mas proxima primero).
    const projects = res.body.projects;
    expect(projects.map((p: any) => p.name)).toEqual(['App movil', 'Portal clientes']);
    expect(projects[1].goals).toEqual([
      {
        id: expect.any(String),
        name: 'MVP en staging',
        dueDate: PAST,
        completed: 26.5,
        personKey: 'Jose',
        personName: 'Jose Perez',
        pastDue: true
      },
      {
        id: expect.any(String),
        name: 'Pagos en linea',
        dueDate: FUTURE,
        completed: 0,
        personKey: null,
        personName: null,
        pastDue: false
      }
    ]);
    // Responsable que no esta en people: se muestra la clave, sin nombre. Sin avance: null.
    expect(projects[0].goals[0]).toEqual(
      expect.objectContaining({ personKey: 'desconocido', personName: null, completed: null, pastDue: false })
    );
  });

  it('las metas sin fecha van al final, con dueDate null y sin plazo terminado', async () => {
    if (!mysqlUp) return;
    await postGoals({
      projects: [
        {
          name: 'P',
          goals: [
            { name: 'Sin fecha' },
            { name: 'Vencida', dueDate: PAST },
            { name: 'Futura', dueDate: FUTURE }
          ]
        }
      ]
    });

    const res = await getGoals(bearer('admin', 'jose@x.com'));
    const [project] = res.body.projects;
    expect(project.goals.map((g: any) => [g.name, g.dueDate, g.pastDue])).toEqual([
      ['Vencida', PAST, true],
      ['Futura', FUTURE, false],
      ['Sin fecha', null, false]
    ]);
  });

  it('sin webhook recibido devuelve una lista vacia', async () => {
    if (!mysqlUp) return;
    const res = await getGoals(bearer('admin', 'jose@x.com'));
    expect(res.status).toBe(200);
    expect(res.body.projects).toEqual([]);
    expect(res.body.receivedAtMs).toBeNull();
  });
});
