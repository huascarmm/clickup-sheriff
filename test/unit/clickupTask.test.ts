import { describe, it, expect } from 'vitest';
import {
  getCustomFieldDisplayValue,
  getPrimaryAssignee,
  getTaskDueDateMs,
  getTaskStatusName,
  normalize
} from '../../src/domain/clickupTask.js';
import { makePersonResolver } from '../../src/services/people.js';
import type { Person, ClickUpTask } from '../../src/domain/types.js';

describe('clickupTask parsing', () => {
  it('normalize quita acentos y capitaliza', () => {
    expect(normalize('  Huáscar ')).toBe('huascar');
    expect(normalize('FIXING QA')).toBe('fixing qa');
  });

  it('getTaskStatusName soporta string y objeto', () => {
    expect(getTaskStatusName({ id: 't', status: 'QA' })).toBe('QA');
    expect(getTaskStatusName({ id: 't', status: { status: 'FIXING QA' } })).toBe('FIXING QA');
  });

  it('getTaskDueDateMs valida numeros', () => {
    expect(getTaskDueDateMs({ id: 't', due_date: 1700000000000 })).toBe(1700000000000);
    expect(getTaskDueDateMs({ id: 't', due_date: '0' })).toBeNull();
    expect(getTaskDueDateMs({ id: 't', due_date: null })).toBeNull();
  });

  it('getCustomFieldDisplayValue resuelve dropdown por orderindex', () => {
    const task: ClickUpTask = {
      id: 't',
      custom_fields: [
        {
          name: 'QA',
          type: 'drop_down',
          value: 1,
          type_config: { options: [{ orderindex: 0, name: 'Jose' }, { orderindex: 1, name: 'Bruno' }] }
        }
      ]
    };
    expect(getCustomFieldDisplayValue(task, 'QA')).toBe('Bruno');
  });

  it('getPrimaryAssignee toma el primero', () => {
    const a = getPrimaryAssignee({ id: 't', assignees: [{ id: 9, username: 'juan' } as any] });
    expect(a.username).toBe('juan');
  });
});

const people: Person[] = [
  {
    person_key: 'Huascar',
    nombre_visible: 'Huascar',
    qa_string: 'Huascar',
    clickup_user_id: '6387252',
    clickup_username: 'Huascar Miranda',
    clickup_email: 'huascarm@gmail.com',
    slack_user_id: 'U070EMYRYTH',
    activo: true,
    notas: ''
  },
  {
    person_key: 'Jose',
    nombre_visible: 'Jose',
    qa_string: 'Jose',
    clickup_user_id: '96809959',
    clickup_username: 'Jose Mendoza',
    clickup_email: 'joseemendozaan1@gmail.com',
    slack_user_id: 'U07CCMKLZ3P',
    activo: true,
    notas: ''
  }
];

describe('person resolver', () => {
  const resolver = makePersonResolver(people);

  it('findByQaString hace match por qa_string', () => {
    expect(resolver.findByQaString('Jose').person_key).toBe('Jose');
    expect(resolver.findByQaString('  huascar ').person_key).toBe('Huascar');
  });

  it('findByQaString desconocido devuelve unknown', () => {
    expect(resolver.findByQaString('Nadie').person_key).toBe('qa:Nadie');
  });

  it('findByAssignee hace match por user_id, username o email', () => {
    expect(resolver.findByAssignee({ id: '6387252', username: '', name: '', email: '' }).person_key).toBe('Huascar');
    expect(resolver.findByAssignee({ id: '', username: 'Jose Mendoza', name: '', email: '' }).person_key).toBe('Jose');
    expect(resolver.findByAssignee({ id: '', username: '', name: '', email: 'HUASCARM@gmail.com' }).person_key).toBe('Huascar');
  });

  it('findByAssignee desconocido devuelve unknown con display', () => {
    const p = resolver.findByAssignee({ id: '', username: 'Rodrigo', name: 'Rodrigo', email: '' });
    expect(p.person_key).toBe('assignee:Rodrigo');
    expect(p.slack_user_id).toBe('');
  });
});
