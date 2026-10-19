import { useEffect, useMemo, useState } from 'react';
import { api, type Call, type Person, type ReviewGoal, type ReviewGoalsSnapshot, type ReviewProject } from '../api.js';
import { useAuth } from '../auth.js';
import { StatCard } from './ui.js';

/**
 * Panel de revisor (todos los roles). Muestra TODOS
 * los proyectos con sus metas y fechas de finalizacion, tal como llegaron por
 * el webhook /webhooks/goals, y resalta las vencidas. Lo ven todos los roles.
 *
 * El superadmin ademas puede crear, desde una meta vencida, una llamada de
 * atencion manual con un texto por defecto (usa el mismo flujo que la pagina
 * "Llamada manual": tolerancia, periodo, Slack y auditoria).
 */
export function ReviewerPanel() {
  const { role, isSuperadmin } = useAuth();
  const [data, setData] = useState<ReviewGoalsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const [people, setPeople] = useState<Person[] | null>(null);
  const [callFor, setCallFor] = useState<{ project: ReviewProject; goal: ReviewGoal } | null>(null);

  async function load() {
    setLoading(true);
    setErr('');
    try {
      setData(await api.review.goals());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const totals = useMemo(() => {
    const projects = data?.projects || [];
    return {
      projects: projects.length,
      goals: projects.reduce((n, p) => n + p.goals.length, 0),
      overdue: projects.reduce((n, p) => n + p.overdueCount, 0),
      noDate: projects.reduce((n, p) => n + countNoDate(p), 0)
    };
  }, [data]);

  async function openCall(project: ReviewProject, goal: ReviewGoal) {
    setMsg('');
    setErr('');
    if (!people) {
      try {
        setPeople((await api.admin.people()).filter((p) => p.activo));
      } catch (e) {
        setErr((e as Error).message);
        return;
      }
    }
    setCallFor({ project, goal });
  }

  function onCallCreated(call: Call) {
    setCallFor(null);
    setMsg(
      `Llamada registrada para ${call.personName}. ` +
        (call.isTolerance ? 'Se conto como aviso de tolerancia. ' : `Es llamada formal #${call.periodAttentionCountAfter} del periodo. `) +
        (call.slackOk ? 'Enviada a Slack.' : `No se pudo enviar a Slack: ${call.slackError || 'error'}.`)
    );
  }

  if (loading && !data) return <div className="loading">Cargando…</div>;

  // Sin proyectos: solo el aviso, sin contadores ni detalle.
  if (data && data.projects.length === 0) {
    return (
      <div className="fade-in">
        {err && <div className="banner error">{err}</div>}
        <div className="panel">
          <div className="empty">
            <h3>No hay datos para mostrar</h3>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in">
      <div className="page-head review-head">
        <div>
          <p className="eyebrow">Panel de revisor · {role}</p>
          <h1>Metas por proyecto</h1>
          <p>
            {data?.receivedAtMs && `Ultima actualizacion: ${formatTimestamp(data.receivedAtMs, data.timezone)}. `}
            {data && `Hoy es ${data.todayKey} (${data.timezone}); una meta vence al terminar su fecha.`}
          </p>
        </div>
        <button className="btn btn-ghost" onClick={load} disabled={loading}>
          {loading ? 'Cargando…' : 'Actualizar'}
        </button>
      </div>

      {err && <div className="banner error">{err}</div>}
      {msg && <div className="banner info">{msg}</div>}

      {data && (
        <div className="gauges">
          <StatCard label="Proyectos" value={totals.projects} />
          <StatCard label="Metas" value={totals.goals} />
          <StatCard label="Metas vencidas" value={totals.overdue} tone={totals.overdue ? 'alert' : 'ok'} />
          <StatCard label="Metas sin fecha" value={totals.noDate} />
        </div>
      )}

      {data?.projects.map((project) => {
        const noDate = countNoDate(project);
        return (
          <div className="panel" key={project.name}>
            <div className="panel-head">
              <h2>{project.name}</h2>
              <span className="dim mono">{project.goals.length} metas</span>
              {project.overdueCount > 0 && <span className="due-badge overdue">{project.overdueCount} vencidas</span>}
              {noDate > 0 && <span className="due-badge nodate">{noDate} sin fecha</span>}
            </div>
            {project.goals.length === 0 ? (
              <div className="empty">
                <p>Este proyecto no tiene metas.</p>
              </div>
            ) : (
              <div className="table-wrap">
                <table className="calls">
                  <thead>
                    <tr>
                      <th className="signal"></th>
                      <th>Meta</th>
                      <th>Responsable</th>
                      <th>Fecha de finalizacion</th>
                      <th>Estado</th>
                      {isSuperadmin && <th></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {project.goals.map((goal) => (
                      <tr key={goal.id} className={rowClass(goal)}>
                        <td className={`signal ${goal.overdue ? 'alert' : goal.dueDate === null ? 'nodate' : 'none'}`}>
                          <span />
                        </td>
                        <td>{goal.name}</td>
                        <td className="dim">{goal.personName || goal.personKey || '—'}</td>
                        <td className="mono nowrap">{goal.dueDate ?? '—'}</td>
                        <td className="nowrap">
                          <DueBadge dueDate={goal.dueDate} todayKey={data.todayKey} />
                        </td>
                        {isSuperadmin && (
                          <td className="nowrap">
                            {goal.overdue && (
                              <button className="btn btn-danger" onClick={() => openCall(project, goal)}>
                                Llamada de atencion
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        );
      })}

      {callFor && people && (
        <GoalCallModal
          project={callFor.project}
          goal={callFor.goal}
          people={people}
          onClose={() => setCallFor(null)}
          onCreated={onCallCreated}
        />
      )}
    </div>
  );
}

function countNoDate(project: ReviewProject): number {
  return project.goals.filter((g) => g.dueDate === null).length;
}

/** Vencida en rojo; sin fecha en violeta, para no confundirla con una vencida. */
function rowClass(goal: ReviewGoal): string {
  if (goal.overdue) return 'goal-overdue';
  if (goal.dueDate === null) return 'goal-nodate';
  return '';
}

function DueBadge({ dueDate, todayKey }: { dueDate: string | null; todayKey: string }) {
  if (dueDate === null) return <span className="due-badge nodate">Fecha no encontrada</span>;
  const days = daysBetween(todayKey, dueDate);
  if (days < 0) {
    const late = -days;
    return <span className="due-badge overdue">Vencida hace {late} {late === 1 ? 'dia' : 'dias'}</span>;
  }
  if (days === 0) return <span className="due-badge today">Vence hoy</span>;
  return <span className="due-badge upcoming">Faltan {days} {days === 1 ? 'dia' : 'dias'}</span>;
}

/** Texto por defecto de la llamada; el superadmin puede editarlo antes de enviar. */
function defaultReason(project: ReviewProject, goal: ReviewGoal): string {
  return `Meta vencida: "${goal.name}" del proyecto "${project.name}" (fecha de finalizacion: ${goal.dueDate})`;
}

function GoalCallModal({
  project,
  goal,
  people,
  onClose,
  onCreated
}: {
  project: ReviewProject;
  goal: ReviewGoal;
  people: Person[];
  onClose: () => void;
  onCreated: (call: Call) => void;
}) {
  const ownerIsActive = !!goal.personKey && people.some((p) => p.person_key === goal.personKey);
  const [personKey, setPersonKey] = useState(ownerIsActive ? goal.personKey! : '');
  const [reason, setReason] = useState(defaultReason(project, goal));
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');

  async function submit() {
    setSending(true);
    setErr('');
    try {
      const call = await api.admin.createManualCall({ personKey, reason: reason.trim(), comment: comment.trim() });
      onCreated(call);
    } catch (e) {
      setErr((e as Error).message);
      setSending(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={() => !sending && onClose()}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Llamada de atencion por meta vencida</h3>
        <p className="section-note">
          Se registra como llamada manual: cuenta tolerancia y periodo, se envia a Slack y queda registrado que la
          creaste tu.
        </p>
        {err && <div className="banner error">{err}</div>}

        <div className="field">
          <label>Persona</label>
          <select value={personKey} onChange={(e) => setPersonKey(e.target.value)}>
            <option value="">Selecciona…</option>
            {people.map((p) => (
              <option key={p.person_key} value={p.person_key}>
                {p.nombre_visible || p.person_key}
              </option>
            ))}
          </select>
        </div>
        {goal.personKey && !ownerIsActive && (
          <p className="section-note" style={{ margin: '8px 0 0' }}>
            ⚠ El responsable indicado en la meta ({goal.personKey}) no es una persona activa del equipo.
          </p>
        )}

        <div className="field" style={{ marginTop: 12 }}>
          <label>Razon</label>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <div className="field">
          <label>Comentario (opcional)</label>
          <textarea
            placeholder="contexto adicional; aparecera en el mensaje de Slack"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </div>

        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose} disabled={sending}>
            Cancelar
          </button>
          <button className="btn btn-primary" onClick={submit} disabled={sending || !personKey || reason.trim().length < 3}>
            {sending ? 'Registrando…' : 'Registrar llamada'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Dias de a hasta b (ambos yyyy-MM-dd); negativo si b es anterior. */
function daysBetween(a: string, b: string): number {
  const toUtc = (k: string) => {
    const [y, m, d] = k.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

function formatTimestamp(ms: number, timezone: string): string {
  try {
    return new Date(ms).toLocaleString('es', { timeZone: timezone, dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return new Date(ms).toLocaleString('es');
  }
}
