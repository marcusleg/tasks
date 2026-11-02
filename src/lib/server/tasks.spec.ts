import { describe, expect, it } from 'vitest';
import { completedTasksOf, openTasksOf, serializeTask } from '#lib/domain/tasks.js';
import { InvalidInputError } from '#lib/domain/validation.js';
import { tasks } from './db/schema';
import { createList } from './lists';
import type { UserScope } from './scope';
import {
	completeTask,
	createTask,
	deleteCompletedTasks,
	deleteTask,
	getListTasks,
	getTask,
	getTasksOfLists,
	reopenTask,
	updateTask
} from './tasks';
import { createTestDb, insertUser } from './testing/index';

function setUp() {
	const db = createTestDb();
	const alice: UserScope = { db, userId: insertUser(db, 'alice').id };
	const bob: UserScope = { db, userId: insertUser(db, 'bob').id };
	const list = createList(alice, { name: 'Groceries' });
	return { db, alice, bob, list };
}

function add(scope: UserScope, listId: string, title: string, parentId?: string) {
	const changes = createTask(scope, { listId, title, parentId });
	if (!changes) throw new Error('createTask failed');
	return changes.upserted[0];
}

const titles = (items: { title: string }[]) => items.map((item) => item.title);
const open = (scope: UserScope, listId: string) =>
	titles(openTasksOf(getListTasks(scope, listId).map(serializeTask), listId));

describe('createTask', () => {
	it('puts new Tasks at the top of Custom Order', () => {
		const { alice, list } = setUp();

		add(alice, list.id, 'Milk');
		add(alice, list.id, 'Eggs');
		add(alice, list.id, 'Bread');

		expect(open(alice, list.id)).toEqual(['Bread', 'Eggs', 'Milk']);
		expect(titles(getListTasks(alice, list.id))).toEqual(['Bread', 'Eggs', 'Milk']);
	});

	it('creates an open Task without dates, Priority or Recurrence', () => {
		const { alice, list } = setUp();

		const task = add(alice, list.id, '  Milk  ');

		expect(task).toMatchObject({
			title: 'Milk',
			description: '',
			listId: list.id,
			parentId: null,
			planned: { kind: 'unset' },
			due: { kind: 'unset' },
			priority: null,
			completedAt: null,
			recurrence: null
		});
	});

	it('requires a Title', () => {
		const { alice, list } = setUp();

		expect(() => createTask(alice, { listId: list.id, title: ' ' })).toThrow(InvalidInputError);
	});

	it('uses a client-generated id', () => {
		const { alice, list } = setUp();
		const id = crypto.randomUUID();

		expect(createTask(alice, { id, listId: list.id, title: 'Milk' })?.upserted[0].id).toBe(id);
	});

	it("can't add to another User's List", () => {
		const { alice, bob, list } = setUp();

		expect(createTask(bob, { listId: list.id, title: 'Sneaky' })).toBeUndefined();
		expect(getListTasks(alice, list.id)).toEqual([]);
	});

	it('creates Subtasks one level deep only, in the parent’s List', () => {
		const { alice, list } = setUp();
		const other = createList(alice, { name: 'Other' });
		const parent = add(alice, list.id, 'Party');

		const subtask = add(alice, list.id, 'Cake', parent.id);

		expect(subtask.parentId).toBe(parent.id);
		expect(() => add(alice, list.id, 'Candles', subtask.id)).toThrow(InvalidInputError);
		expect(
			createTask(alice, { listId: other.id, title: 'X', parentId: parent.id })
		).toBeUndefined();
	});
});

describe('updateTask', () => {
	it('edits Title and Description', () => {
		const { alice, list } = setUp();
		const task = add(alice, list.id, 'Milk');

		updateTask(alice, task.id, { title: 'Oat milk', description: 'See https://example.com' });

		expect(getTask(alice, task.id)).toMatchObject({
			title: 'Oat milk',
			description: 'See https://example.com',
			changedSinceGenerated: true
		});
	});

	it('rejects an empty Title but allows an empty Description', () => {
		const { alice, list } = setUp();
		const task = add(alice, list.id, 'Milk');

		expect(() => updateTask(alice, task.id, { title: '' })).toThrow(InvalidInputError);
		expect(updateTask(alice, task.id, { description: '' })?.upserted[0].description).toBe('');
	});

	it("can't edit another User's Task", () => {
		const { alice, bob, list } = setUp();
		const task = add(alice, list.id, 'Milk');

		expect(updateTask(bob, task.id, { title: 'Hacked' })).toBeUndefined();
		expect(getTask(alice, task.id)?.title).toBe('Milk');
	});
});

