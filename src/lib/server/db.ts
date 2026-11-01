import { dev } from '$app/env';
import { DATABASE_PATH } from '$app/env/private';
import { migrateDatabase, openDatabase, type Db } from './db/client';

export const databasePath = DATABASE_PATH ?? (dev ? './data/tasks.db' : '/data/tasks.db');

let instance: Db | undefined;

/** The app's database, opened on first use so that `vite build` never touches it. */
export function getDb(): Db {
	instance ??= openDatabase(databasePath);
	return instance;
}

/** Opens the database and applies pending migrations. Runs once, from the server `init` hook. */
export function initDb(): void {
	migrateDatabase(getDb());
	console.log(`Database ready at ${databasePath}`);
}
