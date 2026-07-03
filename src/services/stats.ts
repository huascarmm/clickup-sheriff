/**
 * Estadisticas de llamadas de atencion.
 *
 * Definiciones (importantes para el punto critico del conteo):
 *  - "Llamada formal" = alerta con isTolerance=false (paso la tolerancia semanal).
 *  - El CONTADOR OFICIAL por persona = llamadas formales NO anuladas (deleted=false)
 *    dentro del periodo vigente. Este es el numero que importa (llegar a 9 es
 *    critico). Las tolerancias y las anuladas NO cuentan.
 *  - Ademas exponemos el total bruto de alertas para diagnostico.
 */
import type { Firestore } from 'firebase-admin/firestore';
import type { AlertType, AttentionCall } from '../domain/types.js';
import { VALID_ALERT_TYPES } from '../domain/types.js';
import { CALLS_COLLECTION } from './attention.js';

export interface StatsBreakdown {
  /** Total de alertas registradas (todas, para diagnostico). */
  totalAlerts: number;
  /** Avisos de tolerancia (isTolerance=true, no anulados). */
  tolerances: number;
  /** Llamadas formales vigentes (isTolerance=false, no anuladas) = CONTADOR OFICIAL. */
  formalCalls: number;
  /** Anuladas (deleted=true). */
  annulled: number;
  /** Formales por tipo de alerta (razon). */
  formalByReason: Record<AlertType, number>;
  /** Fallos de envio a Slack (entre no anuladas). */
  slackFailures: number;
}

export interface PersonPeriodStats extends StatsBreakdown {
  personKey: string;
  personName: string;
  periodKey: string;
}

function emptyBreakdown(): StatsBreakdown {
  return {
    totalAlerts: 0,
    tolerances: 0,
    formalCalls: 0,
    annulled: 0,
    formalByReason: { QA_36H: 0, FIXING_QA_36H: 0, ATRASO_PLAZO: 0 },
    slackFailures: 0
  };
}

const validTypes = new Set<string>(VALID_ALERT_TYPES);

/** Acumula una llamada en un breakdown. Funcion PURA (testeable). */
export function accumulate(acc: StatsBreakdown, call: AttentionCall): StatsBreakdown {
  if (!validTypes.has(String(call.alertType))) return acc;
  acc.totalAlerts += 1;
  if (call.deleted) {
    acc.annulled += 1;
    return acc; // anuladas no cuentan para tolerancia/formal/slack
  }
  if (call.isTolerance) {
    acc.tolerances += 1;
  } else {
    acc.formalCalls += 1;
    acc.formalByReason[call.alertType as AlertType] += 1;
  }
  if (!call.slackOk) acc.slackFailures += 1;
  return acc;
}

/** Reduce una lista de llamadas a un breakdown. */
export function summarize(calls: AttentionCall[]): StatsBreakdown {
  return calls.reduce((acc, c) => accumulate(acc, c), emptyBreakdown());
}

/** Estadisticas globales del periodo dado (todas las personas). */
export async function globalStats(db: Firestore, periodKey: string): Promise<StatsBreakdown & { byPerson: Record<string, StatsBreakdown> }> {
  const snap = await db.collection(CALLS_COLLECTION).where('periodKey', '==', periodKey).get();
  const calls = snap.docs.map((d) => d.data() as AttentionCall);
  const overall = summarize(calls);
  const byPerson: Record<string, StatsBreakdown> = {};
  for (const c of calls) {
    const key = c.personName || c.personKey;
    if (!byPerson[key]) byPerson[key] = emptyBreakdown();
    accumulate(byPerson[key], c);
  }
  return { ...overall, byPerson };
}

/** Estadisticas de UNA persona en el periodo dado. */
export async function personStats(db: Firestore, personKey: string, periodKey: string): Promise<StatsBreakdown> {
  const snap = await db
    .collection(CALLS_COLLECTION)
    .where('personKey', '==', personKey)
    .where('periodKey', '==', periodKey)
    .get();
  return summarize(snap.docs.map((d) => d.data() as AttentionCall));
}
