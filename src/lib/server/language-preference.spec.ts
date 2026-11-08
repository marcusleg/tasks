import { describe, expect, it } from 'vitest';
import { InvalidInputError } from '#lib/domain/validation.js';
import { userPreferences } from './db/schema.js';
import { getLanguagePreference, setLanguagePreference } from './language-preference';
import { ensureUserSetUp } from './lists';
import type { UserScope } from './scope';
import { createTestDb, insertUser } from './testing/index.js';
import { createSession, validateSessionToken } from './auth/session';

function setup() {
	const db = createTestDb();
	const alice: UserScope = { db, userId: insertUser(db, 'alice').id };
	const bob: UserScope = { db, userId: insertUser(db, 'bob').id };
	return { db, alice, bob };
}

describe('the Language preference', () => {
	it('is Automatic for a User who never chose, with or without a settings row', () => {
		const { alice, bob } = setup();
		ensureUserSetUp(alice);

		expect(getLanguagePreference(alice)).toBe('automatic');
		expect(getLanguagePreference(bob)).toBe('automatic');
	});

	it('is stored per User', () => {
		const { alice, bob } = setup();

		expect(setLanguagePreference(alice, 'de')).toBe('de');

		expect(getLanguagePreference(alice)).toBe('de');
		expect(getLanguagePreference(bob)).toBe('automatic');

		setLanguagePreference(bob, 'en');
		setLanguagePreference(alice, 'automatic');
		expect(getLanguagePreference(alice)).toBe('automatic');
		expect(getLanguagePreference(bob)).toBe('en');
	});

	it('can be set before the User has been set up, without skipping their first List', () => {
		const { alice } = setup();
		setLanguagePreference(alice, 'de');

		expect(ensureUserSetUp(alice)).toBe(false);
		expect(getLanguagePreference(alice)).toBe('de');
	});

	it('rejects anything but Automatic or a Language we speak', () => {
		const { alice } = setup();

		for (const value of ['fr', '', 'DE', undefined, 3]) {
			expect(() => setLanguagePreference(alice, value)).toThrow(InvalidInputError);
		}
		expect(getLanguagePreference(alice)).toBe('automatic');
	});

	it('falls back to Automatic for a stored value we no longer speak', () => {
		const { db, alice } = setup();
		ensureUserSetUp(alice);
		db.update(userPreferences).set({ languagePreference: 'fr' }).run();

		expect(getLanguagePreference(alice)).toBe('automatic');
	});

	it('comes along with the session lookup', () => {
		const { db, alice } = setup();
		const { token } = createSession(db, alice.userId);
		expect(validateSessionToken(db, token)?.languagePreference).toBe('automatic');

		setLanguagePreference(alice, 'de');
		expect(validateSessionToken(db, token)?.languagePreference).toBe('de');
	});
});
