/**
 * Tests de integracion del recalculo de contadores al ACEPTAR un reclamo.
 *
 * Al anular una llamada, las posteriores del mismo periodo deben "correr" un
 * lugar: cambia su tolerancia semanal (solo dentro de su misma semana) y su
 * numero formal de periodo (para todas las que vengan despues).
 *
 * Si MySQL no esta disponible/configurado, estos tests se saltan con un aviso.
 */
import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import type { RowDataPacket } from 'mysql2/promise';
import { testDb, clearAll, isMysqlUp } from '../helpers.js';
import { CALLS_COLLECTION } from '../../src/services/attention.js';
import { createClaim, resolveClaim } from '../../src/services/claims.js';
import type { Person } from '../../src/domain/types.js';

const NOW = Date.UTC(2026, 7, 17, 12, 0);
const PERIOD = '2026_P3';

let mysqlUp = true;

const juan: Person = {
  person_key: 'Juan',
  nombre_visible: 'Juan',
  qa_string: 'Juan',
  clickup_user_id: '',
  clickup_username: 'Juan',
  clickup_email: '',
  login_email: 'juan@x.com',
  slack_user_id: 'UJUAN',
  activo: true,
  notas: ''
};

interface CallSeed {
  id: string;
  weekKey: string;
  tolerance: string;
  isTolerance: boolean;
  weeklyCountAfter: number;
  periodAttentionCountAfter: number | null;
}

/** Texto tal como lo arma buildSlackMessage para una llamada MANUAL sin tarea. */
function toleranceMessage(tolerance: string, reason: string): string {
  return `🟡 Aviso de tolerancia (${tolerance}) para <@UJUAN>: ${reason}`;
}
function formalMessage(count: number, reason: string): string {
  return `⚠️ Llamada de atencion #${count} del periodo a <@UJUAN>: ${reason}.`;
}

/** La razon de cada llamada es su propio id, para reconocerla en el mensaje. */
function reasonOf(id: string): string {
  return `Motivo ${id}`;
}

/** El mensaje que le corresponde a una llamada segun sus contadores. */
function messageFor(id: string, tolerance: string, isTolerance: boolean, periodCount: number | null): string {
  return isTolerance ? toleranceMessage(tolerance, reasonOf(id)) : formalMessage(periodCount!, reasonOf(id));
}

/** El escenario del ejemplo: 3 llamadas en una semana, 4 en la siguiente. */
const SEED: CallSeed[] = [
  { id: 'call_1', weekKey: '2026-08-10', tolerance: 'SI 1/2', isTolerance: true, weeklyCountAfter: 1, periodAttentionCountAfter: null },
  { id: 'call_2', weekKey: '2026-08-10', tolerance: 'SI 2/2', isTolerance: true, weeklyCountAfter: 2, periodAttentionCountAfter: null },
  { id: 'call_3', weekKey: '2026-08-10', tolerance: 'NO 3/2', isTolerance: false, weeklyCountAfter: 3, periodAttentionCountAfter: 1 },
  { id: 'call_4', weekKey: '2026-08-17', tolerance: 'SI 1/2', isTolerance: true, weeklyCountAfter: 1, periodAttentionCountAfter: null },
  { id: 'call_5', weekKey: '2026-08-17', tolerance: 'SI 2/2', isTolerance: true, weeklyCountAfter: 2, periodAttentionCountAfter: null },
  { id: 'call_6', weekKey: '2026-08-17', tolerance: 'NO 3/2', isTolerance: false, weeklyCountAfter: 3, periodAttentionCountAfter: 2 },
  { id: 'call_7', weekKey: '2026-08-17', tolerance: 'NO 4/2', isTolerance: false, weeklyCountAfter: 4, periodAttentionCountAfter: 3 }
];

async function seedCalls(seeds: CallSeed[] = SEED): Promise<void> {
  for (const [i, s] of seeds.entries()) {
    await testDb().query(
      `INSERT INTO ${CALLS_COLLECTION}
       (id, timestamp_ms, date_key, week_key, period_key, alert_type, person_key, person_name,
        slack_user_id, reason, tolerance, is_tolerance, weekly_count_after, period_attention_count_after,
        message, origin)
       VALUES (?, ?, ?, ?, ?, 'MANUAL', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual')`,
      [
        s.id,
        NOW + i * 1000, // el orden cronologico es el del array
        s.weekKey,
        s.weekKey,
        PERIOD,
        juan.person_key,
        juan.nombre_visible,
        juan.slack_user_id,
        reasonOf(s.id),
        s.tolerance,
        s.isTolerance,
        s.weeklyCountAfter,
        s.periodAttentionCountAfter,
        messageFor(s.id, s.tolerance, s.isTolerance, s.periodAttentionCountAfter)
      ]
    );
  }
}

