/**
 * Reglas de negocio: dado una tarea y la configuracion, decide si corresponde
 * una llamada de atencion y de que tipo. Funcion PURA (sin I/O), por eso es
 * facil de testear al 100%.
 *
 * Regla central (la que costo depurar): cada estado dispara COMO MAXIMO una via
 * de evaluacion.
 *   - QA          -> evaluateQaStatusDelay
 *   - FIXING QA   -> evaluateFixingQaStatusDelay
 *   - otro estado -> evaluateDueDateOverdue
 * Los estados en ignoredStatuses (done/closed/completado) no se evaluan.
 */
import type { AlertDecision, Person, Settings, ClickUpTask } from './types.js';
import {
  getCustomFieldDateMsById,
  getCustomFieldDisplayValueById,
  getPrimaryAssignee,
  getTaskDueDateMs,
  getTaskStatusName,
  isIgnoredStatus,
  normalize
} from './clickupTask.js';
import { calculateElapsedHours } from './time.js';

export interface PersonResolver {
  findByQaString(qaString: string): Person;
  findByAssignee(assignee: { id: string; username: string; name: string; email: string }): Person;
}

export type EvaluationResult =
  | { kind: 'ignored'; status: string; reason: string }
  | { kind: 'none'; status: string }
  | { kind: 'alert'; status: string; decision: AlertDecision };

export function evaluateTask(
  task: ClickUpTask,
  settings: Settings,
  people: PersonResolver,
  now: number = Date.now()
): EvaluationResult {
  const statusName = getTaskStatusName(task);
  const normalizedStatus = normalize(statusName);

  if (isIgnoredStatus(normalizedStatus, settings.ignoredStatuses)) {
    return { kind: 'ignored', status: statusName, reason: 'Estado ignorado por configuracion' };
  }

  const qaStatus = normalize(settings.qaStatusName || 'QA');
  const fixingQaStatus = normalize(settings.fixingQaStatusName || 'FIXING QA');

  let decision: AlertDecision | null;
  if (normalizedStatus === qaStatus) {
    decision = evaluateQaStatusDelay(task, settings, people, now);
  } else if (normalizedStatus === fixingQaStatus) {
    decision = evaluateFixingQaStatusDelay(task, settings, people, now);
  } else {
    decision = evaluateDueDateOverdue(task, settings, people, now);
  }

  if (!decision) return { kind: 'none', status: statusName };
  return { kind: 'alert', status: statusName, decision };
}

export function evaluateQaStatusDelay(
  task: ClickUpTask,
  settings: Settings,
  people: PersonResolver,
  now: number
): AlertDecision | null {
  const limitHours = Number(settings.qaHoursLimit || 36);
  const statusChangeMs = getCustomFieldDateMsById(task, settings.statusChangeFieldId);
  if (!statusChangeMs) return null;

  const elapsedHours = calculateElapsedHours(statusChangeMs, now);
  if (elapsedHours < limitHours) return null;

  const qaString = getCustomFieldDisplayValueById(task, settings.qaFieldId);
  const person = people.findByQaString(qaString);

  return {
    alertType: 'QA_36H',
    person,
    reason: `Tarea con mas de ${limitHours} horas en estado QA`,
    hoursElapsed: elapsedHours,
    statusChangeMs,
    dueDateMs: null
  };
}

export function evaluateFixingQaStatusDelay(
  task: ClickUpTask,
  settings: Settings,
  people: PersonResolver,
  now: number
): AlertDecision | null {
  const limitHours = Number(settings.fixingHoursLimit || 36);
  const statusChangeMs = getCustomFieldDateMsById(task, settings.statusChangeFieldId);
  if (!statusChangeMs) return null;

  const elapsedHours = calculateElapsedHours(statusChangeMs, now);
  if (elapsedHours < limitHours) return null;

  const assignee = getPrimaryAssignee(task);
  const person = people.findByAssignee(assignee);

  return {
    alertType: 'FIXING_QA_36H',
    person,
    reason: `Tarea con mas de ${limitHours} horas en estado FIXING QA`,
    hoursElapsed: elapsedHours,
    statusChangeMs,
    dueDateMs: null
  };
}

export function evaluateDueDateOverdue(
  task: ClickUpTask,
  _settings: Settings,
  people: PersonResolver,
  now: number
): AlertDecision | null {
  const dueDateMs = getTaskDueDateMs(task);
  if (!dueDateMs) return null;
  if (dueDateMs >= now) return null;

  const assignee = getPrimaryAssignee(task);
  const person = people.findByAssignee(assignee);

  return {
    alertType: 'ATRASO_PLAZO',
    person,
    reason: 'Tarea atrasada por vencimiento de plazo de ejecucion',
    hoursElapsed: calculateElapsedHours(dueDateMs, now),
    statusChangeMs: null,
    dueDateMs
  };
}
