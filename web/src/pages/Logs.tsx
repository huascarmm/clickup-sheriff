import { useEffect, useState } from 'react';
import { api, type SystemLog } from '../api.js';

/**
 * Panel de salud del sistema (superadmin). Muestra los eventos registrados por
 * el sistema, con enfasis en fallos. Todo webhook deberia terminar en llamada;
 * si no, o si algo falla, queda aqui para auditar la salud.
 */
export function Logs() {
  const [logs, setLogs] = useState<SystemLog[]>([]);
  const [severity, setSeverity] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<any>(null);

  async function load() {
    setLoading(true);
    setErr('');
    try {
      setLogs(await api.admin.logs({ severity: severity || undefined }));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [severity]);

  async function runVerify() {
    setVerifying(true);
    setVerifyResult(null);
    setErr('');
    try {
      const r = await api.admin.liveVerify();
      setVerifyResult(r.result);
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setVerifying(false);
    }
  }

  const counts = {
    errors: logs.filter((l) => l.severity === 'error').length,
    warns: logs.filter((l) => l.severity === 'warn').length
  };

  return (
    <div className="fade-in">
      <div className="page-head">
        <p className="eyebrow">Superadmin · Salud</p>
        <h1>Salud del sistema</h1>
        <p>
          Registro de eventos del sistema. Los <strong>errores</strong> y los webhooks que no derivaron en
          llamada quedan aqui para diagnosticar. Tambien puedes lanzar una verificacion en vivo contra ClickUp y
          Slack (usa la lista y el canal de prueba).
        </p>
      </div>

      {err && <div className="banner error">{err}</div>}

      <div className="gauges">
        <div className="gauge alert">
          <div className="label">Errores</div>
          <div className="value">{counts.errors}</div>
        </div>
        <div className="gauge amber">
          <div className="label">Advertencias</div>
          <div className="value">{counts.warns}</div>
        </div>
        <div className="gauge">
          <div className="label">Eventos (ultimos)</div>
          <div className="value">{logs.length}</div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div className="filters" style={{ flex: 1 }}>
            <div className="field">
              <label>Severidad</label>
              <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
                <option value="">Todas</option>
                <option value="error">Errores</option>
                <option value="warn">Advertencias</option>
                <option value="info">Info</option>
              </select>
            </div>
          </div>
          <button className="btn btn-primary" onClick={runVerify} disabled={verifying}>
            {verifying ? 'Verificando…' : 'Verificacion en vivo'}
          </button>
        </div>

        {verifyResult && (
          <div className="panel-body" style={{ borderBottom: '1px solid var(--line)' }}>
            <div className={`banner ${verifyResult.ok ? 'info' : 'error'}`}>
              Verificacion {verifyResult.ok ? 'exitosa' : 'con fallos'} · limpieza: {verifyResult.cleanedUp ? 'ok' : 'incompleta'}
            </div>
            <ol className="verify-steps">
              {verifyResult.steps?.map((s: any, i: number) => (
                <li key={i} className={s.ok ? 'ok' : 'fail'}>
                  {s.ok ? '✓' : '✗'} {s.step}
                  {s.detail && <span className="dim"> — {s.detail}</span>}
                </li>
              ))}
            </ol>
          </div>
        )}

        {loading ? (
          <div className="loading">Cargando…</div>
        ) : logs.length === 0 ? (
          <div className="empty">
            <h3>Sin eventos</h3>
            <p>Cuando ocurra actividad relevante (o un fallo), se registrara aqui.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="calls">
              <thead>
                <tr>
                  <th className="signal"></th>
                  <th>Hora</th>
                  <th>Tipo</th>
                  <th>Mensaje</th>
                  <th>Tarea</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <td className={`signal ${l.severity === 'error' ? 'alert' : l.severity === 'warn' ? '' : 'info'}`}>
                      <span />
                    </td>
                    <td className="mono nowrap">{l.timestampLocal}</td>
                    <td className="mono">{l.kind}</td>
                    <td>{l.message}</td>
                    <td className="mono dim">{l.taskId || '—'}</td>
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
