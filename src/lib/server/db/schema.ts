import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * A person who signs in through the configured OIDC provider. Identified by
 * the provider's issuer and `sub` claim; `id` is our own random key so the
 * `sub` never leaks into URLs or other tables.
 */
export const users = sqliteTable(
	'users',
	{
		id: text('id')
			.primaryKey()
			.$defaultFn(() => crypto.randomUUID()),
		issuer: text('issuer').notNull(),
		subject: text('subject').notNull(),
		/** Display name from the latest login's claims. */
		name: text('name').notNull(),
		/** Email from the latest login's claims, if the provider sent one. */
		email: text('email'),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`),
		lastLoginAt: integer('last_login_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(table) => [uniqueIndex('users_issuer_subject_unique').on(table.issuer, table.subject)]
);

export type User = typeof users.$inferSelect;

/**
 * A signed-in browser. `id` is the SHA-256 hash (hex) of the session token in
 * the cookie; the token itself is never stored.
 */
export const sessions = sqliteTable(
	'sessions',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.default(sql`(unixepoch())`)
	},
	(table) => [
		index('sessions_user_id_idx').on(table.userId),
		index('sessions_expires_at_idx').on(table.expiresAt)
	]
);

export type Session = typeof sessions.$inferSelect;