describe('completeTask and reopenTask', () => {
	it('completes and reopens a Task, keeping its place in Custom Order', () => {
		const { alice, list } = setUp();
		add(alice, list.id, 'Milk');
		const eggs = add(alice, list.id, 'Eggs');
		add(alice, list.id, 'Bread');
		const now = new Date('2026-11-02T10:00:00Z');

		const changes = completeTask(alice, eggs.id, now);

		expect(changes?.upserted[0].completedAt).toEqual(now);
		expect(open(alice, list.id)).toEqual(['Bread', 'Milk']);
		const all = getListTasks(alice, list.id).map(serializeTask);
		expect(titles(completedTasksOf(all, list.id))).toEqual(['Eggs']);

		reopenTask(alice, eggs.id);

		expect(open(alice, list.id)).toEqual(['Bread', 'Eggs', 'Milk']);
	});

	it('changes nothing when already in that state', () => {
		const { alice, list } = setUp();
		const task = add(alice, list.id, 'Milk');

		expect(reopenTask(alice, task.id)).toEqual({ upserted: [], deleted: [] });
		completeTask(alice, task.id, new Date('2026-11-02T10:00:00Z'));
		expect(completeTask(alice, task.id)).toEqual({ upserted: [], deleted: [] });
		expect(getTask(alice, task.id)?.completedAt).toEqual(new Date('2026-11-02T10:00:00Z'));
	});

	it("can't complete or reopen another User's Task", () => {
		const { alice, bob, list } = setUp();
		const task = add(alice, list.id, 'Milk');

		expect(completeTask(bob, task.id)).toBeUndefined();
		expect(getTask(alice, task.id)?.completedAt).toBeNull();
		completeTask(alice, task.id);
		expect(reopenTask(bob, task.id)).toBeUndefined();
		expect(getTask(alice, task.id)?.completedAt).not.toBeNull();
	});
});

describe('deleteTask', () => {
	it('deletes the Task and its Subtasks', () => {
		const { db, alice, list } = setUp();
		const parent = add(alice, list.id, 'Party');
		const cake = add(alice, list.id, 'Cake', parent.id);
		add(alice, list.id, 'Milk');

		const changes = deleteTask(alice, parent.id);

		expect(changes?.deleted.sort()).toEqual([parent.id, cake.id].sort());
		expect(titles(db.select().from(tasks).all())).toEqual(['Milk']);
	});

	it("can't delete another User's Task", () => {
		const { alice, bob, list } = setUp();
		const task = add(alice, list.id, 'Milk');

		expect(deleteTask(bob, task.id)).toBeUndefined();
		expect(getTask(alice, task.id)).toBeDefined();
	});
});

describe('deleteCompletedTasks', () => {
	it('removes only the Completed Tasks of that List', () => {
		const { alice, list } = setUp();
		const other = createList(alice, { name: 'Other' });
		const milk = add(alice, list.id, 'Milk');
		const eggs = add(alice, list.id, 'Eggs');
		add(alice, list.id, 'Bread');
		const elsewhere = add(alice, other.id, 'Elsewhere');
		completeTask(alice, milk.id);
		completeTask(alice, eggs.id);
		completeTask(alice, elsewhere.id);

		const changes = deleteCompletedTasks(alice, list.id);

		expect(changes?.deleted.sort()).toEqual([milk.id, eggs.id].sort());
		expect(titles(getListTasks(alice, list.id))).toEqual(['Bread']);
		expect(titles(getListTasks(alice, other.id))).toEqual(['Elsewhere']);
	});

	it("can't clear another User's List", () => {
		const { alice, bob, list } = setUp();
		const task = add(alice, list.id, 'Milk');
		completeTask(alice, task.id);

		expect(deleteCompletedTasks(bob, list.id)).toBeUndefined();
		expect(getTask(alice, task.id)).toBeDefined();
	});
});

describe('cross-User isolation', () => {
	it("never reads another User's Tasks", () => {
		const { alice, bob, list } = setUp();
		const task = add(alice, list.id, 'Secret');
		const bobs = createList(bob, { name: 'Bob' });
		add(bob, bobs.id, 'Bob task');

		expect(getTask(bob, task.id)).toBeUndefined();
		expect(getListTasks(bob, list.id)).toEqual([]);
		expect(titles(getTasksOfLists(bob, [list.id, bobs.id]))).toEqual(['Bob task']);
	});
});
