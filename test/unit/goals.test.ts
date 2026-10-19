import { describe, it, expect } from 'vitest';
import { isGoalOverdue, isValidDateKey, parseGoalsPayload, MAX_PROJECTS } from '../../src/domain/goals.js';

describe('isValidDateKey', () => {
  it('acepta fechas reales yyyy-MM-dd', () => {
    expect(isValidDateKey('2026-10-19')).toBe(true);
    expect(isValidDateKey('2028-02-29')).toBe(true);
  });

  it('rechaza formatos ajenos y fechas imposibles', () => {
    expect(isValidDateKey('2026-02-30')).toBe(false);
    expect(isValidDateKey('2026-13-01')).toBe(false);
    expect(isValidDateKey('19/10/2026')).toBe(false);
    expect(isValidDateKey('2026-10-19T00:00:00Z')).toBe(false);
  });
});

describe('isGoalOverdue', () => {
  it('vence al terminar su dia: la de hoy no esta vencida, la de ayer si', () => {
    expect(isGoalOverdue('2026-10-18', '2026-10-19')).toBe(true);
    expect(isGoalOverdue('2026-10-19', '2026-10-19')).toBe(false);
    expect(isGoalOverdue('2026-10-20', '2026-10-19')).toBe(false);
  });

  it('una meta sin fecha nunca esta vencida', () => {
    expect(isGoalOverdue(null, '2026-10-19')).toBe(false);
  });
});

describe('parseGoalsPayload', () => {
  it('normaliza nombres y deja personKey en null si no viene', () => {
    const r = parseGoalsPayload({
      projects: [{ name: '  Portal  ', goals: [{ name: ' MVP ', dueDate: '2026-10-15' }] }]
    });
    expect(r).toEqual({
      ok: true,
      projects: [{ name: 'Portal', goals: [{ name: 'MVP', dueDate: '2026-10-15', personKey: null }] }]
    });
  });

  it('agrupa proyectos con el mismo nombre sin distinguir mayusculas', () => {
    const r = parseGoalsPayload({
      projects: [
        { name: 'Portal', goals: [{ name: 'A', dueDate: '2026-10-01', personKey: 'Jose' }] },
        { name: 'portal', goals: [{ name: 'B', dueDate: '2026-10-02' }] },
        { name: 'App', goals: [] }
      ]
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.projects.map((p) => p.name)).toEqual(['Portal', 'App']);
    expect(r.projects[0].goals.map((g) => g.name)).toEqual(['A', 'B']);
    expect(r.projects[0].goals[0].personKey).toBe('Jose');
  });

  it('acepta metas sin fecha (ausente, null o vacia) y las deja con dueDate null', () => {
    const r = parseGoalsPayload({
      projects: [
        {
          name: 'P',
          goals: [{ name: 'Sin campo' }, { name: 'Null', dueDate: null }, { name: 'Vacia', dueDate: '' }]
        }
      ]
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.projects[0].goals.map((g) => g.dueDate)).toEqual([null, null, null]);
  });

  it('acepta una lista vacia (deja el panel sin proyectos)', () => {
    expect(parseGoalsPayload({ projects: [] })).toEqual({ ok: true, projects: [] });
  });

  it.each([
    [null, 'projects debe ser una lista'],
    [{ projects: {} }, 'projects debe ser una lista'],
    [{ projects: [{ goals: [] }] }, 'projects[0].name es obligatorio'],
    [{ projects: [{ name: 'P' }] }, 'projects[0].goals debe ser una lista'],
    [{ projects: [{ name: 'P', goals: [{ dueDate: '2026-10-01' }] }] }, 'projects[0].goals[0].name es obligatorio'],
    [{ projects: [{ name: 'P', goals: [{ name: 'M', dueDate: '2026-02-30' }] }] }, 'projects[0].goals[0].dueDate debe ser una fecha yyyy-MM-dd'],
    [{ projects: [{ name: 'P', goals: [{ name: 'M', dueDate: 20261001 }] }] }, 'projects[0].goals[0].dueDate debe ser una fecha yyyy-MM-dd'],
    [{ projects: [{ name: 'P', goals: [{ name: 'M', dueDate: '2026-10-01', personKey: 7 }] }] }, 'projects[0].goals[0].personKey debe ser texto'],
    [{ projects: [{ name: 'x'.repeat(192), goals: [] }] }, 'projects[0].name supera 191 caracteres']
  ])('rechaza %j con un detalle que indica el campo', (body, error) => {
    expect(parseGoalsPayload(body)).toEqual({ ok: false, error });
  });

  it('rechaza mas proyectos que el maximo', () => {
    const projects = Array.from({ length: MAX_PROJECTS + 1 }, (_, i) => ({ name: `P${i}`, goals: [] }));
    expect(parseGoalsPayload({ projects }).ok).toBe(false);
  });
});
