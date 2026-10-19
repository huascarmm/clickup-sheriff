import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { api, type Call, type Person, type ReviewGoal, type ReviewGoalsSnapshot, type ReviewProject } from '../api.js';
import { useAuth } from '../auth.js';
import { StatCard } from './ui.js';

/**
 * Panel de revisor (todos los roles). Muestra TODOS
 * los proyectos con sus metas, fechas de finalizacion y % de avance, tal como
 * llegaron por el webhook /webhooks/goals, y resalta las vencidas.
 *
 * "Vencida" = plazo terminado y avance por debajo del umbral. El umbral es
 * solo del cliente: arranca en DEFAULT_THRESHOLD en cada carga, no se guarda
 * en ningun lado y se aplica al presionar Enter en su campo.
 *
 * El superadmin ademas puede crear, desde una meta vencida, una llamada de
 * atencion manual con un texto por defecto (usa el mismo flujo que la pagina
 * "Llamada manual": tolerancia, periodo, Slack y auditoria).
 */
const DEFAULT_THRESHOLD = 90;

export function ReviewerPanel() {
  const { role, isSuperadmin } = useAuth();
  const [data, setData] = useState<ReviewGoalsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  // threshold = el aplicado a las tablas; thresholdInput = lo que se esta escribiendo.
  const [threshold, setThreshold] = useState(DEFAULT_THRESHOLD);
  const [thresholdInput, setThresholdInput] = useState(String(DEFAULT_THRESHOLD));
  const [thresholdErr, setThresholdErr] = useState('');

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

  function onThresholdKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    const text = thresholdInput.trim();
    const value = Number(text);
    if (!text || !Number.isFinite(value) || value < 0 || value > 100) {
      setThresholdErr('El umbral debe ser un numero de 0 a 100.');
      return;
    }
    setThresholdErr('');
    setThreshold(value);
  }

  const totals = useMemo(() => {
    const goals = (data?.projects || []).flatMap((p) => p.goals);
    return {
      projects: data?.projects.length ?? 0,
      goals: goals.length,
      overdue: goals.filter((g) => isOverdue(g, threshold)).length,
      noDate: goals.filter((g) => g.dueDate === null).length
    };
  }, [data, threshold]);

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
            {data &&
              `Hoy es ${data.todayKey} (${data.timezone}). Una meta esta vencida si su fecha ya paso y su avance esta por debajo del umbral.`}
          </p>
        </div>
        <div className="review-controls">
          <div className="field">
            <label htmlFor="review-threshold">Umbral de avance (%)</label>
            <input
              id="review-threshold"
              type="number"
              min={0}
              max={100}
              step="any"
              value={thresholdInput}
              onChange={(e) => setThresholdInput(e.target.value)}
              onKeyDown={onThresholdKeyDown}
              aria-describedby="review-threshold-hint"
            />
            <small id="review-threshold-hint" className={thresholdErr ? 'threshold-err' : 'dim'}>
              {thresholdErr || `Aplicado: ${formatPercent(threshold)}. Enter para aplicar.`}
            </small>
          </div>
          <button className="btn btn-ghost" onClick={load} disabled={loading}>
            {loading ? 'Cargando…' : 'Actualizar'}
          </button>
        </div>
      </div>

      {err && <div className="banner error">{err}</div>}
      {msg && <div className="banner info">{msg}</div>}

      {data && (
        <div className="gauges">
          <StatCard label="Proyectos" value={totals.projects} />
          <StatCard label="Metas" value={totals.goals} />
          <StatCard
            label={`Vencidas (< ${formatPercent(threshold)})`}
            value={totals.overdue}
            tone={totals.overdue ? 'alert' : 'ok'}
          />
          <StatCard label="Metas sin fecha" value={totals.noDate} />
        </div>
      )}

      {data?.projects.map((project) => {
        const overdue = project.goals.filter((g) => isOverdue(g, threshold)).length;
        const noDate = project.goals.filter((g) => g.dueDate === null).length;
        return (
          <div className="panel" key={project.name}>
            <div className="panel-head">
              <h2>{project.name}</h2>
              <span className="dim mono">{project.goals.length} metas</span>
              {overdue > 0 && <span className="due-badge overdue">{overdue} vencidas</span>}
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
                      <th>Avance</th>
                      <th>Estado</th>
                      {isSuperadmin && <th></th>}
                    </tr>
                  </thead>
                  <tbody>
                    {project.goals.map((goal) => {
                      const goalOverdue = isOverdue(goal, threshold);
                      return (
                        <tr key={goal.id} className={rowClass(goal, goalOverdue)}>
                          <td className={`signal ${goalOverdue ? 'alert' : goal.dueDate === null ? 'nodate' : 'none'}`}>
                            <span />
                          </td>
                          <td>{goal.name}</td>
                          <td className="dim">{goal.personName || goal.personKey || '—'}</td>
                          <td className="mono nowrap">{goal.dueDate ?? '—'}</td>
                          <td className="nowrap">
                            <Progress completed={goal.completed} reached={(goal.completed ?? 0) >= threshold} />
                          </td>
                          <td className="nowrap">
                            <DueBadge dueDate={goal.dueDate} todayKey={data.todayKey} overdue={goalOverdue} />
                          </td>
                          {isSuperadmin && (
                            <td className="nowrap">
                              {goalOverdue && (
                                <button className="btn btn-danger" onClick={() => openCall(project, goal)}>
                                  Llamada de atencion
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
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

/** Vencida = plazo terminado y avance bajo el umbral. Sin dato de avance cuenta como 0%. */
function isOverdue(goal: ReviewGoal, threshold: number): boolean {
  return goal.pastDue && (goal.completed ?? 0) < threshold;
}

/** Vencida en rojo; sin fecha en violeta, para no confundirla con una vencida. */
function rowClass(goal: ReviewGoal, overdue: boolean): string {
  if (overdue) return 'goal-overdue';
  if (goal.dueDate === null) return 'goal-nodate';
  return '';
}

function Progress({ completed, reached }: { completed: number | null; reached: boolean }) {
  if (completed === null) return <span className="dim mono">sin dato</span>;
  return (
    <span className={`progress ${reached ? 'reached' : ''}`} title={`${formatPercent(completed)} de avance`}>
      <span className="progress-track">
        <span className="progress-fill" style={{ width: `${completed}%` }} />
      </span>
      <span className="progress-num">{formatPercent(completed)}</span>
    </span>
  );
}

function DueBadge({ dueDate, todayKey, overdue }: { dueDate: string | null; todayKey: string; overdue: boolean }) {
  if (dueDate === null) return <span className="due-badge nodate">Fecha no encontrada</span>;
  const days = daysBetween(todayKey, dueDate);
  if (days < 0) {
    const late = -days;
    const ago = `hace ${late} ${late === 1 ? 'dia' : 'dias'}`;
    // Plazo terminado pero con avance sobre el umbral: no se marca como vencida.
    if (!overdue) return <span className="due-badge upcoming">Plazo terminado {ago}</span>;
    return <span className="due-badge overdue">Vencida {ago}</span>;
  }
  if (days === 0) return <span className="due-badge today">Vence hoy</span>;
  return <span className="due-badge upcoming">Faltan {days} {days === 1 ? 'dia' : 'dias'}</span>;
}

/** Texto por defecto de la llamada; el superadmin puede editarlo antes de enviar. */
function defaultReason(project: ReviewProject, goal: ReviewGoal): string {
  const progress = goal.completed === null ? 'sin dato' : formatPercent(goal.completed);
  return `Meta vencida: "${goal.name}" del proyecto "${project.name}" (fecha de finalizacion: ${goal.dueDate}, avance: ${progress})`;
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

/** 26 -> "26%", 26.5 -> "26.5%". */
function formatPercent(value: number): string {
  return `${Number.isInteger(value) ? value : value.toFixed(2).replace(/0+$/, '')}%`;
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
