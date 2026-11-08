import { describe, expect, it } from 'vitest';
import { InvalidInputError } from '#lib/domain/validation.js';
import { userPreferences } from './db/schema.js';
import { setLanguagePreference } from './language-preference';
import { ensureUserSetUp } from './lists';
import type { UserScope } from './scope';
import { createTestDb, insertUser } from './testing/index.js';
import { createSession, validateSessionToken } from './auth/session';

/** What the next request of this User reads: the one read path, in the session lookup. */
function chosen(scope: UserScope) {
	return validateSessionToken(scope.db, createSession(scope.db, scope.userId).token)!
		.languagePreference;
}

function setup() {
	const db = createTestDb();
	const alice: UserScope = { db, userId: insertUser(db, 'alice').id };
	const bob: UserScope = { db, userId: insertUser(db, 'bob').id };
	return { db, alice, bob };
}

describe('the Language preference', () => {
	it('is Automatic for a User who never chose, with or without a settings row', () => {
		const { alice, bob } = setup();
		ensureUserSetUp(alice, 'en');

		expect(chosen(alice)).toBe('automatic');
		expect(chosen(bob)).toBe('automatic');
	});

	it('is stored per User', () => {
		const { alice, bob } = setup();

		expect(setLanguagePreference(alice, 'de', 'en')).toBe('de');

		expect(chosen(alice)).toBe('de');
		expect(chosen(bob)).toBe('automatic');

		setLanguagePreference(bob, 'en', 'en');
		setLanguagePreference(alice, 'automatic', 'en');
		expect(chosen(alice)).toBe('automatic');
		expect(chosen(bob)).toBe('en');
	});

	it('can be set before the User has been set up, without skipping their first List', () => {
		const { alice } = setup();
		setLanguagePreference(alice, 'de', 'en');

		expect(ensureUserSetUp(alice, 'en')).toBe(false);
		expect(chosen(alice)).toBe('de');
	});

	it('rejects anything but Automatic or a Language we speak', () => {
		const { alice } = setup();

		for (const value of ['fr', '', 'DE', undefined, 3]) {
			expect(() => setLanguagePreference(alice, value, 'en')).toThrow(InvalidInputError);
		}
		expect(chosen(alice)).toBe('automatic');
	});

	it('falls back to Automatic for a stored value we no longer speak', () => {
		const { db, alice } = setup();
		ensureUserSetUp(alice, 'en');
		db.update(userPreferences).set({ languagePreference: 'fr' }).run();

		expect(chosen(alice)).toBe('automatic');
	});

	it('comes along with the session lookup', () => {
		const { db, alice } = setup();
		const { token } = createSession(db, alice.userId);
		expect(validateSessionToken(db, token)?.languagePreference).toBe('automatic');

		setLanguagePreference(alice, 'de', 'en');
		expect(validateSessionToken(db, token)?.languagePreference).toBe('de');
	});
});
