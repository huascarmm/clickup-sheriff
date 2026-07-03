import { describe, it, expect } from 'vitest';
import { evaluateTask, type PersonResolver } from '../../src/domain/rules.js';
import { DEFAULT_SETTINGS } from '../../src/config.js';
import type { Person, ClickUpTask } from '../../src/domain/types.js';

const NOW = Date.UTC(2026, 4, 18, 12, 0); // 2026-05-18 12:00Z
const H = 3600_000;

function person(key: string): Person {
  return {
    person_key: key,
    nombre_visible: key,
    qa_string: key,
    clickup_user_id: '',
    clickup_username: key,
    clickup_email: '',
    login_email: '',
    slack_user_id: 'U' + key,
    activo: true,
    notas: ''
  };
}

const resolver: PersonResolver = {
  findByQaString: (qa) => person(qa || 'qa_sin_configurar'),
  findByAssignee: (a) => person(a.username || a.name || 'sin_asignado')
};

const settings = { ...DEFAULT_SETTINGS, qaFieldId: 'FID_REVISOR', statusChangeFieldId: 'FID_STATUS_CHANGE' };

describe('rules: exclusividad de estado', () => {
  it('QA con >=36h dispara SOLO QA_36H (no ATRASO aunque este vencida)', () => {
    const task: ClickUpTask = {
      id: 't1',
      status: { status: 'QA' },
      due_date: NOW - 100 * H, // vencidisima
      assignees: [{ username: 'Huascar' }],
      custom_fields: [
        { id: 'FID_STATUS_CHANGE', name: 'time_status_change', type: 'date', value: NOW - 40 * H },
        { id: 'FID_REVISOR', name: 'REVISOR', type: 'short_text', value: 'Jose' }
      ]
    };
    const r = evaluateTask(task, settings, resolver, NOW);
    expect(r.kind).toBe('alert');
    if (r.kind === 'alert') {
      expect(r.decision.alertType).toBe('QA_36H');
      expect(r.decision.person.person_key).toBe('Jose');
    }
  });

  it('QA con <36h no dispara nada', () => {
    const task: ClickUpTask = {
      id: 't2',
      status: { status: 'QA' },
      custom_fields: [{ id: 'FID_STATUS_CHANGE', name: 'time_status_change', type: 'date', value: NOW - 10 * H }]
    };
    expect(evaluateTask(task, settings, resolver, NOW).kind).toBe('none');
  });

  it('FIXING QA con >=36h dispara SOLO FIXING_QA_36H con el assignee', () => {
    const task: ClickUpTask = {
      id: 't3',
      status: { status: 'FIXING QA' },
      due_date: NOW - 100 * H,
      assignees: [{ username: 'Huascar' }],
      custom_fields: [{ id: 'FID_STATUS_CHANGE', name: 'time_status_change', type: 'date', value: NOW - 48 * H }]
    };
    const r = evaluateTask(task, settings, resolver, NOW);
    expect(r.kind).toBe('alert');
    if (r.kind === 'alert') {
      expect(r.decision.alertType).toBe('FIXING_QA_36H');
      expect(r.decision.person.person_key).toBe('Huascar');
    }
  });

  it('otro estado vencido dispara ATRASO_PLAZO con el assignee', () => {
    const task: ClickUpTask = {
      id: 't4',
      status: { status: 'doing' },
      due_date: NOW - 6 * H,
      assignees: [{ username: 'Bruno' }]
    };
    const r = evaluateTask(task, settings, resolver, NOW);
    expect(r.kind).toBe('alert');
    if (r.kind === 'alert') {
      expect(r.decision.alertType).toBe('ATRASO_PLAZO');
      expect(r.decision.person.person_key).toBe('Bruno');
    }
  });

  it('otro estado NO vencido no dispara', () => {
    const task: ClickUpTask = {
      id: 't5',
      status: { status: 'doing' },
      due_date: NOW + 10 * H,
      assignees: [{ username: 'Bruno' }]
    };
    expect(evaluateTask(task, settings, resolver, NOW).kind).toBe('none');
  });

  it('estados terminales/planificacion (production/done/closed) no se evaluan', () => {
    for (const st of ['production', 'PRODUCTION', 'done', 'closed', 'completado', 'DONE']) {
      const task: ClickUpTask = { id: 'ti', status: { status: st }, due_date: NOW - 100 * H, assignees: [{ username: 'Bruno' }] };
      expect(evaluateTask(task, settings, resolver, NOW).kind).toBe('ignored');
    }
  });

  it('QA sin time_status_change no dispara', () => {
    const task: ClickUpTask = { id: 'tx', status: { status: 'QA' }, custom_fields: [{ id: 'FID_REVISOR', name: 'REVISOR', value: 'Jose' }] };
    expect(evaluateTask(task, settings, resolver, NOW).kind).toBe('none');
  });
});