interface CallState {
  id: string;
  tolerance: string;
  isTolerance: boolean;
  weeklyCountAfter: number;
  periodAttentionCountAfter: number | null;
}

/** Estado actual de las llamadas vigentes, en orden cronologico. */
async function readCalls(): Promise<CallState[]> {
  const [rows] = await testDb().query<RowDataPacket[]>(
    `SELECT id, tolerance, is_tolerance, weekly_count_after, period_attention_count_after
     FROM ${CALLS_COLLECTION} WHERE deleted = FALSE ORDER BY timestamp_ms ASC`
  );
  return rows.map((r) => ({
    id: r.id,
    tolerance: r.tolerance,
    isTolerance: !!r.is_tolerance,
    weeklyCountAfter: Number(r.weekly_count_after),
    periodAttentionCountAfter: r.period_attention_count_after == null ? null : Number(r.period_attention_count_after)
  }));
}

/** Mensajes guardados de las llamadas vigentes, en orden cronologico. */
async function readMessages(): Promise<string[]> {
  const [rows] = await testDb().query<RowDataPacket[]>(
    `SELECT message FROM ${CALLS_COLLECTION} WHERE deleted = FALSE ORDER BY timestamp_ms ASC`
  );
  return rows.map((r) => String(r.message || ''));
}

/** El mensaje que deberia tener cada llamada dado su estado final. */
function expectedMessages(calls: CallState[]): string[] {
  return calls.map((c) => messageFor(c.id, c.tolerance, c.isTolerance, c.periodAttentionCountAfter));
}

