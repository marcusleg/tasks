import { error } from '@sveltejs/kit';
import { eq, type SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import { getDb } from './db.js';
import type { Db } from './db/client.js';
import type { User } from './db/schema.js';

/**
 * The signed-in User, or a 401. The `handle` hook already keeps anonymous
 * requests away from protected routes; this makes every load function and
 * action state that it needs a User, and narrows the type.
 */
export function requireUser(locals: Pick<App.Locals, 'user' | 'session'>): User {
	if (!locals.user) error(401, 'Not signed in');
	return locals.user;
}

/**
 * Everything a data-access function needs to read or write one User's data.
 * Nothing is shared between Users, so every query against a User-owned table
 * must be filtered by `userId`; taking a `UserScope` (rather than a bare `Db`)
 * makes that impossible to forget at the call site.
 */
export interface UserScope {
	readonly userId: string;
	readonly db: Db;
}

/** Builds the scope for the signed-in User. Throws a 401 if nobody is signed in. */
export function userScope(
	locals: Pick<App.Locals, 'user' | 'session'>,
	db: Db = getDb()
): UserScope {
	return { userId: requireUser(locals).id, db };
}

/** The `where` condition restricting a User-owned table to the scope's User. */
export function ownedBy(userIdColumn: SQLiteColumn, scope: UserScope): SQL {
	return eq(userIdColumn, scope.userId);
}
