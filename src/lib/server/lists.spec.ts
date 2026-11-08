import { describe, expect, it } from 'vitest';
import { InvalidInputError } from '#lib/domain/validation.js';
import { lists, tasks } from './db/schema';
import {
	createList,
	deleteList,
	ensureUserSetUp,
	getList,
	getLists,
	getStartList,
	updateList
} from './lists';
import type { UserScope } from './scope';
import { createTask } from './tasks';
import { createTestDb, insertUser } from './testing/index';

function setUp() {
	const db = createTestDb();
	const alice: UserScope = { db, userId: insertUser(db, 'alice').id };
	const bob: UserScope = { db, userId: insertUser(db, 'bob').id };
	return { db, alice, bob };
}

describe('ensureUserSetUp', () => {
	it('names the first List "My Tasks" for English', () => {
		const { alice } = setUp();

		expect(ensureUserSetUp(alice, 'en')).toBe(true);

		expect(getLists(alice).map((list) => list.name)).toEqual(['My Tasks']);
	});

	it('names the first List "Meine Aufgaben" for German', () => {
		const { alice } = setUp();

		expect(ensureUserSetUp(alice, 'de')).toBe(true);

		expect(getLists(alice).map((list) => list.name)).toEqual(['Meine Aufgaben']);
	});

	it('is idempotent, and keeps the name when the Language changes later', () => {
		const { alice } = setUp();

		ensureUserSetUp(alice, 'en');
		expect(ensureUserSetUp(alice, 'en')).toBe(false);
		expect(ensureUserSetUp(alice, 'de')).toBe(false);

		expect(getLists(alice).map((list) => list.name)).toEqual(['My Tasks']);
	});

	it('does not bring the first List back after the User deleted every List', () => {
		const { alice } = setUp();
		ensureUserSetUp(alice, 'de');

		deleteList(alice, getLists(alice)[0].id);
		ensureUserSetUp(alice, 'de');

		expect(getLists(alice)).toEqual([]);
	});

	it('sets up each User separately', () => {
		const { alice, bob } = setUp();

		ensureUserSetUp(alice, 'en');
		ensureUserSetUp(bob, 'de');

		expect(getLists(alice)).toHaveLength(1);
		expect(getLists(bob)).toHaveLength(1);
		expect(getLists(alice)[0].id).not.toBe(getLists(bob)[0].id);
	});
});

describe('createList', () => {
	it('appends new Lists at the end of the List order', () => {
		const { alice } = setUp();

		createList(alice, { name: 'Groceries' });
		createList(alice, { name: 'Work' });
		createList(alice, { name: 'Books' });

		expect(getLists(alice).map((list) => list.name)).toEqual(['Groceries', 'Work', 'Books']);
	});

	it('trims the name, defaults to Custom Order and visible', () => {
		const { alice } = setUp();

		const list = createList(alice, { name: '  Groceries  ' });

		expect(list).toMatchObject({ name: 'Groceries', sortMode: 'custom', visible: true });
	});

	it('requires a name', () => {
		const { alice } = setUp();

		expect(() => createList(alice, { name: '   ' })).toThrow(InvalidInputError);
		expect(() => createList(alice, { name: 'x'.repeat(101) })).toThrow(InvalidInputError);
	});

	it('uses a client-generated id', () => {
		const { alice } = setUp();
		const id = crypto.randomUUID();

		expect(createList(alice, { id, name: 'Work' }).id).toBe(id);
		expect(() => createList(alice, { id: 'not-a-uuid', name: 'Work' })).toThrow(InvalidInputError);
	});
});

describe('updateList', () => {
	it('renames a List', () => {
		const { alice } = setUp();
		const list = createList(alice, { name: 'Groceries' });

		const renamed = updateList(alice, list.id, { name: 'Shopping' });

		expect(renamed?.name).toBe('Shopping');
		expect(getList(alice, list.id)?.name).toBe('Shopping');
	});

	it('changes Sort Mode and visibility', () => {
		const { alice } = setUp();
		const list = createList(alice, { name: 'Groceries' });

		expect(updateList(alice, list.id, { sortMode: 'due', visible: false })).toMatchObject({
			sortMode: 'due',
			visible: false
		});
	});

	it("can't touch another User's List", () => {
		const { alice, bob } = setUp();
		const list = createList(alice, { name: 'Groceries' });

		expect(updateList(bob, list.id, { name: 'Mine now' })).toBeUndefined();
		expect(getList(alice, list.id)?.name).toBe('Groceries');
	});
});

