import { describe, expect, it } from 'vitest';
import { sessions } from '#lib/server/db/schema.js';
import { createTestDb, insertUser } from '#lib/server/testing/index.js';
import {
	SESSION_REFRESH_THRESHOLD_MS,
	SESSION_TTL_MS,
	createSession,
	deleteExpiredSessions,
	hashSessionToken,
	invalidateSession,
	validateSessionToken
} from './session';

const DAY = 24 * 60 * 60 * 1000;
const at = (ms: number) => new Date(Date.UTC(2026, 0, 1) + ms);

describe('sessions', () => {
	it('resolves a token to the session and the User it belongs to', () => {
		const db = createTestDb();
		const alice = insertUser(db, 'alice');
		const bob = insertUser(db, 'bob');
		const forAlice = createSession(db, alice.id);
		const forBob = createSession(db, bob.id);

		expect(validateSessionToken(db, forAlice.token)?.user.id).toBe(alice.id);
		expect(validateSessionToken(db, forBob.token)?.user.id).toBe(bob.id);
	});

	it('stores only the SHA-256 hash of the 256-bit token', () => {
		const db = createTestDb();
		const user = insertUser(db, 'alice');
		const { token, session } = createSession(db, user.id);

		expect(Buffer.from(token, 'base64url')).toHaveLength(32);
		expect(session.id).toBe(hashSessionToken(token));
		expect(session.id).toMatch(/^[0-9a-f]{64}$/);
		expect(
			db
				.select()
				.from(sessions)
				.all()
				.map((s) => s.id)
		).not.toContain(token);
	});

	it('rejects unknown and malformed tokens', () => {
		const db = createTestDb();
		const user = insertUser(db, 'alice');
		const { session } = createSession(db, user.id);

		expect(validateSessionToken(db, 'A'.repeat(43))).toBeNull();
		expect(validateSessionToken(db, '')).toBeNull();
		// Knowing the stored hash doesn't help: it isn't a valid token.
		expect(validateSessionToken(db, session.id)).toBeNull();
	});

	it('lasts 30 days', () => {
		const db = createTestDb();
		const user = insertUser(db, 'alice');
		const { token, session } = createSession(db, user.id, at(0));

		expect(session.expiresAt.getTime()).toBe(at(SESSION_TTL_MS).getTime());
		expect(validateSessionToken(db, token, at(30 * DAY - 1000))).not.toBeNull();
	});

	it('expires after 30 days without use, and is deleted then', () => {
		const db = createTestDb();
		const user = insertUser(db, 'alice');
		const { token } = createSession(db, user.id, at(0));

		expect(validateSessionToken(db, token, at(30 * DAY))).toBeNull();
		expect(db.select().from(sessions).all()).toHaveLength(0);
	});

	it('is not extended while more than 15 days remain', () => {
		const db = createTestDb();
		const user = insertUser(db, 'alice');
		const { token, session } = createSession(db, user.id, at(0));

		const result = validateSessionToken(
			db,
			token,
			at(SESSION_TTL_MS - SESSION_REFRESH_THRESHOLD_MS)
		);

		expect(result?.extended).toBe(false);
		expect(result?.session.expiresAt).toEqual(session.expiresAt);
	});

	it('slides forward to 30 days from now once less than 15 days remain', () => {
		const db = createTestDb();
		const user = insertUser(db, 'alice');
		const { token } = createSession(db, user.id, at(0));
		const now = at(20 * DAY);

		const result = validateSessionToken(db, token, now);

		expect(result?.extended).toBe(true);
		expect(result?.session.expiresAt.getTime()).toBe(now.getTime() + SESSION_TTL_MS);
		// Persisted: still valid long after the original expiry.
		expect(validateSessionToken(db, token, at(45 * DAY))).not.toBeNull();
	});

	it('ends only the session that logs out', () => {
		const db = createTestDb();
		const user = insertUser(db, 'alice');
		const laptop = createSession(db, user.id);
		const phone = createSession(db, user.id);

		invalidateSession(db, laptop.session.id);

		expect(validateSessionToken(db, laptop.token)).toBeNull();
		expect(validateSessionToken(db, phone.token)).not.toBeNull();
	});

	it('deletes expired sessions in bulk, including when someone logs in', () => {
		const db = createTestDb();
		const user = insertUser(db, 'alice');
		createSession(db, user.id, at(0));
		createSession(db, user.id, at(10 * DAY));

		deleteExpiredSessions(db, at(35 * DAY));
		expect(db.select().from(sessions).all()).toHaveLength(1);

		createSession(db, user.id, at(41 * DAY));
		expect(db.select().from(sessions).all()).toHaveLength(1);
	});
});
