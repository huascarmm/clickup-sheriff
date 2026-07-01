/**
 * Helpers para leer datos de una tarea de ClickUp de forma tolerante.
 * Portados 1:1 desde el Apps Script (getTaskStatusName_, getCustomField*,
 * getPrimaryAssignee_, etc.) para conservar el comportamiento probado.
 */
import type { Assignee, ClickUpCustomField, ClickUpTask } from './types.js';

/** Normaliza texto para comparaciones (minusculas, sin acentos, trim). */
export function normalize(text: unknown): string {
  return String(text ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

export function getTaskStatusName(task: ClickUpTask): string {
  if (!task) return '';
  if (typeof task.status === 'string') return task.status;
  if (task.status && typeof task.status === 'object' && task.status.status) {
    return task.status.status;
  }
  return '';
}

export function getTaskDueDateMs(task: ClickUpTask): number | null {
  if (!task || task.due_date === null || task.due_date === undefined || task.due_date === '') {
    return null;
  }
  const n = Number(task.due_date);
  if (Number.isNaN(n) || n <= 0) return null;
  return n;
}

export function getTaskUrl(task: ClickUpTask): string {
  if (task.url) return task.url;
  return `https://app.clickup.com/t/${task.id}`;
}

export function getCustomFieldByName(
  task: ClickUpTask,
  fieldName: string
): ClickUpCustomField | null {
  const fields = task.custom_fields || [];
  return fields.find((f) => normalize(f.name) === normalize(fieldName)) || null;
}

export function getCustomFieldDateMs(task: ClickUpTask, fieldName: string): number | null {
  const field = getCustomFieldByName(task, fieldName);
  if (!field || field.value === null || field.value === undefined || field.value === '') {
    return null;
  }
  const n = Number(field.value);
  if (Number.isNaN(n) || n <= 0) return null;
  return n;
}

export function getCustomFieldDisplayValue(task: ClickUpTask, fieldName: string): string {
  const field = getCustomFieldByName(task, fieldName);
  if (!field) return '';
  const value = field.value;
  if (value === null || value === undefined || value === '') return '';
  if (field.type === 'drop_down') return getDropdownOptionName(field, value);
  if (field.type === 'labels') return getLabelsDisplayValue(field, value);
  return String(value);
}

function getDropdownOptionName(field: ClickUpCustomField, value: unknown): string {
  const options = field.type_config?.options ?? [];
  const rawValue = String(value);
  const byId = options.find((o) => String(o.id) === rawValue);
  if (byId?.name) return byId.name;
  const byOrderIndex = options.find((o) => String(o.orderindex) === rawValue);
  if (byOrderIndex?.name) return byOrderIndex.name;
  const numericIndex = Number(value);
  if (!Number.isNaN(numericIndex) && options[numericIndex]?.name) {
    return options[numericIndex].name as string;
  }
  return String(value);
}

function getLabelsDisplayValue(field: ClickUpCustomField, value: unknown): string {
  const options = field.type_config?.options ?? [];
  if (!Array.isArray(value)) return String(value);
  return value
    .map((id) => {
      const option = options.find((o) => String(o.id) === String(id));
      return option?.name ?? String(id);
    })
    .join(', ');
}

export function getPrimaryAssignee(task: ClickUpTask): Assignee {
  const assignees = task.assignees || [];
  if (!assignees.length) {
    return { id: '', username: '', name: '', email: '' };
  }
  const a = assignees[0];
  return {
    id: String(a.id ?? ''),
    username: a.username ?? '',
    name: a.name ?? a.username ?? '',
    email: a.email ?? ''
  };
}

export function isIgnoredStatus(normalizedStatus: string, ignoredStatuses: string[]): boolean {
  if (!ignoredStatuses.length) return false;
  const ignored = ignoredStatuses.map((s) => normalize(s)).filter(Boolean);
  return ignored.includes(normalizedStatus);
}
