import type { NextFunction, Request, Response } from 'express';
import type { Role, SessionUser } from '@sevalens/shared';
import { HttpError } from '../lib/http';

declare module 'express-session' {
  interface SessionData {
    user?: SessionUser;
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.session.user) return next(new HttpError(401, 'Please sign in.'));
  next();
}

export const requireRole = (...roles: Role[]) => (req: Request, _res: Response, next: NextFunction) => {
  const u = req.session.user;
  if (!u || !roles.includes(u.role)) return next(new HttpError(403, 'You do not have access to this resource.'));
  next();
};

export const currentUser = (req: Request): SessionUser => {
  const u = req.session.user;
  if (!u) throw new HttpError(401, 'Please sign in.');
  return u;
};

/** District scope enforced server-side. null = all districts (state admin). */
export function districtScope(req: Request): number | null {
  const u = currentUser(req);
  return u.role === 'STATE_ADMIN' ? null : u.districtId;
}

export function inScope(req: Request, districtId: number): boolean {
  const s = districtScope(req);
  return s === null || s === districtId;
}

export function assertInScope(req: Request, districtId: number) {
  if (!inScope(req, districtId)) throw new HttpError(403, 'This district is outside your jurisdiction.');
}

/** Resolve the effective district filter: officers are pinned to their district. */
export function effectiveDistrict(req: Request, requested?: number): number | undefined {
  const s = districtScope(req);
  if (s === null) return requested;
  if (requested !== undefined && requested !== s) throw new HttpError(403, 'This district is outside your jurisdiction.');
  return s;
}
