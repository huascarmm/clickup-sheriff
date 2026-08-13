/**
 * Tests de integracion contra MySQL real (base de test, ver test/helpers.ts).
 * Prueban las dos garantias que en Sheets costaron semanas de debugging:
 *   1. Idempotencia: la misma tarea el mismo dia = una sola llamada.
 *   2. Contadores consistentes bajo concurrencia (sin race conditions).
 *
 * Si MySQL no esta disponible/configurado, estos tests se saltan con un aviso.
 */
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import type { RowDataPacket } from 'mysql2/promise';
import { testDb, clearAll, isMysqlUp } from '../helpers.js';
import { runAttentionCheck, CALLS_COLLECTION, type AttentionDeps } from '../../src/services/attention.js';
import { makePersonResolver } from '../../src/services/people.js';
import { personStats } from '../../src/services/stats.js';
import { getPeriodKey } from '../../src/domain/time.js';
import { DEFAULT_SETTINGS } from '../../src/config.js';
import type { Person, ClickUpTask } from '../../src/domain/types.js';

const H = 3600_000;
const NOW = Date.UTC(2026, 4, 18, 12, 0);

let mysqlUp = true;

const people: Person[] = [
  { person_key: 'Jose', nombre_visible: 'Jose', qa_string: 'Jose', clickup_user_id: '', clickup_username: 'Jose', clickup_email: '', login_email: 'jose@x.com', slack_user_id: 'UJOSE', activo: true, notas: '' },
  { person_key: 'Melissa', nombre_visible: 'Melissa', qa_string: 'Melissa', clickup_user_id: '', clickup_username: 'Melissa', clickup_email: '', login_email: 'mel@x.com', slack_user_id: 'UMEL', activo: true, notas: '' }
];

function makeDeps(overrides?: Partial<AttentionDeps>): AttentionDeps {
  const posted: string[] = [];
  return {
    db: testDb(),
    settings: { ...DEFAULT_SETTINGS, overdueWeeklyTolerance: 2 },
    people: makePersonResolver(people),
    slack: {
      channelId: 'C123',
      post: async (_ch, text) => {
        posted.push(text);
        return { ok: true, ts: '1.1', error: '' };
      }
    },
    now: () => NOW,
    ...overrides
  };
}

function overdueTask(id: string, assignee: string): ClickUpTask {
  return { id, status: { status: 'doing' }, due_date: NOW - 10 * H, name: `Task ${id}`, assignees: [{ username: assignee }] };
}

async function countCalls(): Promise<number> {
  const [rows] = await testDb().query<RowDataPacket[]>(`SELECT COUNT(*) AS c FROM ${CALLS_COLLECTION}`);
  return Number(rows[0].c);
}

beforeAll(async () => {
  mysqlUp = await isMysqlUp();
  if (!mysqlUp) {
    console.warn('\n[SKIP] MySQL no disponible. Corre: npm run db:migrate y configura MYSQL_*\n');
  }
});

beforeEach(async () => {
  if (mysqlUp) await clearAll();
});

describe('integracion: idempotencia', () => {
  it('la misma tarea/dia/tipo genera UNA sola llamada aunque se dispare 3 veces', async () => {
    if (!mysqlUp) return;
    const deps = makeDeps();
    const task = overdueTask('86e1f5cnb', 'Jose');

    const r1 = await runAttentionCheck(task, deps);
    const r2 = await runAttentionCheck(task, deps);
    const r3 = await runAttentionCheck(task, deps);

    expect('raised' in r1 && r1.raised).toBe(true);
    expect('alreadyLogged' in r2 && r2.alreadyLogged).toBe(true);
    expect('alreadyLogged' in r3 && r3.alreadyLogged).toBe(true);

    expect(await countCalls()).toBe(1);
  });

  it('si la llamada fue ELIMINADA (soft-delete), un nuevo webhook la RE-EMITE el mismo dia', async () => {
    if (!mysqlUp) return;
    const deps = makeDeps();
    const task = overdueTask('86e23vk5a', 'Jose');

    // 1) Primera emision.
    const r1 = await runAttentionCheck(task, deps);
    expect('raised' in r1 && r1.raised).toBe(true);
    const docId = (r1 as { call: { id: string } }).call.id;

    // 2) Se elimina (como un test manual o un borrado por error).
    await testDb().query(
      `UPDATE ${CALLS_COLLECTION} SET deleted = TRUE, deleted_by = ?, deleted_reason = ? WHERE id = ?`,
      ['test', 'fue un test manual', docId]
    );

    // 3) El mismo webhook vuelve a correr: debe RE-EMITIR, no decir alreadyLogged.
    const r2 = await runAttentionCheck(task, deps);
    expect('raised' in r2 && r2.raised).toBe(true);

    const [rows] = await testDb().query<RowDataPacket[]>(`SELECT * FROM ${CALLS_COLLECTION} WHERE id = ?`, [docId]);
    const data = rows[0];
    expect(!!data.deleted).toBe(false); // ya no esta eliminada
    expect(data.deleted_by).toBeNull(); // se limpiaron los campos de borrado
    expect(!!data.slack_ok).toBe(true); // se reenvio a Slack

    // Sigue habiendo una sola fila (mismo id determinista).
    expect(await countCalls()).toBe(1);
  });
});

