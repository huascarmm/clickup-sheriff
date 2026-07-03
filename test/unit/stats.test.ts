import { describe, it, expect } from 'vitest';
import { accumulate, summarize } from '../../src/services/stats.js';
import type { AttentionCall } from '../../src/domain/types.js';

function call(partial: Partial<AttentionCall>): AttentionCall {
  return {
    id: partial.id || Math.random().toString(36).slice(2),
    timestampLocal: '',
    timestampMs: 0,
    dateKey: '2026-07-01',
    weekKey: '2026-06-29',
    periodKey: '2026_P3',
    taskId: 't',
    taskName: '',
    taskUrl: '',
    currentStatus: 'doing',
    alertType: partial.alertType || 'ATRASO_PLAZO',
    personKey: partial.personKey || 'Jose',
    personName: partial.personKey || 'Jose',
    slackUserId: '',
    reason: '',
    hoursElapsed: 0,
    dueDateLocal: '',
    statusChangeLocal: '',
    tolerance: partial.tolerance || 'NO 3/2',
    isTolerance: partial.isTolerance ?? false,
    weeklyCountAfter: 0,
    periodAttentionCountAfter: null,
    slackOk: partial.slackOk ?? true,
    slackTs: '',
    slackError: '',
    message: '',
    deleted: partial.deleted ?? false,
    ...partial
  };
}

describe('stats: contador oficial (excluye tolerancias y anuladas)', () => {
  it('cuenta como formal solo isTolerance=false y deleted=false', () => {
    const calls = [
      call({ isTolerance: true }), // tolerancia -> no cuenta como formal
      call({ isTolerance: true }),
      call({ isTolerance: false }), // formal 1
      call({ isTolerance: false }), // formal 2
      call({ isTolerance: false, deleted: true }) // anulada -> no cuenta
    ];
    const s = summarize(calls);
    expect(s.totalAlerts).toBe(5);
    expect(s.tolerances).toBe(2);
    expect(s.formalCalls).toBe(2); // el numero critico
    expect(s.annulled).toBe(1);
  });

  it('una llamada anulada NO suma al contador formal aunque fuera formal', () => {
    const base = summarize([call({ isTolerance: false })]);
    expect(base.formalCalls).toBe(1);
    const annulled = summarize([call({ isTolerance: false, deleted: true })]);
    expect(annulled.formalCalls).toBe(0);
    expect(annulled.annulled).toBe(1);
  });

  it('desglosa formales por razon (tipo de alerta)', () => {
    const calls = [
      call({ isTolerance: false, alertType: 'QA_36H' }),
      call({ isTolerance: false, alertType: 'QA_36H' }),
      call({ isTolerance: false, alertType: 'FIXING_QA_36H' }),
      call({ isTolerance: false, alertType: 'ATRASO_PLAZO' }),
      call({ isTolerance: true, alertType: 'ATRASO_PLAZO' }) // tolerancia, no cuenta
    ];
    const s = summarize(calls);
    expect(s.formalByReason.QA_36H).toBe(2);
    expect(s.formalByReason.FIXING_QA_36H).toBe(1);
    expect(s.formalByReason.ATRASO_PLAZO).toBe(1);
    expect(s.formalCalls).toBe(4);
  });

  it('cuenta fallos de Slack solo entre no anuladas', () => {
    const s = summarize([
      call({ isTolerance: false, slackOk: false }),
      call({ isTolerance: false, slackOk: false, deleted: true }) // anulada, no cuenta
    ]);
    expect(s.slackFailures).toBe(1);
  });

  it('escenario critico: 9 formales vigentes', () => {
    const calls: AttentionCall[] = [];
    for (let i = 0; i < 9; i++) calls.push(call({ isTolerance: false }));
    // dos tolerancias iniciales y una anulada que no deben alterar el conteo
    calls.push(call({ isTolerance: true }), call({ isTolerance: true }), call({ isTolerance: false, deleted: true }));
    const s = summarize(calls);
    expect(s.formalCalls).toBe(9);
  });

  it('accumulate es asociativo respecto al orden', () => {
    const a = [call({ isTolerance: false }), call({ isTolerance: true })];
    const b = [a[1], a[0]];
    expect(summarize(a).formalCalls).toBe(summarize(b).formalCalls);
  });
});
