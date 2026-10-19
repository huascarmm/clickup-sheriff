/**
 * Metas por proyecto (Panel de revisor). Funciones PURAS: validan el payload
 * del webhook POST /webhooks/goals y deciden si una meta esta vencida.
 *
 * Formato del payload (la lista COMPLETA; reemplaza a la anterior):
 *
 *   {
 *     "projects": [
 *       {
 *         "name": "Portal clientes",
 *         "goals": [
 *           { "name": "MVP en staging", "dueDate": "2026-10-15", "personKey": "Jose" }
 *         ]
 *       }
 *     ]
 *   }
 *
 *   - dueDate: fecha de finalizacion, yyyy-MM-dd (dia local de settings.timezone).
 *     Opcional: si falta (o viene null / ""), la meta queda "sin fecha" y nunca
 *     cuenta como vencida. Si viene con otro formato, se rechaza el payload.
 *   - { "projects": [] } es valido: borra la lista vigente.
 *   - personKey: opcional; responsable de la meta (people.person_key). Si viene,
 *     el panel lo propone al crear una llamada de atencion por meta vencida.
 *
 * Si dos proyectos traen el mismo nombre (sin distinguir mayusculas ni espacios
 * de los extremos), sus metas se agrupan bajo el primero.
 */

export const MAX_PROJECTS = 500;
export const MAX_GOALS_PER_PROJECT = 500;
const MAX_PROJECT_NAME = 191;
const MAX_GOAL_NAME = 512;
const MAX_PERSON_KEY = 191;

export interface GoalInput {
  name: string;
  dueDate: string | null;
  personKey: string | null;
}

export interface GoalProjectInput {
  name: string;
  goals: GoalInput[];
}

export type ParseGoalsResult = { ok: true; projects: GoalProjectInput[] } | { ok: false; error: string };

/** true si el texto es una fecha real en formato yyyy-MM-dd (rechaza 2026-02-30). */
export function isValidDateKey(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/**
 * Una meta vence al terminar su dia: la de hoy todavia no esta vencida. Una
 * meta sin fecha no vence nunca (el panel la muestra aparte, como "sin fecha").
 */
export function isGoalOverdue(dueDate: string | null, todayKey: string): boolean {
  return dueDate !== null && dueDate < todayKey;
}

function requiredText(value: unknown, path: string, max: number): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${path} es obligatorio`);
  const text = value.trim();
  if (text.length > max) throw new Error(`${path} supera ${max} caracteres`);
  return text;
}

export function parseGoalsPayload(body: unknown): ParseGoalsResult {
  try {
    const projects = (body as { projects?: unknown } | null)?.projects;
    if (!Array.isArray(projects)) throw new Error('projects debe ser una lista');
    if (projects.length > MAX_PROJECTS) throw new Error(`projects admite como maximo ${MAX_PROJECTS} elementos`);

    const byName = new Map<string, GoalProjectInput>();
    projects.forEach((rawProject, i) => {
      const p = (rawProject || {}) as { name?: unknown; goals?: unknown };
      const name = requiredText(p.name, `projects[${i}].name`, MAX_PROJECT_NAME);
      if (!Array.isArray(p.goals)) throw new Error(`projects[${i}].goals debe ser una lista`);

      const goals = p.goals.map((rawGoal, j): GoalInput => {
        const path = `projects[${i}].goals[${j}]`;
        const g = (rawGoal || {}) as { name?: unknown; dueDate?: unknown; personKey?: unknown };
        const goalName = requiredText(g.name, `${path}.name`, MAX_GOAL_NAME);
        const missingDate = g.dueDate === undefined || g.dueDate === null || g.dueDate === '';
        if (!missingDate && (typeof g.dueDate !== 'string' || !isValidDateKey(g.dueDate))) {
          throw new Error(`${path}.dueDate debe ser una fecha yyyy-MM-dd`);
        }
        const dueDate = missingDate ? null : (g.dueDate as string);
        let personKey: string | null = null;
        if (g.personKey !== undefined && g.personKey !== null) {
          if (typeof g.personKey !== 'string') throw new Error(`${path}.personKey debe ser texto`);
          if (g.personKey.trim()) personKey = requiredText(g.personKey, `${path}.personKey`, MAX_PERSON_KEY);
        }
        return { name: goalName, dueDate, personKey };
      });

      const key = name.toLowerCase();
      const existing = byName.get(key);
      if (existing) existing.goals.push(...goals);
      else byName.set(key, { name, goals });
    });

    const merged = [...byName.values()];
    const tooMany = merged.find((p) => p.goals.length > MAX_GOALS_PER_PROJECT);
    if (tooMany) throw new Error(`el proyecto "${tooMany.name}" supera ${MAX_GOALS_PER_PROJECT} metas`);
    return { ok: true, projects: merged };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
