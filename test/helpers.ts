/**
 * Utilidades compartidas por los tests de integracion/e2e.
 * Conectan a la base MySQL configurada por env vars (MYSQL_HOST/MYSQL_PORT/
 * MYSQL_USER/MYSQL_PASSWORD/MYSQL_DATABASE). Se recomienda una base dedicada
 * para tests: cada test trunca TODAS las tablas antes de correr.
 *
 * Requiere que el esquema ya este aplicado (npm run db:migrate) y que la base
 * este accesible.
 */
import type { Pool } from 'mysql2/promise';
import { pool } from '../src/db.js';

export function testDb(): Pool {
  return pool();
}

// Orden pensado por si algun dia se agregan mas FKs: claims depende de
// attention_calls, asi que se trunca primero (aunque FOREIGN_KEY_CHECKS=0 lo
// haria innecesario, es mas claro dejarlo explicito).
const TABLES = ['claims', 'attention_calls', 'audit_log', 'system_logs', 'system_errors', 'people', 'settings'];

/** Trunca todas las tablas (para aislar tests). */
export async function clearAll(): Promise<void> {
  const conn = await pool().getConnection();
  try {
    await conn.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of TABLES) {
      await conn.query(`TRUNCATE TABLE ${table}`);
    }
    await conn.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    conn.release();
  }
}

/**
 * Detecta si MySQL esta disponible SIN colgarse: si no responde en unos
 * segundos, asumimos que no esta y los tests se saltan.
 */
export async function isMysqlUp(timeoutMs = 3000): Promise<boolean> {
  const ping = pool()
    .query('SELECT 1')
    .then(() => true)
    .catch(() => false);
  const timeout = new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs));
  return Promise.race([ping, timeout]);
}
