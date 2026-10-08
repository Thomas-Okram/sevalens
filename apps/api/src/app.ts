import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { authRouter } from './routes/auth';
import { analyticsRouter } from './routes/analytics';
import { aiRouter } from './routes/ai';
import { actionsRouter } from './routes/actions';
import { forecastRouter } from './routes/forecast';
import { ingestRouter } from './routes/ingest';
import { requireAuth, requireRole } from './middleware/auth';
import { errorHandler } from './lib/http';
import { SESSION_COOKIE, SqliteSessionStore } from './lib/sessionStore';

const DEMO_SECRET = 'sevalens-demo-secret-change-me';
/** Secrets that appear in this repo (.env.example, the demo default) and so are public. */
const PUBLISHED_SECRETS = [DEMO_SECRET, 'change-me-in-production'];

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  // Behind a hosting proxy (Railway, Render…) set TRUST_PROXY=1 so req.secure, secure cookies
  // and rate-limit client IPs work. Locally we only trust loopback.
  app.set('trust proxy', process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) : 'loopback');
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:', 'https://tile.openstreetmap.org', 'https://*.tile.openstreetmap.org'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          connectSrc: ["'self'"],
          // demo may be served over plain HTTP on a LAN address
          upgradeInsecureRequests: null,
        },
      },
    }),
  );
  app.use(express.json({ limit: '1mb' }));

  const secret = process.env.SESSION_SECRET;
  const weak = !secret || PUBLISHED_SECRETS.includes(secret) || secret.length < 16;
  if (weak && process.env.NODE_ENV === 'production') throw new Error('SESSION_SECRET must be set to a private value of 16+ characters in production.');
  if (weak) console.warn('[api] SESSION_SECRET not set or weak — using an insecure demo default');
  app.use(
    session({
      name: SESSION_COOKIE,
      store: new SqliteSessionStore(),
      secret: secret || DEMO_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE === 'true', maxAge: 8 * 3600_000 },
    }),
  );

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRouter);
  app.use('/api/ai', requireAuth, aiRouter);
  app.use('/api/actions', requireAuth, actionsRouter);
  app.use('/api/ingest', requireAuth, requireRole('STATE_ADMIN'), ingestRouter);
  app.use('/api', requireAuth, analyticsRouter);
  app.use('/api', requireAuth, forecastRouter);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  // Serve the built web app if present (single-process demo mode: `npm run build && npm start`)
  const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../web/dist');
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get('*', (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}
