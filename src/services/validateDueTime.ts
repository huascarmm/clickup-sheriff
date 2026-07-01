/**
 * Validador de plazo (segundo sistema del Apps Script original).
 * Cuando cambia el due_date de una tarea, decide si la hora es "personalizada"
 * (distinta de la hora default de ClickUp, 04:00) y marca un custom field
 * checkbox en ClickUp.
 */
import type { Settings, ClickUpTask } from '../domain/types.js';
import { tzParts } from '../domain/time.js';
import { getCustomFieldByName, normalize } from '../domain/clickupTask.js';
import type { ClickUpService } from './clickup.js';

export interface ValidateDueTimeResult {
  ok: true;
  taskId: string;
  taskName: string;
  localDueDate: string;
  fechaPlazo: boolean;
}

export async function validateDueTime(
  task: ClickUpTask,
  settings: Settings,
  clickup: ClickUpService
): Promise<ValidateDueTimeResult> {
  const dueMs = extractDueDateMs(task);

  let hasCustomHour = false;
  let localDueDate = 'SIN PLAZO';

  if (dueMs) {
    const p = tzParts(new Date(dueMs), settings.timezone);
    localDueDate = `${p.year}-${pad2(p.month)}-${pad2(p.day)} ${pad2(p.hour)}:${pad2(p.minute)}`;
    const isDefault = p.hour === settings.plazoHourDefault && p.minute === settings.plazoMinuteDefault;
    hasCustomHour = !isDefault;
  }

  const fieldId = resolveFieldId(task, settings);
  if (!fieldId) {
    throw new Error(
      `No se encontro el Custom Field "${settings.plazoFieldName}". Verifica que exista como checkbox.`
    );
  }

  await clickup.setCheckboxField(task.id, fieldId, hasCustomHour);

  return {
    ok: true,
    taskId: task.id,
    taskName: task.name || '',
    localDueDate,
    fechaPlazo: hasCustomHour
  };
}

function extractDueDateMs(task: ClickUpTask): number | null {
  const candidates = [task.due_date, task.time_mgmt?.due_date];
  for (const value of candidates) {
    if (value !== null && value !== undefined && value !== '') {
      const n = Number(value);
      if (!Number.isNaN(n) && n > 0) return n;
    }
  }
  return null;
}

function resolveFieldId(task: ClickUpTask, settings: Settings): string | null {
  if (settings.plazoFieldId) return settings.plazoFieldId;
  const field = getCustomFieldByName(task, settings.plazoFieldName);
  if (!field) return null;
  if (field.type && field.type !== 'checkbox') {
    throw new Error(
      `El campo "${settings.plazoFieldName}" existe pero no es checkbox. Tipo actual: ${field.type}`
    );
  }
  return field.id || null;
}

export function extractTaskId(body: Record<string, any>): string | null {
  return (body?.payload && body.payload.id) || body?.task_id || body?.id || null;
}

export { normalize };

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
