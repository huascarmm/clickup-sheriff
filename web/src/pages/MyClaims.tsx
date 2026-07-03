import { useEffect, useState } from 'react';
import { api, type Claim } from '../api.js';
import { AlertChip, ClaimBadge } from './ui.js';

/** Panel del admin: sus reclamos y si fueron aceptados o rechazados. */
export function MyClaims() {
  const [claims, setClaims] = useState<Claim[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        setClaims(await api.me.claims());
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
        <p className="eyebrow">Mi panel · Reclamos</p>
        <h1>Mis reclamos</h1>
        <p>Aqui ves el estado de cada solicitud de anulacion que enviaste y la respuesta del superadmin.</p>
      </div>

      {err && <div className="banner error">{err}</div>}

      <div className="panel">
        <div className="panel-head">
          <h2>Solicitudes ({claims.length})</h2>
        </div>
        {loading ? (
          <div className="loading">Cargando…</div>
        ) : claims.length === 0 ? (
          <div className="empty">
            <h3>Aun no has enviado reclamos</h3>
            <p>Desde "Mis llamadas" puedes solicitar la anulacion de una llamada con una justificacion.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="calls">
              <thead>
                <tr>
                  <th>Tarea</th>
                  <th>Tipo</th>
                  <th>Justificacion</th>
                  <th>Estado</th>
                  <th>Respuesta</th>
                </tr>
              </thead>
              <tbody>
                {claims.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <a href={c.taskUrl} target="_blank" rel="noreferrer">
                        {c.taskName || c.taskId}
                      </a>
                      <div className="dim mono" style={{ fontSize: 11 }}>{c.callTimestampLocal}</div>
                    </td>
                    <td>
                      <AlertChip type={c.alertType} />
                    </td>
                    <td style={{ maxWidth: 320 }}>{c.justification}</td>
                    <td>
                      <ClaimBadge status={c.status} />
                    </td>
                    <td className="dim" style={{ maxWidth: 260 }}>
                      {c.resolutionMessage || (c.status === 'pending' ? 'En revision…' : '—')}
                    </td>
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
