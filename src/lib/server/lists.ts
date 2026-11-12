/**
 * Data access for Lists and per-User preferences. Every function takes a {@link UserScope} and
 * filters by its User (README → "Data access: always scope by User"), so another User's id
 * matches nothing.
 */
import { and, asc, desc, eq } from 'drizzle-orm';
import { generateKeyBetween } from 'fractional-indexing';
import {
	parseListName,
	positionForMove,
	type List,
	type ListMove,
	type SortMode
} from '#lib/domain/lists.js';
import { isId, InvalidInputError } from '#lib/domain/validation.js';
import { type Language } from '#lib/language.js';
import { m } from '#lib/paraglide/messages.js';
import { toList } from './db/mapping.js';
import { lists, userPreferences } from './db/schema.js';
import { ownedBy, type UserScope } from './scope.js';
import { forgetList } from './undo.js';

/** All of the User's Lists, in List order. */
export function getLists(scope: UserScope): List[] {
	return scope.db
		.select()
		.from(lists)
		.where(ownedBy(lists.userId, scope))
		.orderBy(asc(lists.position), asc(lists.id))
		.all()
		.map(toList);
}

/** One of the User's Lists, or `undefined` if it doesn't exist or belongs to someone else. */
export function getList(scope: UserScope, id: string): List | undefined {
	const row = scope.db
		.select()
		.from(lists)
		.where(and(eq(lists.id, id), ownedBy(lists.userId, scope)))
		.get();
	return row && toList(row);
}

function lastPosition(scope: UserScope): string | null {
	const row = scope.db
		.select({ position: lists.position })
		.from(lists)
		.where(ownedBy(lists.userId, scope))
		.orderBy(desc(lists.position))
		.limit(1)
		.get();
	return row?.position ?? null;
}

export interface NewList {
	/** Client-generated id (see `newId`), so an optimistic UI can use it right away. */
	id?: string;
	name: string;
}

/** Creates a List at the end of the User's List order. Throws `InvalidInputError`. */
export function createList(scope: UserScope, input: NewList): List {
	if (input.id !== undefined && !isId(input.id)) throw new InvalidInputError('Invalid id');
	const row = scope.db
		.insert(lists)
		.values({
			id: input.id,
			userId: scope.userId,
			name: parseListName(input.name),
			position: generateKeyBetween(lastPosition(scope), null)
		})
		.returning()
		.get();
	return toList(row);
}

export interface ListPatch {
	name?: string;
	sortMode?: SortMode;
	visible?: boolean;
	/** Moves the List next to another List (changes its position). */
	move?: ListMove;
}

/** Changes a List's fields; `undefined` if the List isn't the User's. Throws `InvalidInputError`. */
export function updateList(scope: UserScope, id: string, patch: ListPatch): List | undefined {
	const values: Partial<typeof lists.$inferInsert> = {};
	if (patch.name !== undefined) values.name = parseListName(patch.name);
	if (patch.sortMode !== undefined) values.sortMode = patch.sortMode;
	if (patch.visible !== undefined) values.visible = patch.visible;
	if (patch.move !== undefined) {
		if (!getList(scope, id)) return undefined;
		values.position = positionForMove(getLists(scope), id, patch.move);
	}
	if (Object.keys(values).length === 0) return getList(scope, id);

	const row = scope.db
		.update(lists)
		.set(values)
		.where(and(eq(lists.id, id), ownedBy(lists.userId, scope)))
		.returning()
		.get();
	return row && toList(row);
}

/** Deletes a List and, by cascade, all of its Tasks. Returns whether anything was deleted. */
export function deleteList(scope: UserScope, id: string): boolean {
	const deleted = scope.db
		.delete(lists)
		.where(and(eq(lists.id, id), ownedBy(lists.userId, scope)))
		.returning({ id: lists.id })
		.all();
	if (deleted.length === 0) return false;
	forgetList(scope, id);
	return true;
}

/**
 * First-time setup for a User: creates their preferences and their first List, named in `language`
 * (the request's Language). Idempotent: once the preferences row exists nothing happens, so a User
 * who deletes every List isn't given a new one. Returns whether the User was set up just now.
 */
export function ensureUserSetUp(scope: UserScope, language: Language): boolean {
	const existing = scope.db
		.select({ userId: userPreferences.userId })
		.from(userPreferences)
		.where(ownedBy(userPreferences.userId, scope))
		.get();
	if (existing) return false;

	return scope.db.transaction((tx) => {
		const inserted = tx
			.insert(userPreferences)
			.values({ userId: scope.userId })
			.onConflictDoNothing()
			.returning()
			.get();
		if (!inserted) return false;

		const hasList = tx
			.select({ id: lists.id })
			.from(lists)
			.where(ownedBy(lists.userId, scope))
			.limit(1)
			.get();
		if (!hasList) {
			tx.insert(lists)
				.values({
					userId: scope.userId,
					name: m.default_list_name({}, { locale: language }),
					position: generateKeyBetween(null, null)
				})
				.run();
		}
		return true;
	});
}
