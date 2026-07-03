import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type Call } from '../api.js';
import { AlertChip, ToleranceMeter } from './ui.js';

/**
 * Panel del superadmin: TODAS las llamadas con filtros para investigar (punto 10):
 * por fecha, por nombre de tarea, por estado, por persona, incluyendo anuladas.
 * Historia de uso: verificar si una anulada sigue contando, o si un reclamo no
 * se tramito.
 */
export function AllCalls() {
  const nav = useNavigate();
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const [person, setPerson] = useState('');
  const [alertType, setAlertType] = useState('');
  const [status, setStatus] = useState('');
  const [taskName, setTaskName] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [includeDeleted, setIncludeDeleted] = useState(false);

  async function load() {
    setLoading(true);
    setErr('');
    try {
      setCalls(
        await api.admin.calls({
          person,
          alertType,
          status,
          taskName,
          from,
          to,
          includeDeleted: includeDeleted ? 'true' : undefined
        })
      );
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person, alertType, status, taskName, from, to, includeDeleted]);

  return (
    <div className="fade-in">
      <div className="page-head">
        <p className="eyebrow">Superadmin · Registro</p>
        <h1>Todas las llamadas</h1>
        <p>Filtra por persona, fecha, estado o nombre de tarea para investigar casos concretos.</p>
      </div>

      {err && <div className="banner error">{err}</div>}

      <div className="panel">
        <div className="panel-head">
          <div className="filters" style={{ flex: 1 }}>
            <div className="field">
              <label>Persona (key)</label>
              <input placeholder="p.ej. Huascar" value={person} onChange={(e) => setPerson(e.target.value)} />
            </div>
            <div className="field">
              <label>Tipo</label>
              <select value={alertType} onChange={(e) => setAlertType(e.target.value)}>
                <option value="">Todos</option>
                <option value="QA_36H">QA 36h</option>
                <option value="FIXING_QA_36H">FIXING QA 36h</option>
                <option value="ATRASO_PLAZO">Atraso plazo</option>
              </select>
            </div>
            <div className="field">
              <label>Estado</label>
              <input placeholder="doing…" value={status} onChange={(e) => setStatus(e.target.value)} />
            </div>
            <div className="field">
              <label>Tarea</label>
              <input placeholder="nombre o id" value={taskName} onChange={(e) => setTaskName(e.target.value)} />
            </div>
            <div className="field">
              <label>Desde</label>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="field">
              <label>Hasta</label>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="field">
              <label>&nbsp;</label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13 }}>
                <input type="checkbox" style={{ minHeight: 'auto' }} checked={includeDeleted} onChange={(e) => setIncludeDeleted(e.target.checked)} />
                Ver anuladas
              </label>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="loading">Cargando…</div>
        ) : calls.length === 0 ? (
          <div className="empty">
            <h3>Sin resultados</h3>
            <p>Ajusta los filtros para ver otras llamadas.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="calls">
              <thead>
                <tr>
                  <th className="signal"></th>
                  <th>Fecha y hora</th>
                  <th>Persona</th>
                  <th>Tarea</th>
                  <th>Tipo</th>
                  <th>Estado</th>
                  <th>Tolerancia</th>
                  <th>#Periodo</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((c) => (
                  <tr key={c.id} className="rowlink" onClick={() => nav(`/llamadas/${encodeURIComponent(c.id)}`)} style={c.deleted ? { opacity: 0.5 } : undefined}>
                    <td className={`signal ${c.isTolerance ? '' : 'alert'}`}>
                      <span />
                    </td>
                    <td className="mono nowrap">{c.timestampLocal}</td>
                    <td className="nowrap">{c.personName || c.personKey}</td>
                    <td>
                      <a href={c.taskUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                        {c.taskName || c.taskId}
                      </a>
                      {c.deleted && <span className="dim"> · anulada</span>}
                    </td>
                    <td>
                      <AlertChip type={c.alertType} />
                    </td>
                    <td className="mono nowrap">{c.currentStatus}</td>
                    <td>
                      <ToleranceMeter tolerance={c.tolerance} />
                    </td>
                    <td className="mono">{c.periodAttentionCountAfter ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
