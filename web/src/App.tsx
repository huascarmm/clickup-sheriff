import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth.js';
import { Login } from './pages/Login.js';
import { MyCalls } from './pages/MyCalls.js';
import { MyClaims } from './pages/MyClaims.js';
import { MyStats } from './pages/MyStats.js';
import { Claims } from './pages/Claims.js';
import { AllCalls } from './pages/AllCalls.js';
import { CallDetail } from './pages/CallDetail.js';
import { Logs } from './pages/Logs.js';
import { Stats } from './pages/Stats.js';
import { People } from './pages/People.js';
import { Settings } from './pages/Settings.js';

export function App() {
  const { user, role, loading, error, logout, isSuperadmin } = useAuth();
  const location = useLocation();

  if (loading) return <div className="loading">Cargando…</div>;
  if (!user) return <Login />;

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
            <small>{isSuperadmin ? 'consola superadmin' : 'mi panel'}</small>
          </div>
          <nav className="nav">
            {!isSuperadmin && (
              <>
                <NavLink to="/mis-llamadas" className={({ isActive }) => (isActive ? 'active' : '')}>
                  <span className="dot" /> Mis llamadas
                </NavLink>
                <NavLink to="/mis-reclamos" className={({ isActive }) => (isActive ? 'active' : '')}>
                  <span className="dot" /> Mis reclamos
                </NavLink>
                <NavLink to="/mis-estadisticas" className={({ isActive }) => (isActive ? 'active' : '')}>
                  <span className="dot" /> Mis estadisticas
                </NavLink>
              </>
            )}
            {isSuperadmin && (
              <>
                <NavLink to="/reclamos" className={({ isActive }) => (isActive ? 'active' : '')}>
                  <span className="dot" /> Reclamos
                </NavLink>
                <NavLink to="/llamadas" className={({ isActive }) => (isActive ? 'active' : '')}>
                  <span className="dot" /> Llamadas
                </NavLink>
                <NavLink to="/estadisticas" className={({ isActive }) => (isActive ? 'active' : '')}>
                  <span className="dot" /> Estadisticas
                </NavLink>
                <NavLink to="/salud" className={({ isActive }) => (isActive ? 'active' : '')}>
                  <span className="dot" /> Salud del sistema
                </NavLink>
                <NavLink to="/personas" className={({ isActive }) => (isActive ? 'active' : '')}>
                  <span className="dot" /> Personas
                </NavLink>
                <NavLink to="/configuracion" className={({ isActive }) => (isActive ? 'active' : '')}>
                  <span className="dot" /> Configuracion
                </NavLink>
              </>
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
          {!isSuperadmin && (
            <>
              <Route path="/" element={<Navigate to="/mis-llamadas" replace />} />
              <Route path="/mis-llamadas" element={<MyCalls />} />
              <Route path="/mis-reclamos" element={<MyClaims />} />
              <Route path="/mis-estadisticas" element={<MyStats />} />
            </>
          )}
          {isSuperadmin && (
            <>
              <Route path="/" element={<Navigate to="/reclamos" replace />} />
              <Route path="/reclamos" element={<Claims />} />
              <Route path="/llamadas" element={<AllCalls />} />
              <Route path="/llamadas/:id" element={<CallDetail />} />
              <Route path="/estadisticas" element={<Stats />} />
              <Route path="/salud" element={<Logs />} />
              <Route path="/personas" element={<People />} />
              <Route path="/configuracion" element={<Settings />} />
            </>
          )}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
