/**
 * Conexion a MySQL (mysql2/promise). Reemplaza el Firestore de src/firebase.ts
 * para datos de negocio. Firebase Auth (roles) sigue en firebase.ts, sin
 * cambios: este archivo es puramente el almacenamiento.
 *
 * La base vive fuera de GCP (servidor propio), asi que el trafico sale por
 * internet publico: TLS es obligatorio en produccion (MYSQL_SSL=true), no
 * opcional. Sin un VPC Connector de por medio, la unica defensa es
 * cifrado + credenciales fuertes.
 */
import mysql, { type Pool, type PoolConnection } from 'mysql2/promise';

let _pool: Pool | null = null;

export function connectionConfig() {
  const useSsl = process.env.MYSQL_SSL === 'true';
  return {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: Number(process.env.MYSQL_PORT || 3306),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE,
    // MYSQL_SSL_CA: contenido PEM del certificado CA del servidor (no una ruta
    // de archivo: en Cloud Run los secretos llegan como valor de env var, no
    // como archivo). Sin CA, Node valida contra las CAs publicas del sistema,
    // lo cual falla con el certificado autofirmado que MySQL genera por
    // defecto -> hay que pasar la CA real o, como ultimo recurso,
    // MYSQL_SSL_REJECT_UNAUTHORIZED=false (cifra el trafico pero no valida el
    // certificado del servidor; no recomendado).
    ssl: useSsl
      ? {
          ca: process.env.MYSQL_SSL_CA || undefined,
          rejectUnauthorized: process.env.MYSQL_SSL_REJECT_UNAUTHORIZED !== 'false'
        }
      : undefined
  };
}

export function pool(): Pool {
  if (_pool) return _pool;
  _pool = mysql.createPool({
    ...connectionConfig(),
    waitForConnections: true,
    connectionLimit: 10,
    // Fechas/horas como string tal cual las guarda MySQL, sin reinterpretar
    // con la zona horaria del proceso de Node.
    dateStrings: true
  });
  return _pool;
}

export type DbConn = Pool | PoolConnection;

export interface TransactionOptions {
  /** Nivel de aislamiento para esta transaccion (por defecto el del servidor). */
  isolation?: 'SERIALIZABLE';
  /** Reintentos adicionales ante deadlock/lock-wait-timeout (default 5). */
  retries?: number;
}

const RETRYABLE_CODES = new Set(['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT']);

/** Techo inicial de la espera entre reintentos; se duplica en cada intento. */
const RETRY_BASE_MS = 25;
/** Tope del techo, para que una racha larga no dispare la latencia. */
const RETRY_MAX_MS = 400;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Espera antes del siguiente intento: backoff exponencial con jitter COMPLETO
 * (un valor al azar entre 0 y el techo, no el techo exacto).
 *
 */
function retryDelayMs(attempt: number): number {
  const ceiling = Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), RETRY_MAX_MS);
  return Math.random() * ceiling;
}

/**
 * Envuelve begin/commit/rollback con reintento automatico ante contencion,
 * imitando el reintento que hacia Firestore en db.runTransaction().
 */
export async function withTransaction<T>(
  fn: (conn: PoolConnection) => Promise<T>,
  opts: TransactionOptions = {}
): Promise<T> {
  const maxAttempts = (opts.retries ?? 5) + 1;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) await sleep(retryDelayMs(attempt - 1));

    const conn = await pool().getConnection();
    try {
      if (opts.isolation) {
        await conn.query(`SET TRANSACTION ISOLATION LEVEL ${opts.isolation}`);
      }
      await conn.beginTransaction();
      const result = await fn(conn);
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback().catch(() => {});
      const code = (err as { code?: string }).code;
      if (code && RETRYABLE_CODES.has(code) && attempt < maxAttempts) {
        lastErr = err;
        continue;
      }
      throw err;
    } finally {
      conn.release();
    }
  }
  throw lastErr;
}
