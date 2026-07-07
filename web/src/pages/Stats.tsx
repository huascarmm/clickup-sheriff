import { useEffect, useState } from 'react';
import { api, type StatsBreakdown } from '../api.js';
import { StatsView } from './StatsView.js';
import { periodLabel } from './ui.js';

/** Panel del superadmin: estadisticas globales + por persona. */
export function Stats() {
  const [data, setData] = useState<(StatsBreakdown & { byPerson: Record<string, StatsBreakdown> }) | null>(null);
  const [periodKey, setPeriodKey] = useState('');
  const [resetMonths, setResetMonths] = useState(3);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const r = await api.admin.stats();
        setData(r.stats);
        setPeriodKey(r.periodKey);
        setResetMonths(r.resetPeriodMonths);
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const people = data ? Object.entries(data.byPerson).sort((a, b) => b[1].formalCalls - a[1].formalCalls) : [];

  return (
    <div className="fade-in">
      <div className="page-head">
        <p className="eyebrow">Superadmin · Estadisticas</p>
        <h1>Estadisticas del equipo</h1>
        <p>
          Periodo vigente: <strong>{periodLabel(periodKey, resetMonths)}</strong>. Los contadores se reinician
          cada {resetMonths} meses. El numero critico por persona es el de llamadas formales.
        </p>
      </div>

      {err && <div className="banner error">{err}</div>}

      {loading ? (
        <div className="loading">Cargando…</div>
      ) : data ? (
        <>
          <StatsView stats={data} />

          <div className="panel">
            <div className="panel-head">
              <h2>Por persona</h2>
            </div>
            <div className="table-wrap">
              <table className="calls">
                <thead>
                  <tr>
                    <th>Persona</th>
                    <th>Formales</th>
                    <th>QA</th>
                    <th>FIXING</th>
                    <th>Atraso</th>
                    <th>Manual</th>
                    <th>Tolerancias</th>
                    <th>Anuladas</th>
                  </tr>
                </thead>
                <tbody>
                  {people.map(([name, s]) => (
                    <tr key={name}>
                      <td>{name}</td>
                      <td className="mono" style={{ fontWeight: 600, color: s.formalCalls >= 9 ? 'var(--alert)' : undefined }}>
                        {s.formalCalls}
                      </td>
                      <td className="mono">{s.formalByReason.QA_36H}</td>
                      <td className="mono">{s.formalByReason.FIXING_QA_36H}</td>
                      <td className="mono">{s.formalByReason.ATRASO_PLAZO}</td>
                      <td className="mono">{s.formalByReason.MANUAL}</td>
                      <td className="mono dim">{s.tolerances}</td>
                      <td className="mono dim">{s.annulled}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
