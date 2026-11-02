import { describe, expect, it } from 'vitest';
import { dateOnly, timedDueDate } from '#lib/domain/dates.js';
import { serializeTask, type SerializedTask, type Task } from '#lib/domain/tasks.js';
import { InvalidInputError } from '#lib/domain/validation.js';
import { createList, deleteList } from './lists';
import type { UserScope } from './scope';
import {
	MAX_RESTORED_TASKS,
	parseRestoredTasks,
	RestoreConflictError,
	restoreTasks
} from './task-restore';
import { completeTask, createTask, deleteTask, getListTasks, getTask, updateTask } from './tasks';
import { createTestDb, insertUser } from './testing/index';

function setUp() {
	const db = createTestDb();
	const alice: UserScope = { db, userId: insertUser(db, 'alice').id };
	const bob: UserScope = { db, userId: insertUser(db, 'bob').id };
	const list = createList(alice, { name: 'Groceries' });
	return { db, alice, bob, list };
}

function add(scope: UserScope, listId: string, title: string, parentId?: string): Task {
	const changes = createTask(scope, { listId, title, parentId });
	if (!changes) throw new Error('createTask failed');
	return changes.upserted[0];
}

/** Deletes a Task and returns what the DELETE endpoint sends the browser for Undo. */
function deleted(scope: UserScope, id: string): SerializedTask[] {
	const changes = deleteTask(scope, id);
	if (!changes) throw new Error('deleteTask failed');
	// Through JSON, like the browser's copy.
	return JSON.parse(JSON.stringify(changes.removed.map(serializeTask)));
}

const restore = (scope: UserScope, body: unknown) => restoreTasks(scope, parseRestoredTasks(body));

/** A Task with every kind of field set, plus two Subtasks (one Completed by the cascade). */
function party(scope: UserScope, listId: string) {
	const parent = add(scope, listId, 'Party');
	updateTask(scope, parent.id, {
		description: 'Saturday',
		priority: 'high',
		planned: dateOnly('2026-11-07'),
		due: timedDueDate('2026-11-08T18:00', 'Europe/Berlin')
	});
	const cake = add(scope, listId, 'Cake', parent.id);
	const candles = add(scope, listId, 'Candles', parent.id);
	completeTask(scope, cake.id, new Date('2026-11-01T10:00:00.000Z'));
	return { parent, cake, candles };
}

describe('parseRestoredTasks', () => {
	const valid = (): SerializedTask => ({
		id: '0b9c4f3e-7a51-4d2e-9a43-1f6f0d2c8b11',
		listId: 'list-1',
		parentId: null,
		title: 'Milk',
		description: '',
		position: 'a0',
		planned: null,
		due: { kind: 'date', date: '2026-11-03' },
		priority: 'low',
		completedAt: null,
		completedByCascade: false,
		recurrence: null,
		seriesId: null,
		occurrencesSoFar: 1,
		generatedFromTaskId: null,
		changedSinceGenerated: false,
		seriesTemplate: null,
		createdAt: '2026-11-01T09:00:00.000Z',
		updatedAt: '2026-11-01T09:30:00.000Z'
	});

	it('parses serialized Tasks into domain Tasks, ignoring fields it does not know', () => {
		const [task] = parseRestoredTasks([{ ...valid(), userId: 'someone-else', user_id: 'x' }]);
		expect(serializeTask(task)).toEqual(valid());
		expect(task).not.toHaveProperty('userId');
		expect(task).not.toHaveProperty('user_id');
	});

	it.each<[string, Partial<Record<keyof SerializedTask, unknown>>]>([
		['id', { id: 'not-an-id' }],
		['listId', { listId: 42 }],
		['position', { position: 'a 0' }],
		['title', { title: '   ' }],
		['description', { description: 7 }],
		['planned', { planned: { kind: 'date', date: '2026-13-40' } }],
		['due', { due: 'tomorrow' }],
		['priority', { priority: 'urgent' }],
		['completedAt', { completedAt: 'yesterday' }],
		['completedByCascade', { completedByCascade: 'yes' }],
		['recurrence', { recurrence: { frequency: 'hourly' } }],
		['seriesId', { seriesId: 'a b' }],
		['occurrencesSoFar', { occurrencesSoFar: 0 }],
		['generatedFromTaskId', { generatedFromTaskId: 'nope' }],
		['changedSinceGenerated', { changedSinceGenerated: null }],
		['seriesTemplate', { seriesTemplate: [1, 2] }],
		['createdAt', { createdAt: 1730000000 }],
		['updatedAt', { updatedAt: undefined }]
	])('refuses a malformed %s', (field, patch) => {
		expect(() => parseRestoredTasks([{ ...valid(), ...patch }])).toThrow(
			new RegExp(`tasks\\[0\\]: ${field}`)
		);
	});

	it('refuses anything but a non-empty, bounded list of Tasks', () => {
		expect(() => parseRestoredTasks(undefined)).toThrow(InvalidInputError);
		expect(() => parseRestoredTasks([])).toThrow(InvalidInputError);
		expect(() => parseRestoredTasks([null])).toThrow(InvalidInputError);
		expect(() => parseRestoredTasks({ 0: valid() })).toThrow(InvalidInputError);
		expect(() => parseRestoredTasks(Array(MAX_RESTORED_TASKS + 1).fill(valid()))).toThrow(
			/At most/
		);
	});

	it('refuses a batch that breaks the Subtask rules', () => {
		const parent = valid();
		const child = { ...valid(), id: '1b9c4f3e-7a51-4d2e-9a43-1f6f0d2c8b11', parentId: parent.id };
		const grandchild = {
			...valid(),
			id: '2b9c4f3e-7a51-4d2e-9a43-1f6f0d2c8b11',
			parentId: child.id
		};
		const weekly = { frequency: 'weekly', interval: 1, end: { kind: 'never' }, anchor: 'schedule' };

		expect(parseRestoredTasks([parent, child])).toHaveLength(2);
		expect(() => parseRestoredTasks([parent, parent])).toThrow(/twice/);
		expect(() => parseRestoredTasks([parent, { ...child, listId: 'list-2' }])).toThrow(/one List/);
		expect(() => parseRestoredTasks([parent, child, grandchild])).toThrow(/Subtasks of its own/);
		expect(() => parseRestoredTasks([{ ...parent, parentId: parent.id }])).toThrow(/own Subtask/);
		expect(() =>
			parseRestoredTasks([
				{ ...parent, recurrence: weekly },
				{ ...child, recurrence: weekly }
			])
		).toThrow(/both recur/);
		expect(() =>
			parseRestoredTasks([{ ...parent, completedAt: '2026-11-01T10:00:00.000Z' }, child])
		).toThrow(/open Subtasks/);
	});
});

