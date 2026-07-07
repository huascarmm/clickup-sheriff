import { useEffect, useMemo, useState } from 'react';
import { api, type Call, type Person } from '../api.js';
import { AlertChip, ToleranceMeter } from './ui.js';

/**
 * Panel del superadmin: registrar una llamada de atencion MANUAL.
 * Se elige una persona del equipo, se escribe una razon y un comentario. La
 * llamada sigue el mismo flujo que las automaticas: cuenta tolerancia/periodo,
 * se envia a Slack y queda registrado quien la creo.
 */
const REASON_SUGGESTIONS = [
  'Incumplimiento de acuerdo en daily',
  'Falta de comunicacion sobre bloqueo',
  'Entrega fuera de proceso',
  'Reincidencia en atrasos',
  'Otro (especificar)'
];

export function ManualCall() {
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const [personKey, setPersonKey] = useState('');
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<Call | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const list = await api.admin.people();
        setPeople(list.filter((p) => p.activo));
      } catch (e) {
        setErr((e as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const selectedPerson = useMemo(() => people.find((p) => p.person_key === personKey) || null, [people, personKey]);
  const canSubmit = personKey && reason.trim().length >= 3 && !sending;

  async function submit() {
    setSending(true);
    setErr('');
    setResult(null);
    try {
      const call = await api.admin.createManualCall({ personKey, reason: reason.trim(), comment: comment.trim() });
      setResult(call);
      setReason('');
      setComment('');
      setPersonKey('');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="fade-in">
      <div className="page-head">
        <p className="eyebrow">Superadmin · Manual</p>
        <h1>Llamada de atencion manual</h1>
        <p>
          Registra una llamada a mano para un miembro del equipo. Sigue el mismo procedimiento que las
          automaticas: se envia a Slack, se contabiliza como tolerancia o formal segun la semana, y queda
          registrado que la creaste tu.
        </p>
      </div>

      {err && <div className="banner error">{err}</div>}

      {result && (
        <div className="panel" style={{ marginBottom: 18 }}>
          <div className="panel-body">
            <div className="banner info" style={{ marginBottom: 12 }}>
              Llamada registrada para <strong>{result.personName}</strong>.{' '}
              {result.isTolerance ? 'Se conto como aviso de tolerancia.' : `Es llamada formal #${result.periodAttentionCountAfter} del periodo.`}{' '}
              {result.slackOk ? 'Enviada a Slack.' : `No se pudo enviar a Slack: ${result.slackError || 'error'}.`}
            </div>
            <div className="claim-meta">
              <AlertChip type={result.alertType} /> <ToleranceMeter tolerance={result.tolerance} />{' '}
              <span className="dim mono">{result.timestampLocal}</span>
            </div>
          </div>
        </div>
      )}

      <div className="panel">
        <div className="panel-head">
          <h2>Nueva llamada</h2>
        </div>
        <div className="panel-body">
          {loading ? (
            <div className="loading">Cargando equipo…</div>
          ) : (
            <div className="form-grid">
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

              <div className="field">
                <label>Razon</label>
                <input
                  list="reason-suggestions"
                  placeholder="motivo de la llamada"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <datalist id="reason-suggestions">
                  {REASON_SUGGESTIONS.map((r) => (
                    <option key={r} value={r} />
                  ))}
                </datalist>
              </div>

              <div className="field full">
                <label>Comentario (opcional)</label>
                <textarea
                  placeholder="contexto adicional; aparecera en el mensaje de Slack"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                />
              </div>

              {selectedPerson && !selectedPerson.slack_user_id && (
                <div className="field full">
                  <p className="section-note">
                    ⚠ {selectedPerson.nombre_visible} no tiene Slack configurado; el mensaje se enviara con su
                    nombre en texto, sin mencion.
                  </p>
                </div>
              )}
            </div>
          )}

          <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
            <button className="btn btn-primary" onClick={submit} disabled={!canSubmit}>
              {sending ? 'Registrando…' : 'Registrar llamada'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
