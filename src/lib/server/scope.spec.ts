import { isHttpError } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { createSession } from './auth/session';
import { sessions } from './db/schema';
import { ownedBy, requireUser, userScope } from './scope';
import { createTestDb, insertUser } from './testing/index';

describe('requireUser', () => {
	it('rejects anonymous access with a 401', () => {
		const locals: App.Locals = { user: null, session: null };

		let thrown: unknown;
		try {
			requireUser(locals);
		} catch (error) {
			thrown = error;
		}

		expect(isHttpError(thrown, 401)).toBe(true);
	});

	it('returns the signed-in User', () => {
		const db = createTestDb();
		const user = insertUser(db, 'alice');

		expect(requireUser({ user, session: null })).toBe(user);
	});
});

describe('user scoping', () => {
	it('only ever returns rows owned by the scoped User', () => {
		const db = createTestDb();
		const alice = insertUser(db, 'alice');
		const bob = insertUser(db, 'bob');
		createSession(db, alice.id);
		createSession(db, alice.id);
		createSession(db, bob.id);

		const scope = userScope({ user: bob, session: null }, db);
		const rows = db.select().from(sessions).where(ownedBy(sessions.userId, scope)).all();

		expect(rows).toHaveLength(1);
		expect(rows.every((row) => row.userId === bob.id)).toBe(true);
	});

	it('cannot be built without a signed-in User', () => {
		const db = createTestDb();

		expect(() => userScope({ user: null, session: null }, db)).toThrow();
	});
});
