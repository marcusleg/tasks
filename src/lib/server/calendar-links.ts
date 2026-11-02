/**
 * Data access for Calendar Links. The management functions take a {@link UserScope} and filter by
 * its User (README → "Data access: always scope by User"). Only {@link findCalendarLinkByToken}
 * and {@link markAccessed} are unscoped: the `.ics` endpoint is public and the token is the secret.
 */
import { randomBytes } from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { parseCalendarLinkName, type SerializedCalendarLink } from '#lib/domain/calendar-links.js';
import { InvalidInputError } from '#lib/domain/validation.js';
import type { Db } from './db/client.js';
import { calendarLinkLists, calendarLinks, lists, type CalendarLinkRow } from './db/schema.js';
import { ownedBy, type UserScope } from './scope.js';

export interface CalendarLink {
	id: string;
	userId: string;
	name: string;
	token: string;
	allLists: boolean;
	/** The covered Lists when `allLists` is false; empty otherwise. */
	listIds: string[];
	createdAt: Date;
	lastAccessedAt: Date | null;
}

/** 32 random bytes (256 bits) as base64url: 43 URL-safe characters. */
export function generateToken(): string {
	return randomBytes(32).toString('base64url');
}

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function calendarLinkUrl(origin: string, token: string): string {
	return `${origin}/cal/${token}.ics`;
}

export function serializeCalendarLink(link: CalendarLink, origin: string): SerializedCalendarLink {
	return {
		id: link.id,
		name: link.name,
		allLists: link.allLists,
		listIds: link.listIds,
		url: calendarLinkUrl(origin, link.token),
		createdAt: link.createdAt.toISOString(),
		lastAccessedAt: link.lastAccessedAt?.toISOString() ?? null
	};
}

function withListIds(db: Db, rows: CalendarLinkRow[]): CalendarLink[] {
	const ids = rows.map((row) => row.id);
	const covered =
		ids.length === 0
			? []
			: db
					.select({ linkId: calendarLinkLists.calendarLinkId, listId: calendarLinkLists.listId })
					.from(calendarLinkLists)
					.innerJoin(lists, eq(lists.id, calendarLinkLists.listId))
					.where(inArray(calendarLinkLists.calendarLinkId, ids))
					.orderBy(asc(lists.position), asc(lists.id))
					.all();
	return rows.map((row) => ({
		...row,
		listIds: covered.filter((c) => c.linkId === row.id).map((c) => c.listId)
	}));
}

/** The User's Calendar Links, oldest first. */
export function getCalendarLinks(scope: UserScope): CalendarLink[] {
	const rows = scope.db
		.select()
		.from(calendarLinks)
		.where(ownedBy(calendarLinks.userId, scope))
		.orderBy(asc(calendarLinks.createdAt), asc(calendarLinks.id))
		.all();
	return withListIds(scope.db, rows);
}

/** One of the User's Calendar Links, or `undefined`. */
export function getCalendarLink(scope: UserScope, id: string): CalendarLink | undefined {
	const row = scope.db
		.select()
		.from(calendarLinks)
		.where(and(eq(calendarLinks.id, id), ownedBy(calendarLinks.userId, scope)))
		.get();
	return row && withListIds(scope.db, [row])[0];
}

/** Checks that `listIds` are distinct-able, non-empty and all the User's Lists. */
function parseListIds(scope: UserScope, value: unknown): string[] {
	if (!Array.isArray(value) || value.some((id) => typeof id !== 'string')) {
		throw new InvalidInputError('listIds must be a list of ids');
	}
	const ids = [...new Set(value as string[])];
	if (ids.length === 0) throw new InvalidInputError('Choose at least one List');
	const owned = scope.db
		.select({ id: lists.id })
		.from(lists)
		.where(and(ownedBy(lists.userId, scope), inArray(lists.id, ids)))
		.all();
	if (owned.length !== ids.length) throw new InvalidInputError('Unknown List');
	return ids;
}

export interface NewCalendarLink {
	name: string;
	/** Defaults to true unless `listIds` is given. */
	allLists?: boolean;
	listIds?: string[];
}

/** Creates a Calendar Link with a fresh token. Throws `InvalidInputError`. */
export function createCalendarLink(scope: UserScope, input: NewCalendarLink): CalendarLink {
	const name = parseCalendarLinkName(input.name);
	const allLists = input.allLists ?? input.listIds === undefined;
	const listIds = allLists ? [] : parseListIds(scope, input.listIds);

	const id = scope.db.transaction((tx) => {
		const row = tx
			.insert(calendarLinks)
			.values({ userId: scope.userId, name, token: generateToken(), allLists })
			.returning({ id: calendarLinks.id })
			.get();
		if (listIds.length > 0) {
			tx.insert(calendarLinkLists)
				.values(listIds.map((listId) => ({ calendarLinkId: row.id, listId })))
				.run();
		}
		return row.id;
	});
	return getCalendarLink(scope, id)!;
}

export interface CalendarLinkPatch {
	name?: string;
	allLists?: boolean;
	listIds?: string[];
}

/**
 * Renames a Calendar Link and/or changes the Lists it covers; `undefined` if it isn't the User's.
 * Throws `InvalidInputError`. The token never changes.
 */
export function updateCalendarLink(
	scope: UserScope,
	id: string,
	patch: CalendarLinkPatch
): CalendarLink | undefined {
	const current = getCalendarLink(scope, id);
	if (!current) return undefined;

	const name = patch.name === undefined ? current.name : parseCalendarLinkName(patch.name);
	const allLists = patch.allLists ?? (patch.listIds !== undefined ? false : current.allLists);
	const listIds = allLists ? [] : parseListIds(scope, patch.listIds ?? current.listIds);

	scope.db.transaction((tx) => {
		tx.update(calendarLinks)
			.set({ name, allLists })
			.where(and(eq(calendarLinks.id, id), ownedBy(calendarLinks.userId, scope)))
			.run();
		tx.delete(calendarLinkLists).where(eq(calendarLinkLists.calendarLinkId, id)).run();
		if (listIds.length > 0) {
			tx.insert(calendarLinkLists)
				.values(listIds.map((listId) => ({ calendarLinkId: id, listId })))
				.run();
		}
	});
	return getCalendarLink(scope, id);
}

/** Deletes (revokes) a Calendar Link. Returns whether anything was deleted. */
export function deleteCalendarLink(scope: UserScope, id: string): boolean {
	return (
		scope.db
			.delete(calendarLinks)
			.where(and(eq(calendarLinks.id, id), ownedBy(calendarLinks.userId, scope)))
			.returning({ id: calendarLinks.id })
			.all().length > 0
	);
}

/**
 * The Calendar Link with this token, for the public `.ics` endpoint. The token is high-entropy
 * (256 bits) and looked up by its unique index, so a timing side channel reveals nothing useful.
 */
export function findCalendarLinkByToken(db: Db, token: string): CalendarLink | undefined {
	if (!TOKEN_PATTERN.test(token)) return undefined;
	const row = db.select().from(calendarLinks).where(eq(calendarLinks.token, token)).get();
	return row && withListIds(db, [row])[0];
}

export function markAccessed(db: Db, id: string, now = new Date()): void {
	db.update(calendarLinks).set({ lastAccessedAt: now }).where(eq(calendarLinks.id, id)).run();
}
