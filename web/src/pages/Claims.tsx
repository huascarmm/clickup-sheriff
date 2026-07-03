import { useEffect, useState } from 'react';
import { api, slackDmLink, type Claim, type ClaimStatus } from '../api.js';
import { AlertChip, ClaimBadge } from './ui.js';

/**
 * Panel del superadmin: analizar reclamos. Muestra de forma preponderante el
 * titulo y link de la tarea, la justificacion extensa, quien reclama (con link
 * a Slack), y botones para aceptar (anula automaticamente) o rechazar con un
 * mensaje de respuesta.
 */
export function Claims() {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [filter, setFilter] = useState<ClaimStatus | ''>('pending');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const [acting, setActing] = useState<{ claim: Claim; decision: 'accepted' | 'rejected' } | null>(null);
  const [response, setResponse] = useState('');
  const [sending, setSending] = useState(false);

  async function load() {
    setLoading(true);
    setErr('');
    try {
      setClaims(await api.admin.claims(filter || undefined));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  async function confirm() {
    if (!acting) return;
    setSending(true);
    setErr('');
    try {
      await api.admin.resolveClaim(acting.claim.id, acting.decision, response.trim());
      setMsg(acting.decision === 'accepted' ? 'Reclamo aceptado: la llamada fue anulada.' : 'Reclamo rechazado.');
      setActing(null);
      setResponse('');
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  const pending = claims.filter((c) => c.status === 'pending').length;

  return (
    <div className="fade-in">
      <div className="page-head">
        <p className="eyebrow">Superadmin · Reclamos</p>
        <h1>Reclamos de anulacion</h1>
        <p>
          Revisa las solicitudes del equipo. Aceptar un reclamo anula la llamada automaticamente (deja de contar).
          {pending > 0 && <> Hay <strong>{pending}</strong> pendiente(s).</>}
        </p>
      </div>

      {err && <div className="banner error">{err}</div>}
      {msg && <div className="banner info">{msg}</div>}

      <div className="tabs">
        {(['pending', 'accepted', 'rejected', ''] as const).map((s) => (
          <button key={s || 'all'} className={`tab ${filter === s ? 'active' : ''}`} onClick={() => setFilter(s)}>
            {s === 'pending' ? 'Pendientes' : s === 'accepted' ? 'Aceptados' : s === 'rejected' ? 'Rechazados' : 'Todos'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="loading">Cargando…</div>
      ) : claims.length === 0 ? (
        <div className="empty">
          <h3>Sin reclamos {filter === 'pending' ? 'pendientes' : ''}</h3>
          <p>Cuando alguien solicite una anulacion, aparecera aqui para tu revision.</p>
        </div>
      ) : (
        claims.map((c) => (
          <div className="panel claim-card" key={c.id}>
            <div className="panel-body">
              <div className="claim-top">
                <div>
                  <a className="claim-task" href={c.taskUrl} target="_blank" rel="noreferrer">
                    {c.taskName || c.taskId} ↗
                  </a>
                  <div className="claim-meta">
                    <AlertChip type={c.alertType} /> <span className="dim mono">{c.callTimestampLocal}</span>
                  </div>
                </div>
                <ClaimBadge status={c.status} />
              </div>

              <div className="claim-justif">
                <div className="claim-label">Justificacion</div>
                <p>{c.justification}</p>
              </div>

              <div className="claim-foot">
                <div className="claim-requester">
                  Solicita: <strong>{c.requestedByName || c.requestedByEmail}</strong>
                  {c.requestedBySlackId && (
                    <a className="slack-link" href={slackDmLink(c.requestedBySlackId)} target="_blank" rel="noreferrer">
                      escribir por Slack ↗
                    </a>
                  )}
                </div>
                {c.status === 'pending' ? (
                  <div className="claim-actions">
                    <button className="btn btn-ghost" onClick={() => { setActing({ claim: c, decision: 'rejected' }); setResponse(''); }}>
                      Rechazar
                    </button>
                    <button className="btn btn-primary" onClick={() => { setActing({ claim: c, decision: 'accepted' }); setResponse(''); }}>
                      Aceptar y anular
                    </button>
                  </div>
                ) : (
                  <div className="dim" style={{ maxWidth: 380, textAlign: 'right' }}>
                    {c.resolutionMessage && <>Respuesta: {c.resolutionMessage}</>}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))
      )}

      {acting && (
        <div className="modal-backdrop" onClick={() => !sending && setActing(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{acting.decision === 'accepted' ? 'Aceptar reclamo y anular' : 'Rechazar reclamo'}</h3>
            <p className="section-note">
              {acting.decision === 'accepted'
                ? 'La llamada quedara anulada y dejara de contar. Escribe una respuesta para el solicitante.'
                : 'La llamada se mantiene. Escribe por que se rechaza.'}
            </p>
            <textarea
              placeholder={acting.decision === 'accepted' ? 'Ej: confirmado en el daily, se anula.' : 'Ej: no corresponde, la tarea si estuvo atrasada sin justificacion.'}
              value={response}
              onChange={(e) => setResponse(e.target.value)}
            />
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setActing(null)} disabled={sending}>
                Cancelar
              </button>
              <button
                className={`btn ${acting.decision === 'accepted' ? 'btn-primary' : 'btn-danger'}`}
                onClick={confirm}
                disabled={sending || !response.trim()}
              >
                {sending ? 'Guardando…' : acting.decision === 'accepted' ? 'Confirmar anulacion' : 'Confirmar rechazo'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
