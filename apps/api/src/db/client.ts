import 'dotenv/config';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as schema from './schema';

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const dbPath = path.resolve(apiRoot, process.env.DATABASE_PATH ?? 'data/sevalens.db');
export const migrationsFolder = path.resolve(apiRoot, 'drizzle');

fs.mkdirSync(path.dirname(dbPath), { recursive: true });

export const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });
export { schema };