/** Crea y acepta un reclamo sobre una llamada (el camino que dispara el recalculo). */
async function annulViaClaim(callId: string): Promise<void> {
  const claim = await createClaim(testDb(), {
    callId,
    justification: 'En el daily se acordo anularla',
    requester: juan,
    requesterEmail: juan.login_email
  });
  await resolveClaim({
    claimId: claim.id,
    decision: 'accepted',
    message: 'Aceptado',
    resolverEmail: 'super@x.com'
  });
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

describe('integracion: recalculo al aceptar un reclamo', () => {
  it('LLA-09 anular la llamada mas antigua corre la tolerancia de su semana y el conteo del periodo', async () => {
    if (!mysqlUp) return;
    await seedCalls();

    await annulViaClaim('call_1');

    expect(await readCalls()).toEqual([
      { id: 'call_2', tolerance: 'SI 1/2', isTolerance: true, weeklyCountAfter: 1, periodAttentionCountAfter: null },
      { id: 'call_3', tolerance: 'SI 2/2', isTolerance: true, weeklyCountAfter: 2, periodAttentionCountAfter: null },
      { id: 'call_4', tolerance: 'SI 1/2', isTolerance: true, weeklyCountAfter: 1, periodAttentionCountAfter: null },
      { id: 'call_5', tolerance: 'SI 2/2', isTolerance: true, weeklyCountAfter: 2, periodAttentionCountAfter: null },
      { id: 'call_6', tolerance: 'NO 3/2', isTolerance: false, weeklyCountAfter: 3, periodAttentionCountAfter: 1 },
      { id: 'call_7', tolerance: 'NO 4/2', isTolerance: false, weeklyCountAfter: 4, periodAttentionCountAfter: 2 }
    ]);
  });

  it('LLA-09 regenera el message de las filas afectadas y respeta el de las intactas', async () => {
    if (!mysqlUp) return;
    await seedCalls();

    await annulViaClaim('call_1');

    expect(await readMessages()).toEqual([
      // call_2 y call_3 corren dentro de su semana; call_3 deja de ser formal y
      // cambia de formato (⚠️ -> 🟡).
      toleranceMessage('SI 1/2', reasonOf('call_2')),
      toleranceMessage('SI 2/2', reasonOf('call_3')),
      // call_4 y call_5 no cambian: su texto queda tal cual se guardo.
      toleranceMessage('SI 1/2', reasonOf('call_4')),
      toleranceMessage('SI 2/2', reasonOf('call_5')),
      // las formales bajan de numero.
      formalMessage(1, reasonOf('call_6')),
      formalMessage(2, reasonOf('call_7'))
    ]);
  });

  it('LLA-09 el message queda siempre coherente con los contadores', async () => {
    if (!mysqlUp) return;
    await seedCalls();

    await annulViaClaim('call_3');

    expect(await readMessages()).toEqual(expectedMessages(await readCalls()));
  });

  it('LLA-09 anular una formal no toca la tolerancia semanal, solo desplaza el conteo del periodo', async () => {
    if (!mysqlUp) return;
    await seedCalls();

    // call_3 es la formal #1 del periodo; al irse, call_6 y call_7 suben un puesto.
    await annulViaClaim('call_3');

    const calls = await readCalls();
    expect(calls.map((c) => c.tolerance)).toEqual(['SI 1/2', 'SI 2/2', 'SI 1/2', 'SI 2/2', 'NO 3/2', 'NO 4/2']);
    expect(calls.map((c) => c.periodAttentionCountAfter)).toEqual([null, null, null, null, 1, 2]);
  });

  it('LLA-09 anular una llamada de otra semana no altera la tolerancia de las demas semanas', async () => {
    if (!mysqlUp) return;
    await seedCalls();

    await annulViaClaim('call_5');

    const calls = await readCalls();
    // La semana 2026-08-10 queda intacta; en 2026-08-17 todo corre un lugar.
    expect(calls).toEqual([
      { id: 'call_1', tolerance: 'SI 1/2', isTolerance: true, weeklyCountAfter: 1, periodAttentionCountAfter: null },
      { id: 'call_2', tolerance: 'SI 2/2', isTolerance: true, weeklyCountAfter: 2, periodAttentionCountAfter: null },
      { id: 'call_3', tolerance: 'NO 3/2', isTolerance: false, weeklyCountAfter: 3, periodAttentionCountAfter: 1 },
      { id: 'call_4', tolerance: 'SI 1/2', isTolerance: true, weeklyCountAfter: 1, periodAttentionCountAfter: null },
      { id: 'call_6', tolerance: 'SI 2/2', isTolerance: true, weeklyCountAfter: 2, periodAttentionCountAfter: null },
      { id: 'call_7', tolerance: 'NO 3/2', isTolerance: false, weeklyCountAfter: 3, periodAttentionCountAfter: 2 }
    ]);
  });

  it('LLA-09 rechazar el reclamo no cambia ningun contador', async () => {
    if (!mysqlUp) return;
    await seedCalls();
    const before = await readCalls();

    const claim = await createClaim(testDb(), {
      callId: 'call_1',
      justification: 'En el daily se acordo anularla',
      requester: juan,
      requesterEmail: juan.login_email
    });
    await resolveClaim({
      claimId: claim.id,
      decision: 'rejected',
      message: 'No procede',
      resolverEmail: 'super@x.com'
    });

    expect(await readCalls()).toEqual(before);
  });

  it('LLA-09 anular en cadena deja los contadores consistentes', async () => {
    if (!mysqlUp) return;
    await seedCalls();

    await annulViaClaim('call_1');
    await annulViaClaim('call_2');

    const calls = await readCalls();
    // Solo queda call_3 en 2026-08-10: vuelve a ser la primera de su semana.
    expect(calls).toEqual([
      { id: 'call_3', tolerance: 'SI 1/2', isTolerance: true, weeklyCountAfter: 1, periodAttentionCountAfter: null },
      { id: 'call_4', tolerance: 'SI 1/2', isTolerance: true, weeklyCountAfter: 1, periodAttentionCountAfter: null },
      { id: 'call_5', tolerance: 'SI 2/2', isTolerance: true, weeklyCountAfter: 2, periodAttentionCountAfter: null },
      { id: 'call_6', tolerance: 'NO 3/2', isTolerance: false, weeklyCountAfter: 3, periodAttentionCountAfter: 1 },
      { id: 'call_7', tolerance: 'NO 4/2', isTolerance: false, weeklyCountAfter: 4, periodAttentionCountAfter: 2 }
    ]);
  });
});
