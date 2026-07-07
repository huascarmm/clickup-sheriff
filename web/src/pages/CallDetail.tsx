import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, type Call } from '../api.js';
import { useAuth } from '../auth.js';
import { AlertChip, ToleranceMeter } from './ui.js';

export function CallDetail() {
  const { id = '' } = useParams();
  const nav = useNavigate();
  const { isSuperadmin } = useAuth();

  const [call, setCall] = useState<Call | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        setCall(await api.admin.call(id));
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  async function doDelete() {
    if (!reason.trim()) return;
    setDeleting(true);
    setErr('');
    try {
      await api.admin.annul(id, reason.trim());
      nav('/llamadas');
    } catch (e) {
      setErr((e as Error).message);
      setDeleting(false);
    }
  }

  if (loading) return <div className="loading">Cargando…</div>;
  if (err && !call) return <div className="banner error">{err}</div>;
  if (!call) return <div className="empty">No encontrada.</div>;

  return (
    <div className="fade-in">
      <div className="page-head">
        <p className="eyebrow">
          <a onClick={() => nav('/llamadas')} style={{ cursor: 'pointer' }}>
            ← Volver a llamadas
          </a>
        </p>
        <h1>{call.taskName || call.taskId}</h1>
        <p>
          <AlertChip type={call.alertType} />{' '}
          {call.deleted && <span className="tag-super">ELIMINADA</span>}
        </p>
      </div>

      {err && <div className="banner error">{err}</div>}

      <div className="panel">
        <div className="panel-head">
          <h2>Detalle de la alerta</h2>
        </div>
        <div className="panel-body">
          <dl className="defs">
            <dt>Persona</dt>
            <dd>{call.personName || call.personKey}</dd>

            <dt>Motivo</dt>
            <dd>{call.reason}</dd>

            <dt>Origen</dt>
            <dd>
              {call.origin === 'manual' ? (
                <>Manual{call.createdByEmail ? <span className="dim"> — creada por {call.createdByEmail}</span> : null}</>
              ) : (
                'Automatica (webhook)'
              )}
            </dd>

            {call.comment && (
              <>
                <dt>Comentario</dt>
                <dd>{call.comment}</dd>
              </>
            )}

            {call.origin !== 'manual' && (
              <>
                <dt>Tarea</dt>
                <dd>
                  <a href={call.taskUrl} target="_blank" rel="noreferrer">
                    {call.taskUrl}
                  </a>
                </dd>
              </>
            )}

            <dt>Estado en ClickUp</dt>
            <dd className="mono">{call.currentStatus || '—'}</dd>

            <dt>Momento de la alerta</dt>
            <dd className="mono">{call.timestampLocal}</dd>

            <dt>Horas transcurridas</dt>
            <dd className="mono">{call.hoursElapsed} h</dd>

            {call.dueDateLocal && (
              <>
                <dt>Vencimiento (plazo)</dt>
                <dd className="mono">{call.dueDateLocal}</dd>
              </>
            )}
            {call.statusChangeLocal && (
              <>
                <dt>Cambio de estado</dt>
                <dd className="mono">{call.statusChangeLocal}</dd>
              </>
            )}

            <dt>Tolerancia</dt>
            <dd>
              <ToleranceMeter tolerance={call.tolerance} />
            </dd>

            <dt>Llamada formal del periodo</dt>
            <dd className="mono">{call.periodAttentionCountAfter ?? '— (fue aviso de tolerancia)'}</dd>

            <dt>Envio a Slack</dt>
            <dd>
              {call.slackOk ? (
                <span className="slack-ok">enviado</span>
              ) : (
                <span className="slack-fail">fallo — {call.slackError || 'sin detalle'}</span>
              )}
            </dd>

            <dt>Mensaje enviado</dt>
            <dd style={{ whiteSpace: 'pre-wrap' }}>{call.message}</dd>

            {call.deleted && (
              <>
                <dt>Eliminada por</dt>
                <dd>
                  {call.deletedBy} — motivo: {call.deletedReason}
                </dd>
              </>
            )}
          </dl>
        </div>
      </div>

      {isSuperadmin && !call.deleted && (
        <div className="panel">
          <div className="panel-head">
            <h2>Zona de superadmin</h2>
            <span className="tag-super">superadmin</span>
          </div>
          <div className="panel-body">
            <p className="section-note">
              Eliminar una llamada la retira de los contadores de tolerancia y del historial visible. Queda
              registrada en auditoria con tu correo y el motivo. Usa esto solo cuando la alerta fue un error.
            </p>
            <button className="btn btn-danger" onClick={() => setConfirming(true)}>
              Eliminar esta llamada
            </button>
          </div>
        </div>
      )}

      {confirming && (
        <div className="modal-backdrop" onClick={() => !deleting && setConfirming(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Eliminar llamada</h3>
            <p className="section-note">Explica por que se elimina. Este motivo queda en auditoria.</p>
            <textarea
              placeholder="Ej: la tarea estaba en QA por error de configuracion del tablero."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setConfirming(false)} disabled={deleting}>
                Cancelar
              </button>
              <button className="btn btn-danger" onClick={doDelete} disabled={deleting || !reason.trim()}>
                {deleting ? 'Eliminando…' : 'Confirmar eliminacion'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
