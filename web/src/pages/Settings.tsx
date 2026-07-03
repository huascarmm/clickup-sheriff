import { useEffect, useState } from 'react';
import { api, type Settings as S } from '../api.js';

/** Configuracion (superadmin). Los campos de ClickUp se referencian por ID. */
export function Settings() {
  const [s, setS] = useState<S | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setS(await api.admin.config());
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function set<K extends keyof S>(key: K, value: S[K]) {
    if (!s) return;
    setS({ ...s, [key]: value });
    setMsg('');
  }

  async function save() {
    if (!s) return;
    setSaving(true);
    setErr('');
    try {
      setS(await api.admin.saveConfig(s));
      setMsg('Configuracion guardada.');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="loading">Cargando…</div>;
  if (!s) return <div className="banner error">{err || 'No se pudo cargar la configuracion.'}</div>;

  return (
    <div className="fade-in">
      <div className="page-head">
        <p className="eyebrow">Superadmin · Configuracion</p>
        <h1>Parametros del sistema</h1>
        <p>Los campos personalizados de ClickUp se referencian por su <strong>ID</strong> (no por nombre) para evitar errores.</p>
      </div>

      {err && <div className="banner error">{err}</div>}
      {msg && <div className="banner info">{msg}</div>}

      <div className="panel">
        <div className="panel-head"><h2>Campos personalizados de ClickUp (por ID)</h2></div>
        <div className="panel-body">
          <p className="section-note">
            El ID de un campo se obtiene de la API de ClickUp (GET task, arreglo <code>custom_fields[].id</code>). La
            etiqueta es solo referencia visual.
          </p>
          <div className="form-grid">
            <div className="field">
              <label>ID campo REVISOR</label>
              <input className="mono" value={s.qaFieldId} onChange={(e) => set('qaFieldId', e.target.value)} placeholder="uuid del campo" />
            </div>
            <div className="field">
              <label>Etiqueta (REVISOR)</label>
              <input value={s.qaFieldLabel} onChange={(e) => set('qaFieldLabel', e.target.value)} />
            </div>
            <div className="field">
              <label>ID campo cambio de estado</label>
              <input className="mono" value={s.statusChangeFieldId} onChange={(e) => set('statusChangeFieldId', e.target.value)} placeholder="uuid del campo" />
            </div>
            <div className="field">
              <label>Etiqueta (time_status_change)</label>
              <input value={s.statusChangeFieldLabel} onChange={(e) => set('statusChangeFieldLabel', e.target.value)} />
            </div>
            <div className="field">
              <label>ID campo checkbox de plazo</label>
              <input className="mono" value={s.plazoFieldId} onChange={(e) => set('plazoFieldId', e.target.value)} placeholder="uuid del campo" />
            </div>
            <div className="field">
              <label>Etiqueta (plazo_hora)</label>
              <input value={s.plazoFieldLabel} onChange={(e) => set('plazoFieldLabel', e.target.value)} />
            </div>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><h2>Umbrales, tolerancia y periodo</h2></div>
        <div className="panel-body">
          <div className="form-grid">
            <div className="field">
              <label>Horas limite en QA</label>
              <input type="number" value={s.qaHoursLimit} onChange={(e) => set('qaHoursLimit', Number(e.target.value))} />
            </div>
            <div className="field">
              <label>Horas limite en FIXING QA</label>
              <input type="number" value={s.fixingHoursLimit} onChange={(e) => set('fixingHoursLimit', Number(e.target.value))} />
            </div>
            <div className="field">
              <label>Tolerancia semanal (avisos antes de formal)</label>
              <input type="number" value={s.overdueWeeklyTolerance} onChange={(e) => set('overdueWeeklyTolerance', Number(e.target.value))} />
            </div>
            <div className="field">
              <label>Reinicio de contadores (meses)</label>
              <select value={s.resetPeriodMonths} onChange={(e) => set('resetPeriodMonths', Number(e.target.value))}>
                <option value={1}>1 (mensual)</option>
                <option value={2}>2 (bimestral)</option>
                <option value={3}>3 (trimestral)</option>
                <option value={4}>4 (cuatrimestral)</option>
                <option value={6}>6 (semestral)</option>
              </select>
            </div>
            <div className="field">
              <label>Zona horaria</label>
              <input value={s.timezone} onChange={(e) => set('timezone', e.target.value)} />
            </div>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><h2>Estados de ClickUp</h2></div>
        <div className="panel-body">
          <div className="form-grid">
            <div className="field">
              <label>Nombre del estado QA</label>
              <input value={s.qaStatusName} onChange={(e) => set('qaStatusName', e.target.value)} />
            </div>
            <div className="field">
              <label>Nombre del estado FIXING QA</label>
              <input value={s.fixingQaStatusName} onChange={(e) => set('fixingQaStatusName', e.target.value)} />
            </div>
            <div className="field full">
              <label>Estados ignorados (separados por coma)</label>
              <input
                value={s.ignoredStatuses.join(', ')}
                onChange={(e) => set('ignoredStatuses', e.target.value.split(',').map((x) => x.trim()).filter(Boolean))}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><h2>Slack y validador de plazo</h2></div>
        <div className="panel-body">
          <p className="section-note">El token del bot vive en Secret Manager, no aqui.</p>
          <div className="form-grid">
            <div className="field">
              <label>Canal Slack (nombre)</label>
              <input value={s.slackChannelName} onChange={(e) => set('slackChannelName', e.target.value)} />
            </div>
            <div className="field">
              <label>Canal Slack (ID, opcional)</label>
              <input className="mono" value={s.slackChannelId} onChange={(e) => set('slackChannelId', e.target.value)} />
            </div>
            <div className="field">
              <label>Hora default plazo (0-23)</label>
              <input type="number" value={s.plazoHourDefault} onChange={(e) => set('plazoHourDefault', Number(e.target.value))} />
            </div>
            <div className="field">
              <label>Minuto default plazo (0-59)</label>
              <input type="number" value={s.plazoMinuteDefault} onChange={(e) => set('plazoMinuteDefault', Number(e.target.value))} />
            </div>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head"><h2>Verificacion en vivo (lista y canal de PRUEBA)</h2></div>
        <div className="panel-body">
          <p className="section-note">
            La verificacion crea tareas reales en esta lista de ClickUp y postea en este canal de Slack, luego limpia
            todo. Usa recursos DEDICADOS de prueba, no los reales.
          </p>
          <div className="form-grid">
            <div className="field">
              <label>ID de lista de prueba (ClickUp)</label>
              <input className="mono" value={s.testClickupListId} onChange={(e) => set('testClickupListId', e.target.value)} />
            </div>
            <div className="field">
              <label>ID de canal de prueba (Slack)</label>
              <input className="mono" value={s.testSlackChannelId} onChange={(e) => set('testSlackChannelId', e.target.value)} />
            </div>
            <div className="field">
              <label>Persona asignada en la prueba (key)</label>
              <input value={s.testAssigneePersonKey} onChange={(e) => set('testAssigneePersonKey', e.target.value)} />
            </div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 18, display: 'flex', gap: 10 }}>
        <button className="btn btn-primary" onClick={save} disabled={saving}>
          {saving ? 'Guardando…' : 'Guardar configuracion'}
        </button>
      </div>
    </div>
  );
}
