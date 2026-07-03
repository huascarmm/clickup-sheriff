/**
 * Tests de integracion contra el emulador de Firestore.
 * Prueban las dos garantias que en Sheets costaron semanas de debugging:
 *   1. Idempotencia: la misma tarea el mismo dia = una sola llamada.
 *   2. Contadores consistentes bajo concurrencia (sin race conditions).
 *
 * Si el emulador no esta corriendo, estos tests se saltan con un aviso.
 */
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { testDb, clearAll, isEmulatorUp } from '../helpers.js';
import { runAttentionCheck, CALLS_COLLECTION, type AttentionDeps } from '../../src/services/attention.js';
import { makePersonResolver } from '../../src/services/people.js';
import { personStats } from '../../src/services/stats.js';
import { getPeriodKey } from '../../src/domain/time.js';
import { DEFAULT_SETTINGS } from '../../src/config.js';
import type { Person, ClickUpTask } from '../../src/domain/types.js';

const H = 3600_000;
const NOW = Date.UTC(2026, 4, 18, 12, 0);

let emulatorUp = true;

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

beforeAll(async () => {
  emulatorUp = await isEmulatorUp();
  if (!emulatorUp) {
    console.warn('\n[SKIP] Emulador de Firestore no disponible. Corre: npm run emulator\n');
  }
});

beforeEach(async () => {
  if (emulatorUp) await clearAll();
});

describe('integracion: idempotencia', () => {
  it('la misma tarea/dia/tipo genera UNA sola llamada aunque se dispare 3 veces', async () => {
    if (!emulatorUp) return;
    const deps = makeDeps();
    const task = overdueTask('86e1f5cnb', 'Jose');

    const r1 = await runAttentionCheck(task, deps);
    const r2 = await runAttentionCheck(task, deps);
    const r3 = await runAttentionCheck(task, deps);

    expect('raised' in r1 && r1.raised).toBe(true);
    expect('alreadyLogged' in r2 && r2.alreadyLogged).toBe(true);
    expect('alreadyLogged' in r3 && r3.alreadyLogged).toBe(true);

    const snap = await testDb().collection(CALLS_COLLECTION).get();
    expect(snap.size).toBe(1);
  });

  it('si la llamada fue ELIMINADA (soft-delete), un nuevo webhook la RE-EMITE el mismo dia', async () => {
    if (!emulatorUp) return;
    const deps = makeDeps();
    const task = overdueTask('86e23vk5a', 'Jose');

    // 1) Primera emision.
    const r1 = await runAttentionCheck(task, deps);
    expect('raised' in r1 && r1.raised).toBe(true);
    const docId = (r1 as { call: { id: string } }).call.id;

    // 2) Se elimina (como un test manual o un borrado por error).
    await testDb()
      .collection(CALLS_COLLECTION)
      .doc(docId)
      .set({ deleted: true, deletedBy: 'test', deletedReason: 'fue un test manual' }, { merge: true });

    // 3) El mismo webhook vuelve a correr: debe RE-EMITIR, no decir alreadyLogged.
    const r2 = await runAttentionCheck(task, deps);
    expect('raised' in r2 && r2.raised).toBe(true);

    const after = await testDb().collection(CALLS_COLLECTION).doc(docId).get();
    const data = after.data() as { deleted: boolean; slackOk: boolean; deletedBy?: string };
    expect(data.deleted).toBe(false); // ya no esta eliminada
    expect(data.deletedBy).toBeUndefined(); // se limpiaron los campos de borrado
    expect(data.slackOk).toBe(true); // se reenvio a Slack

    // Sigue habiendo un solo documento (mismo id determinista).
    const snap = await testDb().collection(CALLS_COLLECTION).get();
    expect(snap.size).toBe(1);
  });
});

describe('integracion: contador semanal secuencial', () => {
  it('cinco tareas distintas de la misma persona dan 1,2,3,4,5 y tolerancias correctas', async () => {
    if (!emulatorUp) return;
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
    if (!emulatorUp) return;
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
    if (!emulatorUp) return;
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
    if (!emulatorUp) return;
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
    await testDb().collection(CALLS_COLLECTION).doc(formalId).set({ deleted: true, deletedReason: 'reclamo aceptado' }, { merge: true });

    const after = await personStats(testDb(), 'Jose', periodKey);
    expect(after.formalCalls).toBe(1); // la anulada ya NO cuenta
    expect(after.annulled).toBe(1);
    // Las tolerancias no se tocan.
    expect(after.tolerances).toBe(2);
  });
});

describe('integracion: reclamo aceptado anula la llamada', () => {
  it('resolveClaim(accepted) marca la llamada como deleted y deja de contar', async () => {
    if (!emulatorUp) return;
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

    const call = await testDb().collection(CALLS_COLLECTION).doc(callId).get();
    expect((call.data() as any).deleted).toBe(true);

    const stats = await personStats(testDb(), 'Jose', periodKey);
    // De 3 formales, una fue anulada -> 2 cuentan.
    expect(stats.formalCalls).toBe(2);
    expect(stats.annulled).toBe(1);
  });
});
