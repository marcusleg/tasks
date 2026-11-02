import { describe, expect, it } from 'vitest';
import { users } from '#lib/server/db/schema.js';
import { createTestDb } from '#lib/server/testing/index.js';
import { upsertUser } from './users';

const identity = {
	issuer: 'https://id.example.com',
	subject: 'sub-1',
	name: 'Alice',
	email: 'alice@example.com'
};

describe('upsertUser', () => {
	it('creates a User with a random id on first login', () => {
		const db = createTestDb();

		const user = upsertUser(db, identity);

		expect(user.id).toMatch(/^[0-9a-f-]{36}$/);
		expect(user.id).not.toBe(identity.subject);
		expect(user).toMatchObject(identity);
	});

	it('finds the same User again and refreshes name, email and last login', () => {
		const db = createTestDb();
		const first = upsertUser(db, identity, new Date('2026-01-01T00:00:00Z'));

		const second = upsertUser(
			db,
			{ ...identity, name: 'Alice B.', email: null },
			new Date('2026-02-01T00:00:00Z')
		);

		expect(second.id).toBe(first.id);
		expect(second.name).toBe('Alice B.');
		expect(second.email).toBeNull();
		expect(second.createdAt).toEqual(first.createdAt);
		expect(second.lastLoginAt).toEqual(new Date('2026-02-01T00:00:00Z'));
		expect(db.select().from(users).all()).toHaveLength(1);
	});

	it('keeps the same subject from different issuers apart', () => {
		const db = createTestDb();

		const a = upsertUser(db, identity);
		const b = upsertUser(db, { ...identity, issuer: 'https://other.example.com' });

		expect(a.id).not.toBe(b.id);
	});
});
