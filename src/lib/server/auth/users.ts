import { users, type User } from '#lib/server/db/schema.js';
import type { Db } from '#lib/server/db/client.js';
import type { OidcIdentity } from './oidc.js';

/**
 * Finds the User for this issuer + subject, creating them on their first
 * login. Name and email are refreshed from the claims on every login.
 */
export function upsertUser(
	db: Db,
	identity: Pick<OidcIdentity, 'issuer' | 'subject' | 'name' | 'email'>,
	now = new Date()
): User {
	return db
		.insert(users)
		.values({
			issuer: identity.issuer,
			subject: identity.subject,
			name: identity.name,
			email: identity.email,
			createdAt: now,
			lastLoginAt: now
		})
		.onConflictDoUpdate({
			target: [users.issuer, users.subject],
			set: { name: identity.name, email: identity.email, lastLoginAt: now }
		})
		.returning()
		.get();
}