describe('integracion: contador semanal secuencial', () => {
  it('cinco tareas distintas de la misma persona dan 1,2,3,4,5 y tolerancias correctas', async () => {
    if (!mysqlUp) return;
    const deps = makeDeps();
    const seq: Array<{ weekly: number; tol: string }> = [];

    for (let i = 0; i < 5; i++) {
      const r = await runAttentionCheck(overdueTask(`task_${i}`, 'Jose'), deps);
      if ('raised' in r && r.raised) seq.push({ weekly: r.call.weeklyCountAfter, tol: r.call.tolerance });
    }

    expect(seq.map((s) => s.weekly)).toEqual([1, 2, 3, 4, 5]);
    expect(seq.map((s) => s.tol)).toEqual(['SI 1/2', 'SI 2/2', 'NO 3/2', 'NO 4/2', 'NO 5/2']);
  });

  it('bajo concurrencia (ráfaga simultánea) el contador NO se rompe (regresion Melissa)', async () => {
    if (!mysqlUp) return;
    const deps = makeDeps();

    // 6 tareas distintas de Melissa disparadas EN PARALELO, como hace ClickUp.
    const tasks = Array.from({ length: 6 }, (_, i) => overdueTask(`mel_${i}`, 'Melissa'));
    const results = await Promise.all(tasks.map((t) => runAttentionCheck(t, deps)));

    const weeklies = results
      .filter((r): r is Extract<typeof r, { raised: true }> => 'raised' in r && r.raised)
      .map((r) => r.call.weeklyCountAfter)
      .sort((a, b) => a - b);

    // Sin duplicados ni saltos: exactamente 1..6.
    expect(weeklies).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('integracion: contador trimestral de llamadas formales', () => {
  it('cuenta solo las formales (NO), no las tolerancias', async () => {
    if (!mysqlUp) return;
    const deps = makeDeps();
    let lastQuarterly: number | null = null;

    for (let i = 0; i < 4; i++) {
      const r = await runAttentionCheck(overdueTask(`q_${i}`, 'Jose'), deps);
      if ('raised' in r && r.raised) lastQuarterly = r.call.periodAttentionCountAfter;
    }
    // 4 llamadas: 2 tolerancia + 2 formales -> la ultima formal es la #2 del trimestre.
    expect(lastQuarterly).toBe(2);
  });
});

describe('integracion: anular deja de contar (punto critico del conteo)', () => {
  it('el contador oficial (personStats.formalCalls) excluye la llamada anulada', async () => {
    if (!mysqlUp) return;
    const deps = makeDeps();
    const periodKey = getPeriodKey(new Date(NOW), deps.settings.timezone, deps.settings.resetPeriodMonths);

    // 4 llamadas de Jose: 2 tolerancia + 2 formales.
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await runAttentionCheck(overdueTask(`ann_${i}`, 'Jose'), deps);
      if ('raised' in r && r.raised) ids.push(r.call.id);
    }

    const before = await personStats(testDb(), 'Jose', periodKey);
    expect(before.formalCalls).toBe(2); // las 2 formales cuentan
    expect(before.tolerances).toBe(2);

    // Anular UNA de las formales (la ultima, que es formal).
    const formalId = ids[3];
    await testDb().query(`UPDATE ${CALLS_COLLECTION} SET deleted = TRUE, deleted_reason = ? WHERE id = ?`, [
      'reclamo aceptado',
      formalId
    ]);

    const after = await personStats(testDb(), 'Jose', periodKey);
    expect(after.formalCalls).toBe(1); // la anulada ya NO cuenta
    expect(after.annulled).toBe(1);
    // Las tolerancias no se tocan.
    expect(after.tolerances).toBe(2);
  });
});

describe('integracion: reclamo aceptado anula la llamada', () => {
  it('resolveClaim(accepted) marca la llamada como deleted y deja de contar', async () => {
    if (!mysqlUp) return;
    const { createClaim, resolveClaim } = await import('../../src/services/claims.js');
    const deps = makeDeps();
    const periodKey = getPeriodKey(new Date(NOW), deps.settings.timezone, deps.settings.resetPeriodMonths);

    // Genera 3 formales para que la 3a sea claramente formal.
    let callId = '';
    for (let i = 0; i < 3; i++) {
      const r = await runAttentionCheck(overdueTask(`clm_${i}`, 'Jose'), deps);
      if ('raised' in r && r.raised) callId = r.call.id;
    }

    const claim = await createClaim(testDb(), {
      callId,
      justification: 'Se acordo en el daily anular esta llamada.',
      requester: people[0],
      requesterEmail: 'jose@x.com'
    });
    expect(claim.status).toBe('pending');

    const resolved = await resolveClaim(testDb(), {
      claimId: claim.id,
      decision: 'accepted',
      message: 'Confirmado, se anula.',
      resolverEmail: 'boss@x.com'
    });
    expect(resolved.status).toBe('accepted');

    const [callRows] = await testDb().query<RowDataPacket[]>(`SELECT deleted FROM ${CALLS_COLLECTION} WHERE id = ?`, [callId]);
    expect(!!callRows[0].deleted).toBe(true);

    const stats = await personStats(testDb(), 'Jose', periodKey);
    // De 3 formales, una fue anulada -> 2 cuentan.
    expect(stats.formalCalls).toBe(2);
    expect(stats.annulled).toBe(1);
  });
});

describe('integracion: llamada de atencion manual', () => {
  it('registra la manual, cuenta como las demas y guarda origen y autor', async () => {
    if (!mysqlUp) return;
    const { raiseManualAttention } = await import('../../src/services/attention.js');
    const deps = makeDeps();
    const periodKey = getPeriodKey(new Date(NOW), deps.settings.timezone, deps.settings.resetPeriodMonths);

    // Dos manuales para Jose: la 1a y 2a son tolerancia (limite 2), la 3a formal.
    let last;
    for (let i = 0; i < 3; i++) {
      last = await raiseManualAttention(
        { person: people[0], reason: `motivo ${i}`, comment: 'c', createdByEmail: 'boss@x.com' },
        deps
      );
    }

    expect(last!.call.origin).toBe('manual');
    expect(last!.call.createdByEmail).toBe('boss@x.com');
    expect(last!.call.alertType).toBe('MANUAL');
    expect(last!.call.isTolerance).toBe(false); // la 3a ya es formal
    expect(last!.call.periodAttentionCountAfter).toBe(1);

    const stats = await personStats(testDb(), 'Jose', periodKey);
    expect(stats.formalCalls).toBe(1);
    expect(stats.tolerances).toBe(2);
    expect(stats.formalByReason.MANUAL).toBe(1);
  });

  it('las manuales se combinan con las automaticas en el mismo conteo semanal', async () => {
    if (!mysqlUp) return;
    const { raiseManualAttention } = await import('../../src/services/attention.js');
    const deps = makeDeps();

    // 2 automaticas (tolerancia 1 y 2), luego 1 manual -> debe ser formal.
    await runAttentionCheck(overdueTask('auto_1', 'Jose'), deps);
    await runAttentionCheck(overdueTask('auto_2', 'Jose'), deps);
    const manual = await raiseManualAttention(
      { person: people[0], reason: 'tercera falta de la semana', createdByEmail: 'boss@x.com' },
      deps
    );
    expect(manual.call.isTolerance).toBe(false);
    expect(manual.call.weeklyCountAfter).toBe(3);
  });
});
