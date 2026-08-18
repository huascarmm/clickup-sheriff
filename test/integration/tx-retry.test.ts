/**
 * LLA-02 — Reintento de transaccion ante contencion en la base.
 *
 * Todos los caminos que escriben contadores (webhook, llamada manual, aceptar o
 * rechazar un reclamo) pasan por withTransaction, que reintenta cuando InnoDB
 * corta la transaccion por deadlock o por espera de lock. Aqui se prueba esa
 * politica de reintento de forma directa y determinista: se inyecta el error
 * dentro de la transaccion en vez de provocar la contencion real (los tests de
 * concurrencia de attention.test.ts y panel-claims-resolve.test.ts ya cubren el
 * camino real con varias transacciones peleando por las mismas filas).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import type { RowDataPacket } from 'mysql2/promise';
import { testDb, clearAll, isMysqlUp } from '../helpers.js';
import { withTransaction } from '../../src/db.js';
import { CALLS_COLLECTION } from '../../src/services/attention.js';

let mysqlUp = true;

/** Error tal como lo devuelve mysql2 cuando InnoDB aborta la transaccion. */
function dbError(code: string): Error {
  const err = new Error(code) as Error & { code: string };
  err.code = code;
  return err;
}

async function insertCall(tx: { query: (sql: string, values?: unknown[]) => Promise<unknown> }, id: string) {
  await tx.query(
    `INSERT INTO ${CALLS_COLLECTION} (id, timestamp_ms, alert_type, person_key) VALUES (?, ?, 'MANUAL', 'Jose')`,
    [id, Date.now()]
  );
}

async function countCalls(): Promise<number> {
  const [rows] = await testDb().query<RowDataPacket[]>(`SELECT COUNT(*) AS c FROM ${CALLS_COLLECTION}`);
  return Number(rows[0].c);
}

beforeAll(async () => {
  mysqlUp = await isMysqlUp();
  if (!mysqlUp) console.warn('\n[SKIP] MySQL no disponible.\n');
});

beforeEach(async () => {
  if (mysqlUp) await clearAll();
});

describe('LLA-02 falla de transaccion y reintento', () => {
  it('LLA-02 un deadlock se reintenta y la transaccion termina bien', async () => {
    if (!mysqlUp) return;
    let attempts = 0;

    const result = await withTransaction(async (tx) => {
      attempts += 1;
      if (attempts < 3) throw dbError('ER_LOCK_DEADLOCK');
      await tx.query('SELECT 1');
      return 'listo';
    });

    expect(attempts).toBe(3);
    expect(result).toBe('listo');
  });

  it('LLA-02 la espera de lock agotada (ER_LOCK_WAIT_TIMEOUT) tambien se reintenta', async () => {
    if (!mysqlUp) return;
    let attempts = 0;

    const result = await withTransaction(async (tx) => {
      attempts += 1;
      if (attempts === 1) throw dbError('ER_LOCK_WAIT_TIMEOUT');
      await tx.query('SELECT 1');
      return 'listo';
    });

    expect(attempts).toBe(2);
    expect(result).toBe('listo');
  });

  it('LLA-02 el intento fallido no deja datos a medias: se escribe una sola vez', async () => {
    if (!mysqlUp) return;
    let attempts = 0;

    await withTransaction(async (tx) => {
      attempts += 1;
      await insertCall(tx, 'reintento_1');
      if (attempts === 1) throw dbError('ER_LOCK_DEADLOCK'); // rollback del primer intento
    });

    expect(attempts).toBe(2);
    expect(await countCalls()).toBe(1); // no quedo duplicada por el reintento
  });

  it('LLA-02 si la contencion no cede, agota los reintentos y propaga el error', async () => {
    if (!mysqlUp) return;
    let attempts = 0;

    await expect(
      withTransaction(
        async () => {
          attempts += 1;
          throw dbError('ER_LOCK_DEADLOCK');
        },
        { retries: 2 }
      )
    ).rejects.toThrow('ER_LOCK_DEADLOCK');

    expect(attempts).toBe(3); // el intento original + 2 reintentos
  });

  it('LLA-02 un error que no es de contencion NO se reintenta', async () => {
    if (!mysqlUp) return;
    let attempts = 0;

    await expect(
      withTransaction(async () => {
        attempts += 1;
        throw dbError('ER_DUP_ENTRY');
      })
    ).rejects.toThrow('ER_DUP_ENTRY');

    expect(attempts).toBe(1);
  });
});
