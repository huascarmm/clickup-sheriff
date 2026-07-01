/**
 * Repositorio de personas (coleccion people). Reemplaza la hoja config_personas.
 * Implementa el PersonResolver que usan las reglas: resolver persona por el
 * string del campo QA o por el assignee de ClickUp, con la misma logica de
 * alias que el original.
 */
import type { Firestore } from 'firebase-admin/firestore';
import type { Assignee, Person } from '../domain/types.js';
import { normalize } from '../domain/clickupTask.js';
import type { PersonResolver } from '../domain/rules.js';

export const PEOPLE_COLLECTION = 'people';

export async function listPeople(db: Firestore, includeInactive = true): Promise<Person[]> {
  const snap = await db.collection(PEOPLE_COLLECTION).get();
  const people = snap.docs.map((d) => normalizePerson(d.id, d.data()));
  return includeInactive ? people : people.filter((p) => p.activo);
}

export async function upsertPerson(db: Firestore, person: Partial<Person> & { person_key: string }): Promise<Person> {
  const key = String(person.person_key).trim();
  if (!key) throw new Error('person_key requerido');
  const doc = normalizePerson(key, person);
  await db.collection(PEOPLE_COLLECTION).doc(key).set(doc, { merge: true });
  return doc;
}

export async function deletePerson(db: Firestore, personKey: string): Promise<void> {
  await db.collection(PEOPLE_COLLECTION).doc(personKey).delete();
}

function normalizePerson(key: string, raw: Record<string, unknown>): Person {
  const s = (v: unknown) => String(v ?? '').trim();
  const activoRaw = raw.activo;
  const activo =
    typeof activoRaw === 'boolean'
      ? activoRaw
      : normalize(activoRaw) !== 'no' && s(activoRaw) !== 'false';
  return {
    person_key: key,
    nombre_visible: s(raw.nombre_visible),
    qa_string: s(raw.qa_string),
    clickup_user_id: s(raw.clickup_user_id),
    clickup_username: s(raw.clickup_username),
    clickup_email: s(raw.clickup_email),
    slack_user_id: s(raw.slack_user_id),
    activo,
    notas: s(raw.notas)
  };
}

/** Persona "desconocida" cuando no hay match en la config. */
export function unknownPerson(key: string, name: string): Person {
  return {
    person_key: key,
    nombre_visible: name,
    qa_string: '',
    clickup_user_id: '',
    clickup_username: '',
    clickup_email: '',
    slack_user_id: '',
    activo: true,
    notas: 'No encontrado en people'
  };
}

function matchesAlias(value: string, aliasesText: string): boolean {
  const target = normalize(value);
  const aliases = String(aliasesText || '')
    .split(/[;,|]/)
    .map((s) => normalize(s))
    .filter(Boolean);
  return aliases.includes(target);
}

/** Construye un PersonResolver a partir de la lista de personas activas. */
export function makePersonResolver(people: Person[]): PersonResolver {
  const active = people.filter((p) => p.activo && !normalize(p.person_key).startsWith('ejemplo'));

  return {
    findByQaString(qaString: string): Person {
      const target = String(qaString || '').trim();
      if (!target) return unknownPerson('qa_sin_configurar', 'QA sin configurar');
      const found = active.find((p) => matchesAlias(target, p.qa_string));
      return found ?? unknownPerson(`qa:${target}`, target);
    },
    findByAssignee(assignee: Assignee): Person {
      if (!assignee) return unknownPerson('sin_asignado', 'Sin asignado');
      const candidates = [
        String(assignee.id || '').trim(),
        String(assignee.username || '').trim(),
        String(assignee.name || '').trim(),
        String(assignee.email || '').trim()
      ].filter(Boolean);

      const found = active.find((p) => {
        const matchId = p.clickup_user_id && candidates.some((c) => c === p.clickup_user_id);
        const matchUsername = p.clickup_username && candidates.some((c) => matchesAlias(c, p.clickup_username));
        const matchEmail = p.clickup_email && candidates.some((c) => normalize(c) === normalize(p.clickup_email));
        return matchId || matchUsername || matchEmail;
      });
      if (found) return found;

      const display =
        assignee.name || assignee.username || assignee.email || assignee.id || 'Asignado no configurado';
      return unknownPerson(`assignee:${display}`, display);
    }
  };
}
