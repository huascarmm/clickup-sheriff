/**
 * Contexto de autenticacion. Login con Google. El rol (admin/superadmin) lo
 * decide el backend a partir de los custom claims; aqui solo lo consumimos.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { auth, googleProvider } from './firebase.js';
import { api } from './api.js';

type Role = 'admin' | 'superadmin' | null;

interface AuthState {
  user: User | null;
  role: Role;
  loading: boolean;
  error: string;
  loginWithGoogle: () => Promise<void>;
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
          const me = await api.whoami();
          setRole(me.role);
        } catch (e) {
          setRole(null);
          setError((e as Error).message);
        }
      } else {
        setRole(null);
      }
      setLoading(false);
    });
  }, []);

  async function loginWithGoogle() {
    setError('');
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e: any) {
      const code = e?.code || '';
      if (code.includes('popup-closed-by-user') || code.includes('cancelled-popup-request')) {
        throw new Error('Se cerro la ventana de Google antes de terminar.');
      }
      if (code.includes('popup-blocked')) throw new Error('El navegador bloqueo la ventana emergente. Habilitala e intenta de nuevo.');
      throw new Error('No se pudo iniciar sesion con Google.');
    }
  }

  async function logout() {
    await signOut(auth);
  }

  return (
    <Ctx.Provider value={{ user, role, loading, error, loginWithGoogle, logout, isSuperadmin: role === 'superadmin' }}>
      {children}
    </Ctx.Provider>
  );
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth fuera de AuthProvider');
  return v;
}
