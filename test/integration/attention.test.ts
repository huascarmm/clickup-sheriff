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
import { DEFAULT_SETTINGS } from '../../src/config.js';
import type { Person, ClickUpTask } from '../../src/domain/types.js';

const H = 3600_000;
const NOW = Date.UTC(2026, 4, 18, 12, 0);

let emulatorUp = true;

const people: Person[] = [
  { person_key: 'Jose', nombre_visible: 'Jose', qa_string: 'Jose', clickup_user_id: '', clickup_username: 'Jose', clickup_email: '', slack_user_id: 'UJOSE', activo: true, notas: '' },
  { person_key: 'Melissa', nombre_visible: 'Melissa', qa_string: 'Melissa', clickup_user_id: '', clickup_username: 'Melissa', clickup_email: '', slack_user_id: 'UMEL', activo: true, notas: '' }
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
      if ('raised' in r && r.raised) lastQuarterly = r.call.quarterlyAttentionCountAfter;
    }
    // 4 llamadas: 2 tolerancia + 2 formales -> la ultima formal es la #2 del trimestre.
    expect(lastQuarterly).toBe(2);
  });
});
