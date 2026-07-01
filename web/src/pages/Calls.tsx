import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type Call, type Person } from '../api.js';
import { AlertChip, ToleranceMeter } from './ui.js';

export function Calls() {
  const nav = useNavigate();
  const [calls, setCalls] = useState<Call[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const [person, setPerson] = useState('');
  const [alertType, setAlertType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [includeDeleted, setIncludeDeleted] = useState(false);

  async function load() {
    setLoading(true);
    setErr('');
    try {
      const params: Record<string, string> = {};
      if (person) params.person = person;
      if (alertType) params.alertType = alertType;
      if (from) params.from = from;
      if (to) params.to = to;
      if (includeDeleted) params.includeDeleted = 'true';
      const [c, p] = await Promise.all([api.listCalls(params), people.length ? Promise.resolve(people) : api.listPeople()]);
      setCalls(c);
      if (!people.length) setPeople(p as Person[]);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [person, alertType, from, to, includeDeleted]);

  const summary = useMemo(() => {
    const active = calls.filter((c) => !c.deleted);
    return {
      total: active.length,
      formal: active.filter((c) => !c.isTolerance).length,
      tolerancia: active.filter((c) => c.isTolerance).length,
      slackFail: active.filter((c) => !c.slackOk).length
    };
  }, [calls]);

  return (
    <div className="fade-in">
      <div className="page-head">
        <p className="eyebrow">Registro · QA · Plazos</p>
        <h1>Llamadas de atencion</h1>
        <p>
          Cada fila es una alerta enviada a Slack. El riel de color y el medidor indican si fue un aviso de
          tolerancia (ambar) o una llamada formal (rojo). Toca una fila para ver el detalle.
        </p>
      </div>

      <div className="gauges">
        <div className="gauge">
          <div className="label">Registradas</div>
          <div className="value">{summary.total}</div>
        </div>
        <div className="gauge amber">
          <div className="label">Avisos de tolerancia</div>
          <div className="value">{summary.tolerancia}</div>
        </div>
        <div className="gauge alert">
          <div className="label">Llamadas formales</div>
          <div className="value">{summary.formal}</div>
        </div>
        <div className="gauge">
          <div className="label">Fallos de envio a Slack</div>
          <div className="value">{summary.slackFail}</div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <div className="filters" style={{ flex: 1 }}>
            <div className="field">
              <label>Persona</label>
              <select value={person} onChange={(e) => setPerson(e.target.value)}>
                <option value="">Todas</option>
                {people.map((p) => (
                  <option key={p.person_key} value={p.person_key}>
                    {p.nombre_visible || p.person_key}
                  </option>
                ))}
              </select>
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
                <input
                  type="checkbox"
                  style={{ minHeight: 'auto' }}
                  checked={includeDeleted}
                  onChange={(e) => setIncludeDeleted(e.target.checked)}
                />
                Ver eliminadas
              </label>
            </div>
          </div>
        </div>

        {err && (
          <div className="panel-body">
            <div className="banner error">{err}</div>
          </div>
        )}

        {loading ? (
          <div className="loading">Cargando llamadas…</div>
        ) : calls.length === 0 ? (
          <div className="empty">
            <h3>Sin llamadas para este filtro</h3>
            <p>Cuando el sistema detecte un atraso, aparecera aqui. Ajusta los filtros para ver otros periodos.</p>
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
                  <th>Tolerancia</th>
                  <th>#Trim.</th>
                  <th>Slack</th>
                </tr>
              </thead>
              <tbody>
                {calls.map((c) => (
                  <tr
                    key={c.id}
                    className="rowlink"
                    onClick={() => nav(`/calls/${encodeURIComponent(c.id)}`)}
                    style={c.deleted ? { opacity: 0.5 } : undefined}
                  >
                    <td className={`signal ${c.isTolerance ? '' : 'alert'}`}>
                      <span />
                    </td>
                    <td className="mono nowrap">{c.timestampLocal}</td>
                    <td className="nowrap">{c.personName || c.personKey}</td>
                    <td>
                      <a href={c.taskUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                        {c.taskName || c.taskId}
                      </a>
                      {c.deleted && <span className="dim"> · eliminada</span>}
                    </td>
                    <td>
                      <AlertChip type={c.alertType} />
                    </td>
                    <td>
                      <ToleranceMeter tolerance={c.tolerance} />
                    </td>
                    <td className="mono">{c.quarterlyAttentionCountAfter ?? '—'}</td>
                    <td>
                      {c.slackOk ? <span className="slack-ok">ok</span> : <span className="slack-fail">fallo</span>}
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