describe('deleteList', () => {
	it('deletes the List and all of its Tasks, nothing else', () => {
		const { db, alice } = setUp();
		const groceries = createList(alice, { name: 'Groceries' });
		const work = createList(alice, { name: 'Work' });
		createTask(alice, { listId: groceries.id, title: 'Milk' });
		createTask(alice, { listId: work.id, title: 'Report' });

		expect(deleteList(alice, groceries.id)).toBe(true);

		expect(getLists(alice).map((list) => list.name)).toEqual(['Work']);
		expect(
			db
				.select()
				.from(tasks)
				.all()
				.map((task) => task.title)
		).toEqual(['Report']);
	});

	it("can't delete another User's List", () => {
		const { db, alice, bob } = setUp();
		const list = createList(alice, { name: 'Groceries' });

		expect(deleteList(bob, list.id)).toBe(false);
		expect(db.select().from(lists).all()).toHaveLength(1);
	});
});

describe('cross-User isolation', () => {
	it('never shows one User the Lists of another', () => {
		const { alice, bob } = setUp();
		const list = createList(alice, { name: 'Secret' });
		createList(bob, { name: 'Bob stuff' });

		expect(getLists(bob).map((l) => l.name)).toEqual(['Bob stuff']);
		expect(getList(bob, list.id)).toBeUndefined();
	});
});

describe('getStartList', () => {
	it('is the first List until another one was viewed', () => {
		const { alice } = setUp();
		const first = createList(alice, { name: 'First' });
		const second = createList(alice, { name: 'Second' });

		expect(getStartList(alice, undefined)?.id).toBe(first.id);
		expect(getStartList(alice, second.id)?.id).toBe(second.id);
	});

	it('falls back to the first List when the last-viewed one is deleted', () => {
		const { alice } = setUp();
		const first = createList(alice, { name: 'First' });
		const second = createList(alice, { name: 'Second' });

		deleteList(alice, second.id);

		expect(getStartList(alice, second.id)?.id).toBe(first.id);
	});

	it("ignores another User's List as last viewed", () => {
		const { alice, bob } = setUp();
		const mine = createList(bob, { name: 'Mine' });
		const theirs = createList(alice, { name: 'Theirs' });

		expect(getStartList(bob, theirs.id)?.id).toBe(mine.id);
	});

	it('is undefined without Lists', () => {
		const { alice } = setUp();

		expect(getStartList(alice, undefined)).toBeUndefined();
	});
});

describe('updateList move', () => {
	it('reorders Lists and leaves the others alone', () => {
		const { alice } = setUp();
		const a = createList(alice, { name: 'A' });
		const b = createList(alice, { name: 'B' });
		const c = createList(alice, { name: 'C' });

		const moved = updateList(alice, c.id, { move: { before: a.id } });

		expect(moved?.position).not.toBe(c.position);
		expect(getLists(alice).map((l) => l.name)).toEqual(['C', 'A', 'B']);
		expect(getList(alice, b.id)?.position).toBe(b.position);

		updateList(alice, c.id, { move: { after: b.id } });
		expect(getLists(alice).map((l) => l.name)).toEqual(['A', 'B', 'C']);
	});

	it("rejects another User's List as a target and can't move their List", () => {
		const { alice, bob } = setUp();
		const mine = createList(alice, { name: 'Mine' });
		const other = createList(alice, { name: 'Other' });
		const theirs = createList(bob, { name: 'Theirs' });

		expect(() => updateList(alice, mine.id, { move: { after: theirs.id } })).toThrow(
			InvalidInputError
		);
		expect(updateList(bob, mine.id, { move: { after: theirs.id } })).toBeUndefined();
		expect(getLists(alice).map((l) => l.id)).toEqual([mine.id, other.id]);
	});
});
