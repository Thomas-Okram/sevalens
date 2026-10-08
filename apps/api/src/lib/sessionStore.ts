import session from 'express-session';
import { sqlite } from '../db/client';

/**
 * Minimal SQLite-backed session store so sessions survive API restarts
 * (MemoryStore loses them and is not meant for production).
 */
export class SqliteSessionStore extends session.Store {
  private get_ = sqlite.prepare('SELECT data, expires FROM sessions WHERE sid = ?');
  private set_ = sqlite.prepare('INSERT INTO sessions (sid, data, expires) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET data = excluded.data, expires = excluded.expires');
  private del_ = sqlite.prepare('DELETE FROM sessions WHERE sid = ?');
  private touch_ = sqlite.prepare('UPDATE sessions SET expires = ? WHERE sid = ?');

  constructor() {
    super();
    sqlite.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
  }

  private expiry(s: session.SessionData) {
    return s.cookie?.expires ? new Date(s.cookie.expires).getTime() : Date.now() + 8 * 3600_000;
  }

  get(sid: string, cb: (err: unknown, s?: session.SessionData | null) => void) {
    try {
      const row = this.get_.get(sid) as { data: string; expires: number } | undefined;
      if (!row || row.expires < Date.now()) return cb(null, null);
      cb(null, JSON.parse(row.data));
    } catch (e) {
      cb(e);
    }
  }

  set(sid: string, s: session.SessionData, cb?: (err?: unknown) => void) {
    try {
      this.set_.run(sid, JSON.stringify(s), this.expiry(s));
      cb?.();
    } catch (e) {
      cb?.(e);
    }
  }

  destroy(sid: string, cb?: (err?: unknown) => void) {
    try {
      this.del_.run(sid);
      cb?.();
    } catch (e) {
      cb?.(e);
    }
  }

  touch(sid: string, s: session.SessionData, cb?: () => void) {
    try {
      this.touch_.run(this.expiry(s), sid);
    } finally {
      cb?.();
    }
  }
}
