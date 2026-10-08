import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { loginSchema, type SessionUser } from '@sevalens/shared';
import { sqlite } from '../db/client';
import { audit } from '../lib/audit';
import { h, HttpError, parse } from '../lib/http';
import { SESSION_COOKIE } from '../lib/sessionStore';

export const authRouter = Router();

// compared against when the email is unknown, so response time does not reveal valid accounts
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false, skipSuccessfulRequests: true, message: { error: 'Too many sign-in attempts. Try again later.' } });

authRouter.post(
  '/login',
  loginLimiter,
  h(async (req, res) => {
    const { email, password } = parse(loginSchema, req.body);
    const row = sqlite
      .prepare('SELECT u.id, u.email, u.name, u.role, u.password_hash AS hash, u.district_id AS districtId, d.name AS districtName FROM users u LEFT JOIN districts d ON d.id = u.district_id WHERE u.email = ?')
      .get(email) as (SessionUser & { hash: string }) | undefined;
    const ok = row ? await bcrypt.compare(password, row.hash) : await bcrypt.compare(password, DUMMY_HASH);
    if (!row || !ok) {
      audit(req, 'auth.login_failed', 'user', null, { email });
      throw new HttpError(401, 'Invalid email or password.');
    }
    const user: SessionUser = { id: row.id, email: row.email, name: row.name, role: row.role, districtId: row.districtId, districtName: row.districtName };
    await new Promise<void>((resolve, reject) => req.session.regenerate((e) => (e ? reject(e) : resolve())));
    req.session.user = user;
    audit(req, 'auth.login', 'user', user.id);
    res.json({ user });
  }),
);

authRouter.post('/logout', (req, res) => {
  if (req.session.user) audit(req, 'auth.logout', 'user', req.session.user.id);
  req.session.destroy(() => res.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax' }).json({ ok: true }));
});

authRouter.get('/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not signed in' });
  res.json({ user: req.session.user });
});
