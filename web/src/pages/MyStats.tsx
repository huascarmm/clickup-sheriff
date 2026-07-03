import { useEffect, useState } from 'react';
import { api, type StatsBreakdown } from '../api.js';
import { periodLabel } from './ui.js';
import { StatsView } from './StatsView.js';

/** Panel del admin: sus estadisticas del periodo vigente. */
export function MyStats() {
  const [stats, setStats] = useState<StatsBreakdown | null>(null);
  const [periodKey, setPeriodKey] = useState('');
  const [resetMonths, setResetMonths] = useState(3);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const r = await api.me.stats();
        setStats(r.stats);
        setPeriodKey(r.periodKey);
        setResetMonths(r.resetPeriodMonths);
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="fade-in">
      <div className="page-head">
        <p className="eyebrow">Mi panel · Estadisticas</p>
        <h1>Mis estadisticas</h1>
        <p>
          Periodo vigente: <strong>{periodLabel(periodKey, resetMonths)}</strong>. El contador que importa es el
          de llamadas formales (excluye tolerancias y anuladas); los contadores se reinician cada {resetMonths} meses.
        </p>
      </div>
      {err && <div className="banner error">{err}</div>}
      {loading ? <div className="loading">Cargando…</div> : stats && <StatsView stats={stats} />}
    </div>
  );
}
