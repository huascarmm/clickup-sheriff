import { useEffect, useState } from 'react';
import { api } from '../api.js';

interface Entry {
  id: string;
  action: string;
  callId: string;
  reason: string;
  by: string;
  at?: { _seconds?: number } | string;
  snapshot?: { taskName?: string; personName?: string };
}

export function Audit() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        setEntries(await api.audit());
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
        <p className="eyebrow">Superadmin · Registro</p>
        <h1>Auditoria</h1>
        <p>Historial de eliminaciones de llamadas: quien, cuando y por que.</p>
      </div>

      {err && <div className="banner error">{err}</div>}

      <div className="panel">
        <div className="panel-head">
          <h2>Eventos ({entries.length})</h2>
        </div>
        {loading ? (
          <div className="loading">Cargando…</div>
        ) : entries.length === 0 ? (
          <div className="empty">
            <h3>Sin eventos</h3>
            <p>Cuando alguien elimine una llamada, quedara registrado aqui.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="calls">
              <thead>
                <tr>
                  <th>Accion</th>
                  <th>Tarea / persona</th>
                  <th>Motivo</th>
                  <th>Por</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id}>
                    <td className="mono">{e.action}</td>
                    <td>
                      {e.snapshot?.taskName || e.callId}
                      {e.snapshot?.personName && <span className="dim"> · {e.snapshot.personName}</span>}
                    </td>
                    <td>{e.reason}</td>
                    <td className="dim">{e.by}</td>
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
