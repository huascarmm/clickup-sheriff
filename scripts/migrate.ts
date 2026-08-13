/**
 * Aplica db/schema.sql contra la base MySQL configurada por env vars
 * (MYSQL_HOST/PORT/USER/PASSWORD/DATABASE).
 *
 * Uso:
 *   npm run db:migrate
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import mysql from 'mysql2/promise';
import { connectionConfig } from '../src/db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const sql = readFileSync(join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  // multipleStatements solo aqui (conexion propia, de un solo uso): el pool
  // que usa la app en runtime nunca lo habilita, para no ampliar la
  // superficie de inyeccion SQL.
  const conn = await mysql.createConnection({ ...connectionConfig(), multipleStatements: true });
  try {
    await conn.query(sql);
    console.log('Esquema aplicado.');
  } finally {
    await conn.end();
  }
}

main().catch((e) => {
  console.error('Migracion fallo:', e);
  process.exit(1);
});
