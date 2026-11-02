import { createHash, randomBytes } from 'node:crypto';
import { eq, lte } from 'drizzle-orm';
import type { Db } from '#lib/server/db/client.js';
import { sessions, users, type Session, type User } from '#lib/server/db/schema.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long a session lasts after it was created or last extended. */
export const SESSION_TTL_MS = 30 * DAY_MS;

/**
 * A session is only extended once less than this much of its lifetime is left,
 * so an active User causes at most one write every ~15 days instead of one per request.
 */
export const SESSION_REFRESH_THRESHOLD_MS = 15 * DAY_MS;

/** 32 random bytes, base64url-encoded without padding. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** A new random 256-bit session token for the cookie. */
export function generateSessionToken(): string {
	return randomBytes(32).toString('base64url');
}

/** The session id stored in the database for `token`: its SHA-256 hash, hex-encoded. */
export function hashSessionToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

/** Starts a session for `userId`. The returned token goes into the cookie and is never stored. */
export function createSession(
	db: Db,
	userId: string,
	now = new Date()
): { token: string; session: Session } {
	const token = generateSessionToken();
	const session = db
		.insert(sessions)
		.values({
			id: hashSessionToken(token),
			userId,
			createdAt: now,
			expiresAt: new Date(now.getTime() + SESSION_TTL_MS)
		})
		.returning()
		.get();

	// Logins are rare enough to piggyback the cleanup on.
	deleteExpiredSessions(db, now);

	return { token, session };
}

export interface ValidatedSession {
	session: Session;
	user: User;
	/** True when the expiry was pushed forward, so the cookie must be re-sent. */
	extended: boolean;
}

/**
 * Resolves a session token from a cookie to its session and User. Returns
 * `null` for malformed, unknown or expired tokens (deleting the expired session).
 *
 * The lookup is by the token's SHA-256 hash, so timing differences in the index
 * lookup reveal nothing useful about valid tokens.
 */
export function validateSessionToken(
	db: Db,
	token: string,
	now = new Date()
): ValidatedSession | null {
	if (!TOKEN_PATTERN.test(token)) return null;

	const id = hashSessionToken(token);
	const row = db
		.select({ session: sessions, user: users })
		.from(sessions)
		.innerJoin(users, eq(users.id, sessions.userId))
		.where(eq(sessions.id, id))
		.get();

	if (!row) return null;

	const { session, user } = row;
	const remaining = session.expiresAt.getTime() - now.getTime();

	if (remaining <= 0) {
		invalidateSession(db, session.id);
		return null;
	}

	if (remaining < SESSION_REFRESH_THRESHOLD_MS) {
		session.expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
		db.update(sessions)
			.set({ expiresAt: session.expiresAt })
			.where(eq(sessions.id, session.id))
			.run();
		return { session, user, extended: true };
	}

	return { session, user, extended: false };
}

/** Ends one session (logout). Other sessions of the same User are untouched. */
export function invalidateSession(db: Db, sessionId: string): void {
	db.delete(sessions).where(eq(sessions.id, sessionId)).run();
}

/** Removes every session that has expired by `now`. */
export function deleteExpiredSessions(db: Db, now = new Date()): void {
	db.delete(sessions).where(lte(sessions.expiresAt, now)).run();
}
