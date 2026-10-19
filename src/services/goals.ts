/**
 * Almacenamiento de las metas por proyecto (Panel de revisor).
 *
 * Cada webhook trae la lista COMPLETA, asi que se guarda como snapshot: se
 * borra lo anterior y se inserta lo nuevo dentro de una sola transaccion. Asi
 * un reintento del mismo webhook deja exactamente el mismo resultado, y quien
 * lee nunca ve una lista a medio reemplazar.
 */
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { withTransaction, type DbConn } from '../db.js';
import { isGoalPastDue, type GoalProjectInput } from '../domain/goals.js';

export const PROJECTS_TABLE = 'review_projects';
export const GOALS_TABLE = 'review_goals';

export interface ReviewGoal {
  id: string;
  name: string;
  dueDate: string | null; // null = la meta llego sin fecha
  completed: number | null; // % de avance; null = sin dato
  personKey: string | null;
  personName: string | null;
  // Plazo terminado. "Vencida" = pastDue y avance bajo el umbral, que decide
  // el panel (el umbral solo vive en el cliente).
  pastDue: boolean;
}

export interface ReviewProject {
  name: string;
  goals: ReviewGoal[];
}

export interface ReviewGoalsSnapshot {
  receivedAtMs: number | null;
  projects: ReviewProject[];
}

/** Reemplaza todas las metas por las del payload. Devuelve cuantas se guardaron. */
export async function replaceGoals(
  projects: GoalProjectInput[],
  nowMs: number
): Promise<{ projects: number; goals: number }> {
  return withTransaction(async (tx) => {
    // ON DELETE CASCADE borra tambien las metas.
    await tx.query(`DELETE FROM ${PROJECTS_TABLE}`);

    let goals = 0;
    for (const project of projects) {
      const [result] = await tx.query<ResultSetHeader>(
        `INSERT INTO ${PROJECTS_TABLE} (name, received_at_ms) VALUES (?, ?)`,
        [project.name, nowMs]
      );
      if (project.goals.length) {
        const rows = project.goals.map((g) => [result.insertId, g.name, g.dueDate, g.completed, g.personKey]);
        await tx.query(`INSERT INTO ${GOALS_TABLE} (project_id, name, due_date, completed, person_key) VALUES ?`, [
          rows
        ]);
        goals += rows.length;
      }
    }
    return { projects: projects.length, goals };
  });
}

/**
 * Lista proyectos (por nombre) con sus metas (por fecha de finalizacion, la
 * mas proxima primero; las sin fecha al final) y marca las de plazo terminado
 * respecto a todayKey (yyyy-MM-dd).
 */
export async function listGoalProjects(db: DbConn, todayKey: string): Promise<ReviewGoalsSnapshot> {
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT p.id AS project_id, p.name AS project_name, p.received_at_ms,
            g.id AS goal_id, g.name AS goal_name, DATE_FORMAT(g.due_date, '%Y-%m-%d') AS due_date,
            g.completed, g.person_key, pe.nombre_visible AS person_name
     FROM ${PROJECTS_TABLE} p
     LEFT JOIN ${GOALS_TABLE} g ON g.project_id = p.id
     LEFT JOIN people pe ON pe.person_key = g.person_key
     ORDER BY p.name ASC, p.id ASC, g.due_date IS NULL ASC, g.due_date ASC, g.id ASC`
  );

  const projects: ReviewProject[] = [];
  const byId = new Map<number, ReviewProject>();
  let receivedAtMs: number | null = null;

  for (const row of rows) {
    let project = byId.get(row.project_id);
    if (!project) {
      project = { name: row.project_name, goals: [] };
      byId.set(row.project_id, project);
      projects.push(project);
      // Todo el snapshot llega en el mismo webhook: comparten received_at_ms.
      receivedAtMs = Number(row.received_at_ms);
    }
    // Proyecto sin metas: el LEFT JOIN trae una fila con goal_id NULL.
    if (row.goal_id == null) continue;

    project.goals.push({
      id: String(row.goal_id),
      name: row.goal_name,
      dueDate: row.due_date ?? null,
      // mysql2 entrega DECIMAL como string.
      completed: row.completed == null ? null : Number(row.completed),
      personKey: row.person_key ?? null,
      personName: row.person_name || null,
      pastDue: isGoalPastDue(row.due_date ?? null, todayKey)
    });
  }

  return { receivedAtMs, projects };
}
