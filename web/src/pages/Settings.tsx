import { useEffect, useState } from 'react';
import { api, type Settings as S } from '../api.js';
import { useAuth } from '../auth.js';

export function Settings() {
  const { isSuperadmin } = useAuth();
  const [s, setS] = useState<S | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        setS(await api.getConfig());
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
      const saved = await api.saveConfig(s);
      setS(saved);
      setMsg('Configuracion guardada.');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <div className="loading">Cargando…</div>;
  if (!s) return <div className="banner error">{err || 'No se pudo cargar la configuracion.'}</div>;

  const ro = !isSuperadmin;

  return (
    <div className="fade-in">
      <div className="page-head">
        <p className="eyebrow">Configuracion · Reglas</p>
        <h1>Parametros del sistema</h1>
        <p>
          Ajusta los umbrales y la tolerancia sin tocar codigo. Los cambios aplican a las siguientes
          evaluaciones. {ro && <span className="tag-super">solo lectura — necesitas superadmin</span>}
        </p>
      </div>

      {err && <div className="banner error">{err}</div>}
      {msg && <div className="banner info">{msg}</div>}

      <div className="panel">
        <div className="panel-head">
          <h2>Umbrales y tolerancia</h2>
        </div>
        <div className="panel-body">
          <div className="form-grid">
            <div className="field">
              <label>Horas limite en QA</label>
              <input type="number" disabled={ro} value={s.qaHoursLimit} onChange={(e) => set('qaHoursLimit', Number(e.target.value))} />
            </div>
            <div className="field">
              <label>Horas limite en FIXING QA</label>
              <input type="number" disabled={ro} value={s.fixingHoursLimit} onChange={(e) => set('fixingHoursLimit', Number(e.target.value))} />
            </div>
            <div className="field">
              <label>Tolerancia semanal (avisos antes de llamada formal)</label>
              <input type="number" disabled={ro} value={s.overdueWeeklyTolerance} onChange={(e) => set('overdueWeeklyTolerance', Number(e.target.value))} />
            </div>
            <div className="field">
              <label>Zona horaria</label>
              <input disabled={ro} value={s.timezone} onChange={(e) => set('timezone', e.target.value)} />
            </div>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Estados y campos de ClickUp</h2>
        </div>
        <div className="panel-body">
          <div className="form-grid">
            <div className="field">
              <label>Nombre del estado QA</label>
              <input disabled={ro} value={s.qaStatusName} onChange={(e) => set('qaStatusName', e.target.value)} />
            </div>
            <div className="field">
              <label>Nombre del estado FIXING QA</label>
              <input disabled={ro} value={s.fixingQaStatusName} onChange={(e) => set('fixingQaStatusName', e.target.value)} />
            </div>
            <div className="field">
              <label>Campo QA (responsable)</label>
              <input disabled={ro} value={s.qaFieldName} onChange={(e) => set('qaFieldName', e.target.value)} />
            </div>
            <div className="field">
              <label>Campo de cambio de estado</label>
              <input disabled={ro} value={s.statusChangeFieldName} onChange={(e) => set('statusChangeFieldName', e.target.value)} />
            </div>
            <div className="field full">
              <label>Estados ignorados (separados por coma)</label>
              <input
                disabled={ro}
                value={s.ignoredStatuses.join(', ')}
                onChange={(e) => set('ignoredStatuses', e.target.value.split(',').map((x) => x.trim()).filter(Boolean))}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Slack</h2>
        </div>
        <div className="panel-body">
          <p className="section-note">
            El token del bot NO se configura aqui (vive en Secret Manager). Aqui solo el canal destino.
          </p>
          <div className="form-grid">
            <div className="field">
              <label>Nombre del canal</label>
              <input disabled={ro} value={s.slackChannelName} onChange={(e) => set('slackChannelName', e.target.value)} />
            </div>
            <div className="field">
              <label>ID del canal (opcional, mas rapido)</label>
              <input disabled={ro} value={s.slackChannelId} onChange={(e) => set('slackChannelId', e.target.value)} />
            </div>
          </div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <h2>Validador de plazo</h2>
        </div>
        <div className="panel-body">
          <p className="section-note">
            Marca un checkbox en ClickUp cuando el vencimiento tiene una hora personalizada (distinta de la hora
            default de ClickUp).
          </p>
          <div className="form-grid">
            <div className="field">
              <label>Hora default (0-23)</label>
              <input type="number" disabled={ro} value={s.plazoHourDefault} onChange={(e) => set('plazoHourDefault', Number(e.target.value))} />
            </div>
            <div className="field">
              <label>Minuto default (0-59)</label>
              <input type="number" disabled={ro} value={s.plazoMinuteDefault} onChange={(e) => set('plazoMinuteDefault', Number(e.target.value))} />
            </div>
            <div className="field">
              <label>Nombre del campo checkbox</label>
              <input disabled={ro} value={s.plazoFieldName} onChange={(e) => set('plazoFieldName', e.target.value)} />
            </div>
            <div className="field">
              <label>ID del campo (opcional)</label>
              <input disabled={ro} value={s.plazoFieldId} onChange={(e) => set('plazoFieldId', e.target.value)} />
            </div>
          </div>
        </div>
      </div>

      {!ro && (
        <div style={{ marginTop: 18, display: 'flex', gap: 10 }}>
          <button className="btn btn-primary" onClick={save} disabled={saving}>
            {saving ? 'Guardando…' : 'Guardar configuracion'}
          </button>
        </div>
      )}
    </div>
  );
}
