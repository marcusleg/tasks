import { describe, expect, it } from 'vitest';
import { migrateDatabase, openDatabase } from './client';
import { users } from './schema';

describe('database migrations', () => {
	it('creates the schema in a fresh database', () => {
		const db = openDatabase(':memory:');

		migrateDatabase(db);
		const [user] = db.insert(users).values({}).returning().all();

		expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
		expect(user.createdAt).toBeInstanceOf(Date);
	});

	it('can run again without re-applying anything', () => {
		const db = openDatabase(':memory:');

		migrateDatabase(db);

		expect(() => migrateDatabase(db)).not.toThrow();
	});
});
