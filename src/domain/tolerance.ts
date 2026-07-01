/**
 * Calculo de tolerancia semanal. Funcion PURA: dado el conteo previo de faltas
 * de la semana y el limite, decide si esta llamada es "aviso de tolerancia" o
 * "llamada formal". Identica a la logica original pero aislada y testeable.
 */

export interface ToleranceResult {
  weeklyCountAfter: number;
  isTolerance: boolean;
  tolerance: string; // "SI 1/2" | "NO 3/2"
}

export function computeTolerance(previousWeeklyFaults: number, toleranceLimit: number): ToleranceResult {
  const weeklyCountAfter = previousWeeklyFaults + 1;
  const isTolerance = weeklyCountAfter <= toleranceLimit;
  const tolerance = `${isTolerance ? 'SI' : 'NO'} ${weeklyCountAfter}/${toleranceLimit}`;
  return { weeklyCountAfter, isTolerance, tolerance };
}
