/**
 * Contexto de autenticacion. Expone el usuario, su rol (leido del backend, que
 * a su vez lo lee de los custom claims) y las acciones de login/logout.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { auth } from './firebase.js';
import { api } from './api.js';

type Role = 'admin' | 'superadmin' | null;

interface AuthState {
  user: User | null;
  role: Role;
  loading: boolean;
  error: string;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  isSuperadmin: boolean;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<Role>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setError('');
      if (u) {
        try {
          const me = await api.me();
          setRole(me.role);
        } catch (e) {
          // Autenticado pero sin permiso o sin rol.
          setRole(null);
          setError((e as Error).message);
        }
      } else {
        setRole(null);
      }
      setLoading(false);
    });
  }, []);

  async function login(email: string, password: string) {
    setError('');
    try {
      await signInWithEmailAndPassword(auth, email, password);
    } catch (e: any) {
      const code = e?.code || '';
      if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) {
        throw new Error('Correo o contrasena incorrectos.');
      }
      if (code.includes('too-many-requests')) throw new Error('Demasiados intentos. Espera un momento.');
      throw new Error('No se pudo iniciar sesion.');
    }
  }

  async function logout() {
    await signOut(auth);
  }

  return (
    <Ctx.Provider
      value={{ user, role, loading, error, login, logout, isSuperadmin: role === 'superadmin' }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth fuera de AuthProvider');
  return v;
}
