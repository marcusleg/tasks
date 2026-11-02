import type { Cookies } from '@sveltejs/kit';
import { migrateDatabase, openDatabase, type Db } from '#lib/server/db/client.js';
import { users, type User } from '#lib/server/db/schema.js';

/** A fresh, fully migrated in-memory database. */
export function createTestDb(): Db {
	const db = openDatabase(':memory:');
	migrateDatabase(db);
	return db;
}

/** Inserts a User directly, bypassing the login flow. */
export function insertUser(db: Db, subject: string, name = subject): User {
	return db
		.insert(users)
		.values({ issuer: 'https://id.example.com', subject, name, email: `${subject}@example.com` })
		.returning()
		.get();
}

/** An in-memory stand-in for SvelteKit's `cookies`, recording what was set. */
export function fakeCookies(initial: Record<string, string> = {}) {
	const jar = new Map(Object.entries(initial));
	const set: Array<{ name: string; value: string; options: object }> = [];
	const deleted: string[] = [];

	const cookies = {
		get: (name: string) => jar.get(name),
		getAll: () => [...jar].map(([name, value]) => ({ name, value })),
		set: (name: string, value: string, options: object) => {
			jar.set(name, value);
			set.push({ name, value, options });
		},
		delete: (name: string) => {
			jar.delete(name);
			deleted.push(name);
		},
		serialize: () => ''
	} as unknown as Cookies;

	return { cookies, set, deleted };
}
