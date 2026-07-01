/** Logger minimo estructurado (JSON) para que Cloud Logging lo parsee bien. */
type Level = 'info' | 'warn' | 'error';

function log(level: Level, msg: string, extra?: Record<string, unknown>) {
  const line = { severity: level.toUpperCase(), message: msg, ...extra };
  const out = JSON.stringify(line);
  if (level === 'error') console.error(out);
  else if (level === 'warn') console.warn(out);
  else console.log(out);
}

export const logger = {
  info: (msg: string, extra?: Record<string, unknown>) => log('info', msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) => log('warn', msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) => log('error', msg, extra)
};