describe('restoreTasks', () => {
	it('restores a deleted Task with its Subtasks exactly as they were', () => {
		const { alice, list } = setUp();
		add(alice, list.id, 'Milk');
		const { parent } = party(alice, list.id);
		add(alice, list.id, 'Eggs');
		const before = getListTasks(alice, list.id);

		const changes = restore(alice, deleted(alice, parent.id));

		expect(getListTasks(alice, list.id)).toEqual(before);
		expect(changes?.upserted.map((task) => task.id).sort()).toEqual(
			before
				.filter((task) => task.id === parent.id || task.parentId === parent.id)
				.map((task) => task.id)
				.sort()
		);
		const restored = getTask(alice, parent.id);
		expect(restored?.priority).toBe('high');
		expect(restored?.description).toBe('Saturday');
	});

	it('restores a deleted Subtask under its parent', () => {
		const { alice, list } = setUp();
		const { candles, parent } = party(alice, list.id);
		const before = getListTasks(alice, list.id);

		restore(alice, deleted(alice, candles.id));

		expect(getListTasks(alice, list.id)).toEqual(before);
		expect(getTask(alice, candles.id)?.parentId).toBe(parent.id);
	});

	it('takes the owner from the scope: restoring into another User’s List finds no List', () => {
		const { alice, bob, list } = setUp();
		const milk = add(alice, list.id, 'Milk');
		const body = deleted(alice, milk.id);

		expect(restore(bob, body)).toBeUndefined();
		expect(getTask(alice, milk.id)).toBeUndefined();
		expect(getTask(bob, milk.id)).toBeUndefined();

		// Into one of Bob's own Lists, the Task is Bob's.
		const bobs = createList(bob, { name: 'Bob’s' });
		restore(
			bob,
			body.map((task) => ({ ...task, listId: bobs.id }))
		);
		expect(getTask(bob, milk.id)?.listId).toBe(bobs.id);
		expect(getTask(alice, milk.id)).toBeUndefined();
	});

	it('finds no List once the List was deleted meanwhile', () => {
		const { alice, list } = setUp();
		const milk = add(alice, list.id, 'Milk');
		const body = deleted(alice, milk.id);
		deleteList(alice, list.id);

		expect(restore(alice, body)).toBeUndefined();
	});

	it('writes nothing when an id is taken (the primary key error)', () => {
		const { alice, bob, list } = setUp();
		const { parent, cake } = party(alice, list.id);
		const body = deleted(alice, parent.id);
		// Someone (here another User) has one of the ids by now.
		const bobs = createList(bob, { name: 'Bob’s' });
		createTask(bob, { id: cake.id, listId: bobs.id, title: 'Cake' });

		expect(() => restore(alice, body)).toThrow(
			expect.objectContaining({ code: 'SQLITE_CONSTRAINT_PRIMARYKEY' })
		);
		expect(getTask(alice, parent.id)).toBeUndefined();
	});

	it('refuses a Subtask whose parent is gone or no longer fits', () => {
		const { alice, list } = setUp();
		const { parent, candles } = party(alice, list.id);
		const body = deleted(alice, candles.id);

		completeTask(alice, parent.id);
		expect(() => restore(alice, body)).toThrow(RestoreConflictError);

		deleteTask(alice, parent.id);
		expect(() => restore(alice, body)).toThrow(/no longer exists/);
		expect(getTask(alice, candles.id)).toBeUndefined();
	});

	it('refuses a parent outside the batch that belongs to another User', () => {
		const { alice, bob, list } = setUp();
		const { candles } = party(alice, list.id);
		const body = deleted(alice, candles.id);
		const bobs = createList(bob, { name: 'Bob’s' });

		expect(() =>
			restore(
				bob,
				body.map((task) => ({ ...task, listId: bobs.id }))
			)
		).toThrow(/no longer exists/);
	});

	it('drops a link to an Occurrence that no longer exists, or isn’t the User’s', () => {
		const { alice, bob, list } = setUp();
		const milk = add(alice, list.id, 'Milk');
		const other = add(alice, list.id, 'Earlier');
		const bobs = createList(bob, { name: 'Bob’s' });
		const bobsTask = add(bob, bobs.id, 'Bob’s');
		const body = deleted(alice, milk.id);

		restore(alice, [{ ...body[0], generatedFromTaskId: other.id }]);
		expect(getTask(alice, milk.id)?.generatedFromTaskId).toBe(other.id);

		deleteTask(alice, milk.id);
		restore(alice, [{ ...body[0], generatedFromTaskId: bobsTask.id }]);
		expect(getTask(alice, milk.id)?.generatedFromTaskId).toBeNull();
	});
});
