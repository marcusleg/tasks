import { describe, expect, it } from 'vitest';
import { InvalidInputError } from '#lib/domain/validation.js';
import {
	createCalendarLink,
	deleteCalendarLink,
	findCalendarLinkByToken,
	generateToken,
	getCalendarLink,
	getCalendarLinks,
	markAccessed,
	updateCalendarLink
} from './calendar-links';
import { calendarLinkLists } from './db/schema';
import { createList, deleteList } from './lists';
import type { UserScope } from './scope';
import { createTestDb, insertUser } from './testing/index';

function setUp() {
	const db = createTestDb();
	const alice: UserScope = { db, userId: insertUser(db, 'alice').id };
	const bob: UserScope = { db, userId: insertUser(db, 'bob').id };
	return { db, alice, bob };
}

describe('generateToken', () => {
	it('is 32 random bytes as base64url', () => {
		const token = generateToken();
		expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(generateToken()).not.toBe(token);
	});
});

describe('createCalendarLink', () => {
	it('covers All Lists by default and generates a unique token', () => {
		const { alice } = setUp();
		const a = createCalendarLink(alice, { name: ' Proton ' });
		const b = createCalendarLink(alice, { name: 'Other' });

		expect(a).toMatchObject({ name: 'Proton', allLists: true, listIds: [], lastAccessedAt: null });
		expect(a.token).not.toBe(b.token);
		expect(getCalendarLinks(alice).map((l) => l.name)).toEqual(['Proton', 'Other']);
	});

	it('requires a name', () => {
		const { alice } = setUp();
		expect(() => createCalendarLink(alice, { name: '  ' })).toThrow(InvalidInputError);
	});

	it('covers a chosen subset of Lists', () => {
		const { alice } = setUp();
		const a = createList(alice, { name: 'A' });
		createList(alice, { name: 'B' });
		const link = createCalendarLink(alice, { name: 'x', listIds: [a.id] });
		expect(link).toMatchObject({ allLists: false, listIds: [a.id] });
	});

	it('rejects empty subsets and Lists of other Users', () => {
		const { alice, bob } = setUp();
		const theirs = createList(bob, { name: 'Theirs' });
		expect(() => createCalendarLink(alice, { name: 'x', allLists: false, listIds: [] })).toThrow(
			InvalidInputError
		);
		expect(() => createCalendarLink(alice, { name: 'x', listIds: [theirs.id] })).toThrow(
			'Unknown List'
		);
		expect(getCalendarLinks(alice)).toEqual([]);
	});
});

describe('updateCalendarLink', () => {
	it('renames without touching the token or Lists', () => {
		const { alice } = setUp();
		const list = createList(alice, { name: 'A' });
		const link = createCalendarLink(alice, { name: 'Old', listIds: [list.id] });
		const updated = updateCalendarLink(alice, link.id, { name: 'New' });
		expect(updated).toMatchObject({ name: 'New', token: link.token, listIds: [list.id] });
	});

	it('switches between All Lists and a subset', () => {
		const { alice, db } = setUp();
		const a = createList(alice, { name: 'A' });
		const b = createList(alice, { name: 'B' });
		const link = createCalendarLink(alice, { name: 'x' });

		expect(updateCalendarLink(alice, link.id, { listIds: [b.id, a.id] })).toMatchObject({
			allLists: false,
			listIds: [a.id, b.id]
		});
		expect(updateCalendarLink(alice, link.id, { listIds: [a.id] })?.listIds).toEqual([a.id]);
		expect(updateCalendarLink(alice, link.id, { allLists: true })).toMatchObject({
			allLists: true,
			listIds: []
		});
		expect(db.select().from(calendarLinkLists).all()).toEqual([]);
		expect(() => updateCalendarLink(alice, link.id, { allLists: false })).toThrow(
			InvalidInputError
		);
	});

	it("rejects other Users' Lists", () => {
		const { alice, bob } = setUp();
		const theirs = createList(bob, { name: 'Theirs' });
		const link = createCalendarLink(alice, { name: 'x' });
		expect(() => updateCalendarLink(alice, link.id, { listIds: [theirs.id] })).toThrow(
			InvalidInputError
		);
		expect(getCalendarLink(alice, link.id)?.allLists).toBe(true);
	});

	it('forgets Lists that were deleted', () => {
		const { alice } = setUp();
		const a = createList(alice, { name: 'A' });
		const b = createList(alice, { name: 'B' });
		const link = createCalendarLink(alice, { name: 'x', listIds: [a.id, b.id] });
		deleteList(alice, a.id);
		expect(getCalendarLink(alice, link.id)?.listIds).toEqual([b.id]);
	});
});

describe('isolation between Users', () => {
	it("cannot read, change or delete another User's Calendar Link", () => {
		const { alice, bob } = setUp();
		const link = createCalendarLink(alice, { name: 'Mine' });

		expect(getCalendarLinks(bob)).toEqual([]);
		expect(getCalendarLink(bob, link.id)).toBeUndefined();
		expect(updateCalendarLink(bob, link.id, { name: 'Hacked' })).toBeUndefined();
		expect(deleteCalendarLink(bob, link.id)).toBe(false);
		expect(getCalendarLink(alice, link.id)?.name).toBe('Mine');
	});
});

describe('deleteCalendarLink and lookup by token', () => {
	it('finds a link by token, records access, and 404s once deleted', () => {
		const { alice, db } = setUp();
		const link = createCalendarLink(alice, { name: 'x' });

		expect(findCalendarLinkByToken(db, link.token)?.id).toBe(link.id);
		expect(findCalendarLinkByToken(db, 'nope')).toBeUndefined();
		expect(findCalendarLinkByToken(db, generateToken())).toBeUndefined();

		const at = new Date('2026-01-02T03:04:05Z');
		markAccessed(db, link.id, at);
		expect(getCalendarLink(alice, link.id)?.lastAccessedAt).toEqual(at);

		expect(deleteCalendarLink(alice, link.id)).toBe(true);
		expect(findCalendarLinkByToken(db, link.token)).toBeUndefined();
		expect(deleteCalendarLink(alice, link.id)).toBe(false);
	});
});
