import type { StatsBreakdown } from '../api.js';
import { StatCard } from './ui.js';

/** Vista compartida de un breakdown de estadisticas. */
export function StatsView({ stats }: { stats: StatsBreakdown }) {
  return (
    <>
      <div className="gauges">
        <StatCard label="Llamadas formales (cuentan)" value={stats.formalCalls} tone="alert" />
        <StatCard label="Avisos de tolerancia" value={stats.tolerances} tone="amber" />
        <StatCard label="Anuladas" value={stats.annulled} />
        <StatCard label="Total de alertas" value={stats.totalAlerts} />
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Formales por razon</h2>
        </div>
        <div className="panel-body">
          <div className="reason-grid">
            <div className="reason-row">
              <span className="chip qa">QA 36h</span>
              <span className="mono reason-num">{stats.formalByReason.QA_36H}</span>
            </div>
            <div className="reason-row">
              <span className="chip fixing">FIXING QA 36h</span>
              <span className="mono reason-num">{stats.formalByReason.FIXING_QA_36H}</span>
            </div>
            <div className="reason-row">
              <span className="chip atraso">Atraso plazo</span>
              <span className="mono reason-num">{stats.formalByReason.ATRASO_PLAZO}</span>
            </div>
            <div className="reason-row">
              <span className="chip manual">Manual</span>
              <span className="mono reason-num">{stats.formalByReason.MANUAL}</span>
            </div>
          </div>
          {stats.slackFailures > 0 && (
            <p className="section-note" style={{ marginTop: 14 }}>
              ⚠ {stats.slackFailures} llamada(s) con fallo de envio a Slack en este periodo.
            </p>
          )}
        </div>
      </div>
    </>
  );
}
