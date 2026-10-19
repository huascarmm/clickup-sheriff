/**
 * Metas por proyecto (Panel de revisor). Funciones PURAS: validan el payload
 * del webhook POST /webhooks/goals y deciden si el plazo de una meta termino.
 *
 * Formato del payload (la lista COMPLETA; reemplaza a la anterior):
 *
 *   {
 *     "projects": [
 *       {
 *         "name": "Portal clientes",
 *         "goals": [
 *           { "name": "MVP en staging", "dueDate": "2026-10-15", "completed": 26, "personKey": "Jose" }
 *         ]
 *       }
 *     ]
 *   }
 *
 *   - dueDate: fecha de finalizacion, yyyy-MM-dd (dia local de settings.timezone).
 *     Opcional: si falta (o viene null / ""), la meta queda "sin fecha" y nunca
 *     cuenta como vencida. Si viene con otro formato, se rechaza el payload.
 *   - completed: % de avance, numero de 0 a 100 (admite decimales). Opcional: si
 *     falta (o viene null) queda sin dato. Que una meta con plazo terminado
 *     cuente como "vencida" depende de un umbral de avance que decide el panel
 *     (no el servidor); sin dato de avance, se trata como 0%.
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
  completed: number | null;
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
 * El plazo de una meta termina al acabar su dia: el de hoy todavia no termino.
 * Una meta sin fecha no tiene plazo (el panel la muestra aparte, "sin fecha").
 * Si ademas cuenta como vencida lo decide el panel con su umbral de avance.
 */
export function isGoalPastDue(dueDate: string | null, todayKey: string): boolean {
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
        const g = (rawGoal || {}) as { name?: unknown; dueDate?: unknown; completed?: unknown; personKey?: unknown };
        const goalName = requiredText(g.name, `${path}.name`, MAX_GOAL_NAME);
        const missingDate = g.dueDate === undefined || g.dueDate === null || g.dueDate === '';
        if (!missingDate && (typeof g.dueDate !== 'string' || !isValidDateKey(g.dueDate))) {
          throw new Error(`${path}.dueDate debe ser una fecha yyyy-MM-dd`);
        }
        const dueDate = missingDate ? null : (g.dueDate as string);
        let completed: number | null = null;
        if (g.completed !== undefined && g.completed !== null) {
          if (typeof g.completed !== 'number' || !Number.isFinite(g.completed) || g.completed < 0 || g.completed > 100) {
            throw new Error(`${path}.completed debe ser un numero de 0 a 100`);
          }
          completed = Math.round(g.completed * 100) / 100; // DECIMAL(5,2)
        }
        let personKey: string | null = null;
        if (g.personKey !== undefined && g.personKey !== null) {
          if (typeof g.personKey !== 'string') throw new Error(`${path}.personKey debe ser texto`);
          if (g.personKey.trim()) personKey = requiredText(g.personKey, `${path}.personKey`, MAX_PERSON_KEY);
        }
        return { name: goalName, dueDate, completed, personKey };
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
