import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { db, migrationsFolder, dbPath } from './client';

migrate(db, { migrationsFolder });
console.log(`[db] migrations applied -> ${dbPath}`);
