import { describe, it, expect } from 'vitest';
import {
  calculateElapsedHours,
  formatDateKey,
  formatLocalDateTime,
  getPeriodKey,
  getWeekKey,
  round2,
  tzParts
} from '../../src/domain/time.js';

const TZ = 'America/La_Paz'; // UTC-4, sin horario de verano

describe('time', () => {
  it('tzParts descompone en hora local UTC-4', () => {
    // 2026-05-18T12:00:00Z -> 08:00 en La Paz
    const p = tzParts(new Date('2026-05-18T12:00:00Z'), TZ);
    expect(p).toMatchObject({ year: 2026, month: 5, day: 18, hour: 8, minute: 0 });
  });

  it('formatDateKey da yyyy-MM-dd local', () => {
    // 2026-05-19T03:00:00Z es aun 2026-05-18 23:00 en La Paz
    expect(formatDateKey(new Date('2026-05-19T03:00:00Z'), TZ)).toBe('2026-05-18');
  });

  it('formatLocalDateTime da yyyy-MM-dd HH:mm', () => {
    expect(formatLocalDateTime(Date.UTC(2026, 4, 18, 12, 30), TZ)).toBe('2026-05-18 08:30');
  });

  it('getWeekKey devuelve el lunes de la semana ISO', () => {
    // 2026-05-18 es lunes; 2026-05-20 miercoles -> ambos lunes 2026-05-18
    expect(getWeekKey(new Date('2026-05-18T12:00:00Z'), TZ)).toBe('2026-05-18');
    expect(getWeekKey(new Date('2026-05-20T12:00:00Z'), TZ)).toBe('2026-05-18');
    // domingo 2026-05-24 pertenece a la semana que empieza el lunes 2026-05-18
    expect(getWeekKey(new Date('2026-05-24T12:00:00Z'), TZ)).toBe('2026-05-18');
    // lunes siguiente
    expect(getWeekKey(new Date('2026-05-25T12:00:00Z'), TZ)).toBe('2026-05-25');
  });

  it('getPeriodKey clasifica periodos de 3 meses por defecto', () => {
    expect(getPeriodKey(new Date('2026-01-15T12:00:00Z'), TZ)).toBe('2026_P1');
    expect(getPeriodKey(new Date('2026-05-15T12:00:00Z'), TZ)).toBe('2026_P2');
    expect(getPeriodKey(new Date('2026-08-15T12:00:00Z'), TZ)).toBe('2026_P3');
    expect(getPeriodKey(new Date('2026-11-15T12:00:00Z'), TZ)).toBe('2026_P4');
  });

  it('getPeriodKey respeta el periodo configurable (bimestral y semestral)', () => {
    // Bimestral (2 meses): ene-feb=P1, mar-abr=P2, ...
    expect(getPeriodKey(new Date('2026-01-15T12:00:00Z'), TZ, 2)).toBe('2026_P1');
    expect(getPeriodKey(new Date('2026-03-15T12:00:00Z'), TZ, 2)).toBe('2026_P2');
    expect(getPeriodKey(new Date('2026-12-15T12:00:00Z'), TZ, 2)).toBe('2026_P6');
    // Semestral (6 meses): ene-jun=P1, jul-dic=P2
    expect(getPeriodKey(new Date('2026-06-30T12:00:00Z'), TZ, 6)).toBe('2026_P1');
    expect(getPeriodKey(new Date('2026-07-01T12:00:00Z'), TZ, 6)).toBe('2026_P2');
  });

  it('calculateElapsedHours y round2', () => {
    const from = Date.UTC(2026, 0, 1, 0, 0);
    const to = Date.UTC(2026, 0, 2, 12, 0); // 36h despues
    expect(calculateElapsedHours(from, to)).toBe(36);
    expect(round2(36.126)).toBe(36.13);
  });
});
