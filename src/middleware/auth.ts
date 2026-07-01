/**
 * Middleware de autenticacion para el panel.
 * - Verifica el ID token de Firebase (Authorization: Bearer <token>).
 * - Aplica una allowlist de correos (cerrojo extra, patron de socio-funnel).
 * - requireRole exige un custom claim de rol (admin / superadmin).
 *
 * Los roles se asignan con scripts/set-claims.ts. superadmin implica admin.
 */
import type { Request, Response, NextFunction } from 'express';
import { auth } from '../firebase.js';
import type { Role } from '../domain/types.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: { email: string; uid: string; role: Role | null };
    }
  }
}

export function makeRequireAuth(adminEmails: string[]) {
  return async function requireAuth(req: Request, res: Response, next: NextFunction) {
    try {
      const header = req.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (!token) return res.status(401).json({ ok: false, error: 'no_token' });

      const decoded = await auth().verifyIdToken(token);
      const email = (decoded.email || '').toLowerCase();
      if (!email || (adminEmails.length && !adminEmails.includes(email))) {
        return res.status(403).json({ ok: false, error: 'forbidden' });
      }

      const claimRole = decoded.role as Role | undefined;
      const role: Role | null = claimRole === 'superadmin' || claimRole === 'admin' ? claimRole : null;
      req.user = { email, uid: decoded.uid, role };
      next();
    } catch {
      res.status(401).json({ ok: false, error: 'bad_token' });
    }
  };
}

/** Exige un rol minimo. superadmin pasa cualquier chequeo; admin solo el de admin. */
export function requireRole(minRole: Role) {
  return function (req: Request, res: Response, next: NextFunction) {
    const role = req.user?.role;
    if (!role) return res.status(403).json({ ok: false, error: 'no_role' });
    if (minRole === 'admin' && (role === 'admin' || role === 'superadmin')) return next();
    if (minRole === 'superadmin' && role === 'superadmin') return next();
    return res.status(403).json({ ok: false, error: 'insufficient_role' });
  };
}
