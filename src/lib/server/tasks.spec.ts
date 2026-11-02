import { describe, expect, it } from 'vitest';
import {
	dateOnly,
	serializeDueDate,
	serializePlannedDate,
	timedDueDate,
	timedPlannedDate,
	unsetDate
} from '#lib/domain/dates.js';
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

	it('adds Subtasks at the bottom of their parent’s Subtasks', () => {
		const { alice, list } = setUp();
		const parent = add(alice, list.id, 'Party');

		add(alice, list.id, 'Cake', parent.id);
		add(alice, list.id, 'Candles', parent.id);
		add(alice, list.id, 'Balloons', parent.id);
		add(alice, list.id, 'Milk');

		const subtasks = getListTasks(alice, list.id).filter((task) => task.parentId === parent.id);
		expect(titles(subtasks)).toEqual(['Cake', 'Candles', 'Balloons']);
		expect(open(alice, list.id)).toEqual(['Milk', 'Party']);
	});

	it('refuses an open Subtask under a Completed Task', () => {
		const { alice, list } = setUp();
		const parent = add(alice, list.id, 'Party');
		completeTask(alice, parent.id);

		expect(() => add(alice, list.id, 'Cake', parent.id)).toThrow(InvalidInputError);
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

describe('Subtasks: completion cascade and Reopen', () => {
	const NOW = new Date('2026-11-02T10:00:00Z');
	const EARLIER = new Date('2026-11-01T10:00:00Z');

	function party() {
		const setup = setUp();
		const { alice, list } = setup;
		const parent = add(alice, list.id, 'Party');
		const cake = add(alice, list.id, 'Cake', parent.id);
		const candles = add(alice, list.id, 'Candles', parent.id);
		const balloons = add(alice, list.id, 'Balloons', parent.id);
		return { ...setup, parent, cake, candles, balloons };
	}

	const state = (scope: UserScope, id: string) => {
		const task = getTask(scope, id);
		return { completed: task?.completedAt != null, byCascade: task?.completedByCascade };
	};

	it('completing a parent completes its open Subtasks and returns every Task it changed', () => {
		const { alice, parent, cake, candles, balloons } = party();
		completeTask(alice, cake.id, EARLIER);

		const changes = completeTask(alice, parent.id, NOW);

		expect(changes?.upserted.map((task) => task.title).sort()).toEqual([
			'Balloons',
			'Candles',
			'Party'
		]);
		expect(state(alice, parent.id)).toEqual({ completed: true, byCascade: false });
		expect(state(alice, candles.id)).toEqual({ completed: true, byCascade: true });
		expect(state(alice, balloons.id)).toEqual({ completed: true, byCascade: true });
		expect(getTask(alice, cake.id)).toMatchObject({
			completedAt: EARLIER,
			completedByCascade: false
		});
	});

	it('completing the last open Subtask leaves the parent open', () => {
		const { alice, parent, cake, candles, balloons } = party();

		completeTask(alice, cake.id);
		completeTask(alice, candles.id);
		const changes = completeTask(alice, balloons.id);

		expect(changes?.upserted.map((task) => task.id)).toEqual([balloons.id]);
		expect(state(alice, parent.id).completed).toBe(false);
	});

	it('reopening a parent reopens only the Subtasks its completion closed', () => {
		const { alice, parent, cake, candles, balloons } = party();
		completeTask(alice, cake.id, EARLIER);
		completeTask(alice, parent.id, NOW);

		const changes = reopenTask(alice, parent.id);

		expect(changes?.upserted.map((task) => task.title).sort()).toEqual([
			'Balloons',
			'Candles',
			'Party'
		]);
		expect(state(alice, parent.id)).toEqual({ completed: false, byCascade: false });
		expect(state(alice, candles.id)).toEqual({ completed: false, byCascade: false });
		expect(state(alice, balloons.id)).toEqual({ completed: false, byCascade: false });
		expect(state(alice, cake.id)).toEqual({ completed: true, byCascade: false });
	});

	it('reopening a Subtask of a Completed parent reopens the parent but not the other Subtasks', () => {
		const { alice, parent, cake, candles, balloons } = party();
		completeTask(alice, parent.id, NOW);

		const changes = reopenTask(alice, cake.id);

		expect(changes?.upserted.map((task) => task.title).sort()).toEqual([
			'Balloons',
			'Cake',
			'Candles',
			'Party'
		]);
		expect(state(alice, cake.id).completed).toBe(false);
		expect(state(alice, parent.id).completed).toBe(false);
		expect(state(alice, candles.id)).toEqual({ completed: true, byCascade: false });
		expect(state(alice, balloons.id)).toEqual({ completed: true, byCascade: false });

		// Completing and reopening the parent again restores it as it was just before.
		completeTask(alice, parent.id, NOW);
		reopenTask(alice, parent.id);
		expect(state(alice, cake.id).completed).toBe(false);
		expect(state(alice, candles.id).completed).toBe(true);
	});

	it("never touches another User's Tasks", () => {
		const { alice, bob, parent, cake } = party();

		expect(completeTask(bob, parent.id)).toBeUndefined();
		expect(state(alice, cake.id).completed).toBe(false);
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

describe('Planned Date, Due Date and Priority', () => {
	const planned = timedPlannedDate('2026-11-04T09:00', 'Europe/Berlin', 45);
	const due = timedDueDate('2026-11-06T17:30', 'America/New_York');

	it('creates a Task with dates and a Priority', () => {
		const { alice, list } = setUp();

		const task = createTask(alice, {
			listId: list.id,
			title: 'Call the bank',
			planned,
			due: dateOnly('2026-11-06'),
			priority: 'high'
		})?.upserted[0];

		expect(task && serializeTask(task)).toMatchObject({
			planned: serializePlannedDate(planned),
			due: { kind: 'date', date: '2026-11-06' },
			priority: 'high'
		});
	});

	it('sets, changes and clears each field, keeping the zone it was given', () => {
		const { alice, list } = setUp();
		const task = add(alice, list.id, 'Call the bank');

		updateTask(alice, task.id, { planned, due, priority: 'medium' });
		const set = getTask(alice, task.id)!;
		expect(serializePlannedDate(set.planned)).toEqual(serializePlannedDate(planned));
		expect(serializeDueDate(set.due)).toEqual(serializeDueDate(due));
		expect(set.priority).toBe('medium');

		updateTask(alice, task.id, { planned: dateOnly('2026-11-05'), priority: 'low' });
		expect(getTask(alice, task.id)).toMatchObject({
			planned: { kind: 'date' },
			due: { kind: 'timed', timeZone: 'America/New_York' },
			priority: 'low'
		});

		updateTask(alice, task.id, { planned: unsetDate, due: unsetDate, priority: null });
		expect(getTask(alice, task.id)).toMatchObject({
			planned: { kind: 'unset' },
			due: { kind: 'unset' },
			priority: null
		});
	});

	it('leaves dates and their zones alone when other fields change', () => {
		const { alice, list } = setUp();
		const task = add(alice, list.id, 'Call the bank');
		updateTask(alice, task.id, { planned, due });

		updateTask(alice, task.id, { title: 'Call the bank again', priority: 'high' });

		const after = getTask(alice, task.id)!;
		expect(serializePlannedDate(after.planned)).toEqual(serializePlannedDate(planned));
		expect(serializeDueDate(after.due)).toEqual(serializeDueDate(due));
	});

	it('saves a Planned Date after the Due Date', () => {
		const { alice, list } = setUp();
		const task = add(alice, list.id, 'Late');

		updateTask(alice, task.id, { planned: dateOnly('2026-11-10'), due: dateOnly('2026-11-04') });

		expect(getTask(alice, task.id)).toMatchObject({
			planned: { kind: 'date' },
			due: { kind: 'date' }
		});
	});

	it('marks a generated Occurrence as changed when a date or the Priority changes', () => {
		const { alice, db, list } = setUp();
		const task = add(alice, list.id, 'Water plants');
		db.update(tasks).set({ changedSinceGenerated: false }).run();

		updateTask(alice, task.id, { priority: 'low' });

		expect(getTask(alice, task.id)?.changedSinceGenerated).toBe(true);
	});
});
