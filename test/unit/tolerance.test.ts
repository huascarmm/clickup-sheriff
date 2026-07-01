import { describe, it, expect } from 'vitest';
import { computeTolerance } from '../../src/domain/tolerance.js';

describe('tolerance', () => {
  it('las primeras N faltas son tolerancia (SI)', () => {
    expect(computeTolerance(0, 2)).toEqual({ weeklyCountAfter: 1, isTolerance: true, tolerance: 'SI 1/2' });
    expect(computeTolerance(1, 2)).toEqual({ weeklyCountAfter: 2, isTolerance: true, tolerance: 'SI 2/2' });
  });

  it('a partir de N+1 son llamada formal (NO)', () => {
    expect(computeTolerance(2, 2)).toEqual({ weeklyCountAfter: 3, isTolerance: false, tolerance: 'NO 3/2' });
    expect(computeTolerance(3, 2)).toEqual({ weeklyCountAfter: 4, isTolerance: false, tolerance: 'NO 4/2' });
  });

  it('con tolerancia 0, la primera ya es formal', () => {
    expect(computeTolerance(0, 0)).toEqual({ weeklyCountAfter: 1, isTolerance: false, tolerance: 'NO 1/0' });
  });

  it('produce la secuencia correcta 1..5 (regresion del bug de contador)', () => {
    const seq = [0, 1, 2, 3, 4].map((prev) => computeTolerance(prev, 2));
    expect(seq.map((s) => s.weeklyCountAfter)).toEqual([1, 2, 3, 4, 5]);
    expect(seq.map((s) => s.tolerance)).toEqual(['SI 1/2', 'SI 2/2', 'NO 3/2', 'NO 4/2', 'NO 5/2']);
  });
});
