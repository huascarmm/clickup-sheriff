import { describe, it, expect } from 'vitest';
import { buildSlackMessage } from '../../src/services/slack.js';
import { summarize } from '../../src/services/stats.js';
import type { AttentionCall, Person } from '../../src/domain/types.js';

const person: Person = {
  person_key: 'Jose',
  nombre_visible: 'Jose',
  qa_string: 'Jose',
  clickup_user_id: '',
  clickup_username: 'Jose',
  clickup_email: '',
  login_email: '',
  slack_user_id: 'U123',
  activo: true,
  notas: ''
};

describe('llamada manual: mensaje de Slack', () => {
  it('formal sin tarea usa la razon y no incluye enlace', () => {
    const msg = buildSlackMessage({
      person,
      taskUrl: '',
      taskName: '',
      alertType: 'MANUAL',
      reason: 'incumplimiento de acuerdo en daily',
      comment: 'reincidente esta semana',
      tolerance: 'NO 3/2',
      isTolerance: false,
      periodAttentionCountAfter: 3
    });
    expect(msg).toContain('<@U123>');
    expect(msg).toContain('incumplimiento de acuerdo en daily');
    expect(msg).toContain('reincidente esta semana');
    expect(msg).toContain('#3 del periodo');
    expect(msg).not.toContain('<|'); // no hay enlace de tarea vacio
    expect(msg).not.toContain('|>');
  });

  it('tolerancia manual muestra el medidor y sin enlace', () => {
    const msg = buildSlackMessage({
      person,
      taskUrl: '',
      taskName: '',
      alertType: 'MANUAL',
      reason: 'llego tarde a la reunion',
      tolerance: 'SI 1/2',
      isTolerance: true,
      periodAttentionCountAfter: null
    });
    expect(msg).toContain('Aviso de tolerancia (SI 1/2)');
    expect(msg).toContain('llego tarde a la reunion');
  });

  it('las llamadas con tarea conservan el enlace (no se rompe el formato previo)', () => {
    const msg = buildSlackMessage({
      person,
      taskUrl: 'https://app.clickup.com/t/abc',
      taskName: 'Tarea X',
      alertType: 'QA_36H',
      reason: '',
      tolerance: 'NO 3/2',
      isTolerance: false,
      periodAttentionCountAfter: 2
    });
    expect(msg).toContain('<https://app.clickup.com/t/abc|Tarea X>');
    expect(msg).toContain('mas de 36 horas en estado QA');
  });
});

function manualCall(partial: Partial<AttentionCall>): AttentionCall {
  return {
    id: Math.random().toString(36).slice(2),
    timestampLocal: '',
    timestampMs: 0,
    dateKey: '2026-07-07',
    weekKey: '2026-07-06',
    periodKey: '2026_P3',
    taskId: '',
    taskName: '',
    taskUrl: '',
    currentStatus: '',
    alertType: 'MANUAL',
    personKey: 'Jose',
    personName: 'Jose',
    slackUserId: 'U123',
    reason: 'x',
    hoursElapsed: 0,
    dueDateLocal: '',
    statusChangeLocal: '',
    tolerance: partial.isTolerance ? 'SI 1/2' : 'NO 3/2',
    isTolerance: partial.isTolerance ?? false,
    weeklyCountAfter: 0,
    periodAttentionCountAfter: null,
    slackOk: true,
    slackTs: '',
    slackError: '',
    message: '',
    origin: 'manual',
    deleted: partial.deleted ?? false,
    ...partial
  };
}

describe('llamada manual: conteo', () => {
  it('una manual formal cuenta como formal y aparece en formalByReason.MANUAL', () => {
    const s = summarize([manualCall({ isTolerance: false }), manualCall({ isTolerance: true })]);
    expect(s.formalCalls).toBe(1);
    expect(s.tolerances).toBe(1);
    expect(s.formalByReason.MANUAL).toBe(1);
  });

  it('una manual anulada no cuenta', () => {
    const s = summarize([manualCall({ isTolerance: false, deleted: true })]);
    expect(s.formalCalls).toBe(0);
    expect(s.annulled).toBe(1);
  });
});
