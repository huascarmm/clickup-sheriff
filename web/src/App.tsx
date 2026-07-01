import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth.js';
import { Login } from './pages/Login.js';
import { Calls } from './pages/Calls.js';
import { CallDetail } from './pages/CallDetail.js';
import { People } from './pages/People.js';
import { Settings } from './pages/Settings.js';
import { Audit } from './pages/Audit.js';

export function App() {
  const { user, role, loading, error, logout, isSuperadmin } = useAuth();
  const location = useLocation();

  if (loading) {
    return <div className="loading">Cargando…</div>;
  }

  if (!user) return <Login />;

  // Autenticado pero sin rol: no puede usar el panel.
  if (!role) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <div className="brand">
            llamadas<span className="tick">·</span>atencion
          </div>
          <p className="sub">acceso restringido</p>
          <div className="banner error">
            {error || 'Tu cuenta no tiene un rol asignado. Pide a un superadmin que te asigne acceso.'}
          </div>
          <button className="btn btn-ghost" style={{ width: '100%' }} onClick={logout}>
            Cerrar sesion
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div>
          <div className="wordmark">
            llamadas<span className="tick">·</span>atencion
            <small>panel de control</small>
          </div>
          <nav className="nav">
            <NavLink to="/calls" className={({ isActive }) => (isActive ? 'active' : '')}>
              <span className="dot" /> Llamadas
            </NavLink>
            <NavLink to="/people" className={({ isActive }) => (isActive ? 'active' : '')}>
              <span className="dot" /> Cuentas del equipo
            </NavLink>
            <NavLink to="/settings" className={({ isActive }) => (isActive ? 'active' : '')}>
              <span className="dot" /> Configuracion
            </NavLink>
            {isSuperadmin && (
              <NavLink to="/audit" className={({ isActive }) => (isActive ? 'active' : '')}>
                <span className="dot" /> Auditoria
              </NavLink>
            )}
          </nav>
        </div>

        <div className="user">
          <div className="email">{user.email}</div>
          <span className={`role ${isSuperadmin ? 'super' : ''}`}>{role}</span>
          <button className="btn-logout" onClick={logout}>
            Cerrar sesion
          </button>
        </div>
      </aside>

      <main className="main" key={location.pathname}>
        <Routes>
          <Route path="/" element={<Navigate to="/calls" replace />} />
          <Route path="/calls" element={<Calls />} />
          <Route path="/calls/:id" element={<CallDetail />} />
          <Route path="/people" element={<People />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/audit" element={isSuperadmin ? <Audit /> : <Navigate to="/calls" replace />} />
          <Route path="*" element={<Navigate to="/calls" replace />} />
        </Routes>
      </main>
    </div>
  );
}
