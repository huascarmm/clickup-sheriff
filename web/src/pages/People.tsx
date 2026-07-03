import { useEffect, useState } from 'react';
import { api, type Person } from '../api.js';
import { useAuth } from '../auth.js';

const EMPTY: Person = {
  person_key: '',
  nombre_visible: '',
  qa_string: '',
  clickup_user_id: '',
  clickup_username: '',
  clickup_email: '',
  login_email: '',
  slack_user_id: '',
  activo: true,
  notas: ''
};

export function People() {
  const { isSuperadmin } = useAuth();
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [editing, setEditing] = useState<Person | null>(null);

  async function load() {
    setLoading(true);
    try {
      setPeople(await api.admin.people());
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);

  async function save() {
    if (!editing) return;
    if (!editing.person_key.trim()) {
      setErr('La clave (person_key) es obligatoria.');
      return;
    }
    setErr('');
    try {
      await api.admin.savePerson(editing);
      setMsg(`Guardado: ${editing.nombre_visible || editing.person_key}`);
      setEditing(null);
      await load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function remove(key: string) {
    if (!confirm(`Eliminar la cuenta "${key}"?`)) return;
    try {
      await api.admin.deletePerson(key);
      await load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <div className="fade-in">
      <div className="page-head">
        <p className="eyebrow">Configuracion · Equipo</p>
        <h1>Cuentas del equipo</h1>
        <p>
          Vincula cada persona con su usuario de ClickUp (por id, usuario o correo), el valor del campo QA y su
          usuario de Slack para las menciones. Solo un superadmin puede editar.
        </p>
      </div>

      {err && <div className="banner error">{err}</div>}
      {msg && <div className="banner info">{msg}</div>}

      <div className="panel">
        <div className="panel-head">
          <h2>Personas ({people.length})</h2>
          {isSuperadmin && (
            <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={() => setEditing({ ...EMPTY })}>
              Agregar persona
            </button>
          )}
        </div>

        {loading ? (
          <div className="loading">Cargando…</div>
        ) : people.length === 0 ? (
          <div className="empty">
            <h3>Aun no hay cuentas</h3>
            <p>Agrega a las personas del equipo para que las menciones de Slack funcionen.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table className="calls">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Clave</th>
                  <th>QA string</th>
                  <th>Correo login</th>
                  <th>ClickUp</th>
                  <th>Slack</th>
                  <th>Activo</th>
                  {isSuperadmin && <th></th>}
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.person_key}>
                    <td>{p.nombre_visible || '—'}</td>
                    <td className="mono">{p.person_key}</td>
                    <td className="mono">{p.qa_string || '—'}</td>
                    <td className="dim">{p.login_email || '—'}</td>
                    <td className="dim">{p.clickup_username || p.clickup_user_id || p.clickup_email || '—'}</td>
                    <td className="mono">{p.slack_user_id || '—'}</td>
                    <td>{p.activo ? 'si' : 'no'}</td>
                    {isSuperadmin && (
                      <td className="nowrap">
                        <button className="btn btn-ghost" onClick={() => setEditing({ ...p })}>
                          Editar
                        </button>{' '}
                        <button className="btn btn-ghost" onClick={() => remove(p.person_key)}>
                          Eliminar
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing && (
        <div className="modal-backdrop" onClick={() => setEditing(null)}>
          <div className="modal" style={{ maxWidth: 560 }} onClick={(e) => e.stopPropagation()}>
            <h3>{editing.person_key ? 'Editar persona' : 'Nueva persona'}</h3>
            <div className="form-grid" style={{ marginTop: 12 }}>
              <div className="field">
                <label>Clave (person_key)</label>
                <input
                  value={editing.person_key}
                  disabled={!!people.find((p) => p.person_key === editing.person_key)}
                  onChange={(e) => setEditing({ ...editing, person_key: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Nombre visible</label>
                <input value={editing.nombre_visible} onChange={(e) => setEditing({ ...editing, nombre_visible: e.target.value })} />
              </div>
              <div className="field">
                <label>QA string</label>
                <input value={editing.qa_string} onChange={(e) => setEditing({ ...editing, qa_string: e.target.value })} />
              </div>
              <div className="field">
                <label>Slack user id</label>
                <input value={editing.slack_user_id} onChange={(e) => setEditing({ ...editing, slack_user_id: e.target.value })} />
              </div>
              <div className="field">
                <label>ClickUp user id</label>
                <input value={editing.clickup_user_id} onChange={(e) => setEditing({ ...editing, clickup_user_id: e.target.value })} />
              </div>
              <div className="field">
                <label>ClickUp usuario</label>
                <input value={editing.clickup_username} onChange={(e) => setEditing({ ...editing, clickup_username: e.target.value })} />
              </div>
              <div className="field full">
                <label>ClickUp correo</label>
                <input value={editing.clickup_email} onChange={(e) => setEditing({ ...editing, clickup_email: e.target.value })} />
              </div>
              <div className="field full">
                <label>Correo de Google (login del panel)</label>
                <input
                  type="email"
                  placeholder="correo con el que inicia sesion"
                  value={editing.login_email}
                  onChange={(e) => setEditing({ ...editing, login_email: e.target.value })}
                />
              </div>
              <div className="field">
                <label>Activo</label>
                <select
                  value={editing.activo ? 'si' : 'no'}
                  onChange={(e) => setEditing({ ...editing, activo: e.target.value === 'si' })}
                >
                  <option value="si">si</option>
                  <option value="no">no</option>
                </select>
              </div>
              <div className="field full">
                <label>Notas</label>
                <input value={editing.notas} onChange={(e) => setEditing({ ...editing, notas: e.target.value })} />
              </div>
            </div>
            <div className="modal-actions" style={{ marginTop: 16 }}>
              <button className="btn btn-ghost" onClick={() => setEditing(null)}>
                Cancelar
              </button>
              <button className="btn btn-primary" onClick={save}>
                Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
