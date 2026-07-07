import { useEffect, useMemo, useState } from 'react';
import { api, type Call } from '../api.js';
import { AlertChip, ToleranceMeter } from './ui.js';

/**
 * Panel del admin: SUS llamadas de atencion con filtros (fecha, tipo, estado,
 * tarea) y la opcion de SOLICITAR la anulacion con una justificacion.
 * Los datos mostrados permiten reclamar de forma justificada (motivo, hora,
 * estado, medidor de tolerancia, si ya la reclamo).
 */
export function MyCalls() {
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const [alertType, setAlertType] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [taskName, setTaskName] = useState('');
  const [includeDeleted, setIncludeDeleted] = useState(false);

  const [claimFor, setClaimFor] = useState<Call | null>(null);
  const [justification, setJustification] = useState('');
  const [sending, setSending] = useState(false);

  async function load() {
    setLoading(true);
    setErr('');
    try {
      setCalls(
        await api.me.calls({
          alertType,
          status,
          from,
          to,
          taskName,
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
  }, [alertType, status, from, to, taskName, includeDeleted]);

  const summary = useMemo(() => {
    const active = calls.filter((c) => !c.deleted);
    return {
      formal: active.filter((c) => !c.isTolerance).length,
      tol: active.filter((c) => c.isTolerance).length
    };
  }, [calls]);

  async function submitClaim() {
    if (!claimFor) return;
    setSending(true);
    setErr('');
    try {
      await api.me.createClaim(claimFor.id, justification.trim());
      setMsg('Reclamo enviado. Podras ver su estado en "Mis reclamos".');
      setClaimFor(null);
      setJustification('');
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fade-in">
      <div className="page-head">
        <p className="eyebrow">Mi panel · QA y plazos</p>
        <h1>Mis llamadas de atencion</h1>
        <p>
          Estas son las llamadas que te corresponden. Si crees que alguna es una incongruencia del sistema o
          se acordo anularla (por ejemplo, en el daily), puedes solicitar su anulacion con una justificacion.
        </p>
      </div>

      {err && <div className="banner error">{err}</div>}
      {msg && <div className="banner info">{msg}</div>}

      <div className="gauges">
        <div className="gauge alert">
          <div className="label">Llamadas formales (cuentan)</div>
          <div className="value">{summary.formal}</div>
        </div>
        <div className="gauge amber">
          <div className="label">Avisos de tolerancia</div>
          <div className="value">{summary.tol}</div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div className="filters" style={{ flex: 1 }}>
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
              <input placeholder="p.ej. doing" value={status} onChange={(e) => setStatus(e.target.value)} />
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
            <h3>Sin llamadas para este filtro</h3>
            <p>Cuando el sistema registre una llamada tuya, aparecera aqui.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="calls">
              <thead>
                <tr>
                  <th className="signal"></th>
                  <th>Fecha y hora</th>
                  <th>Tarea</th>
                  <th>Tipo</th>
                  <th>Motivo</th>
                  <th>Estado</th>
                  <th>Tolerancia</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {calls.map((c) => (
                  <tr key={c.id} style={c.deleted ? { opacity: 0.55 } : undefined}>
                    <td className={`signal ${c.isTolerance ? '' : 'alert'}`}>
                      <span />
                    </td>
                    <td className="mono nowrap">{c.timestampLocal}</td>
                    <td>
                      {c.origin === 'manual' ? (
                        <span title={c.comment || ''}>
                          <span className="dim">manual:</span> {c.reason}
                        </span>
                      ) : (
                        <a href={c.taskUrl} target="_blank" rel="noreferrer">
                          {c.taskName || c.taskId}
                        </a>
                      )}
                      {c.deleted && <span className="dim"> · anulada</span>}
                    </td>
                    <td>
                      <AlertChip type={c.alertType} />
                    </td>
                    <td className="dim">{c.reason}</td>
                    <td className="mono nowrap">{c.currentStatus}</td>
                    <td>
                      <ToleranceMeter tolerance={c.tolerance} />
                    </td>
                    <td className="nowrap">
                      {!c.deleted && (
                        <button className="btn btn-ghost" onClick={() => setClaimFor(c)}>
                          Reclamar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {claimFor && (
        <div className="modal-backdrop" onClick={() => !sending && setClaimFor(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Solicitar anulacion</h3>
            <p className="section-note">
              Tarea: <strong>{claimFor.taskName || claimFor.taskId}</strong> · {claimFor.timestampLocal}
            </p>
            <p className="section-note">
              Explica por que deberia anularse (incongruencia del sistema, o acuerdo en el daily meeting). El
              superadmin lo revisara.
            </p>
            <textarea
              placeholder="Ej: en el daily del 1/07 se acordo anular esta llamada porque la tarea estuvo bloqueada por dependencia externa."
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
            />
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setClaimFor(null)} disabled={sending}>
                Cancelar
              </button>
              <button className="btn btn-primary" onClick={submitClaim} disabled={sending || justification.trim().length < 5}>
                {sending ? 'Enviando…' : 'Enviar reclamo'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
