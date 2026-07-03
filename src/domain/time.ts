/**
 * Utilidades de fecha/hora. Replican exactamente la logica del Apps Script
 * original (getWeekKey_, getQuarterKey_, formatLocalDateTime_) pero usando
 * Intl para el manejo de zona horaria en lugar de Utilities.formatDate.
 */

export interface TzParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

/** Descompone un instante en partes de una zona horaria dada. */
export function tzParts(date: Date, timezone: string): TzParts {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== 'literal') parts[p.type] = p.value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // Intl puede devolver "24" a medianoche en hour12:false; normalizamos.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute)
  };
}

/** yyyy-MM-dd del dia local. */
export function formatDateKey(date: Date, timezone: string): string {
  const p = tzParts(date, timezone);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** yyyy-MM-dd HH:mm en hora local. */
export function formatLocalDateTime(timestampMs: number, timezone: string): string {
  const p = tzParts(new Date(Number(timestampMs)), timezone);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)} ${pad2(p.hour)}:${pad2(p.minute)}`;
}

/**
 * Clave de semana = lunes de la semana ISO, en yyyy-MM-dd.
 * Mismo algoritmo que el original: toma el dia local, lo lleva a UTC y
 * retrocede hasta el lunes.
 */
export function getWeekKey(date: Date, timezone: string): string {
  const ymd = formatDateKey(date, timezone);
  const d = new Date(`${ymd}T00:00:00Z`);
  const day = d.getUTCDay() || 7; // domingo=0 -> 7
  d.setUTCDate(d.getUTCDate() - day + 1);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/**
 * Clave de periodo de reinicio. Por defecto cada 3 meses (trimestre), pero
 * configurable en meses (bimestral=2, cuatrimestral=4, semestral=6, mensual=1).
 * El periodo se calcula desde el inicio del anio.
 *   resetMonths=3 -> 2026_P1 (ene-mar), 2026_P2 (abr-jun), ...
 *   resetMonths=2 -> 2026_P1 (ene-feb), 2026_P2 (mar-abr), ...
 */
export function getPeriodKey(date: Date, timezone: string, resetMonths = 3): string {
  const p = tzParts(date, timezone);
  const months = Math.max(1, Math.min(12, Math.floor(resetMonths) || 3));
  const periodIndex = Math.floor((p.month - 1) / months) + 1;
  return `${p.year}_P${periodIndex}`;
}

/** Devuelve el rango [inicio, fin) del periodo al que pertenece una fecha. */
export function getPeriodRange(
  date: Date,
  timezone: string,
  resetMonths = 3
): { startMonth: number; endMonth: number; year: number; label: string } {
  const p = tzParts(date, timezone);
  const months = Math.max(1, Math.min(12, Math.floor(resetMonths) || 3));
  const periodIndex = Math.floor((p.month - 1) / months);
  const startMonth = periodIndex * months + 1;
  const endMonth = Math.min(12, startMonth + months - 1);
  return { startMonth, endMonth, year: p.year, label: `${p.year}_P${periodIndex + 1}` };
}

export function calculateElapsedHours(fromMs: number, toMs: number): number {
  return (Number(toMs) - Number(fromMs)) / (1000 * 60 * 60);
}

export function round2(n: number): number {
  return Math.round(Number(n) * 100) / 100;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
