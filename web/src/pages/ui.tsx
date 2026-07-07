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
  ATRASO_PLAZO: { label: 'Atraso plazo', cls: 'atraso' },
  MANUAL: { label: 'Manual', cls: 'manual' }
};

export function AlertChip({ type }: { type: Call['alertType'] }) {
  const t = TYPE_LABEL[type] || { label: type, cls: 'atraso' };
  return <span className={`chip ${t.cls}`}>{t.label}</span>;
}

const CLAIM_LABEL: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Pendiente', cls: 'pending' },
  accepted: { label: 'Aceptado (anulada)', cls: 'accepted' },
  rejected: { label: 'Rechazado', cls: 'rejected' }
};

export function ClaimBadge({ status }: { status: string }) {
  const s = CLAIM_LABEL[status] || { label: status, cls: 'pending' };
  return <span className={`claimbadge ${s.cls}`}>{s.label}</span>;
}

export function StatCard({ label, value, tone }: { label: string; value: number | string; tone?: 'amber' | 'alert' | 'ok' }) {
  return (
    <div className={`gauge ${tone || ''}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}

/** Traduce la clave de periodo (2026_P3) a un rango legible segun meses. */
export function periodLabel(periodKey: string, resetMonths: number): string {
  const m = String(periodKey || '').match(/^(\d{4})_P(\d+)$/);
  if (!m) return periodKey;
  const year = m[1];
  const idx = Number(m[2]) - 1;
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const start = idx * resetMonths;
  const end = Math.min(11, start + resetMonths - 1);
  if (start > 11) return `${periodKey} (${year})`;
  return `${months[start]}–${months[end]} ${year}`;
}
