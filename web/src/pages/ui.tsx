import type { Call } from '../api.js';

/**
 * Medidor de tolerancia (pieza distintiva del panel). Muestra n/limite como
 * segmentos: los que caben en el limite van ambar; los que se pasan, rojo.
 * Encodea la misma semantica que el mensaje de Slack (aviso vs llamada formal).
 */
export function ToleranceMeter({ tolerance }: { tolerance: string }) {
  const parsed = parseTolerance(tolerance);
  if (!parsed) return <span className="dim mono">—</span>;

  const { count, limit, isFormal } = parsed;
  const segments = Math.max(limit, count);
  const cells = [];
  for (let i = 0; i < segments; i++) {
    const within = i < count;
    const over = within && i >= limit;
    cells.push(<span key={i} className={`seg ${within ? (over ? 'over' : 'filled') : ''}`} />);
  }

  return (
    <span className={`tolmeter ${isFormal ? 'is-formal' : ''}`} title={isFormal ? 'Llamada formal' : 'Aviso de tolerancia'}>
      <span className="segs">{cells}</span>
      <span className="frac">
        {count}/{limit}
      </span>
    </span>
  );
}

function parseTolerance(t: string): { count: number; limit: number; isFormal: boolean } | null {
  // formato "SI 2/2" | "NO 3/2"
  const m = String(t || '').match(/^(SI|NO)\s+(\d+)\/(\d+)$/i);
  if (!m) return null;
  return { isFormal: m[1].toUpperCase() === 'NO', count: Number(m[2]), limit: Number(m[3]) };
}

const TYPE_LABEL: Record<Call['alertType'], { label: string; cls: string }> = {
  QA_36H: { label: 'QA 36h', cls: 'qa' },
  FIXING_QA_36H: { label: 'FIXING QA 36h', cls: 'fixing' },
  ATRASO_PLAZO: { label: 'Atraso plazo', cls: 'atraso' }
};

export function AlertChip({ type }: { type: Call['alertType'] }) {
  const t = TYPE_LABEL[type] || { label: type, cls: 'atraso' };
  return <span className={`chip ${t.cls}`}>{t.label}</span>;
}
