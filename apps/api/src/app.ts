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
import { requireAuth } from './middleware/auth';
import { errorHandler } from './lib/http';
import { SqliteSessionStore } from './lib/sessionStore';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
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
  if (!secret) console.warn('[api] SESSION_SECRET not set — using an insecure demo default');
  app.use(
    session({
      name: 'sevalens.sid',
      store: new SqliteSessionStore(),
      secret: secret || 'sevalens-demo-secret-change-me',
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE === 'true', maxAge: 8 * 3600_000 },
    }),
  );

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRouter);
  app.use('/api/ai', requireAuth, aiRouter);
  app.use('/api/actions', requireAuth, actionsRouter);
  app.use('/api', requireAuth, analyticsRouter);
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
