import { describe, expect, it } from 'vitest';
import { dateOnly, serializePlannedDate, timedDueDate, unsetDate } from '#lib/domain/dates.js';
import { parseRecurrence, serializeRecurrence } from '#lib/domain/recurrence.js';
import { openTasksOf, serializeTask } from '#lib/domain/tasks.js';
import { InvalidInputError } from '#lib/domain/validation.js';
import { createList } from './lists';
import type { UserScope } from './scope';
import {
	completeTask,
	createTask,
	deleteTask,
	getListTasks,
	getTask,
	moveTask,
	reopenTask,
	updateTask
} from './tasks';
import { createTestDb, insertUser } from './testing/index';

function setUp() {
	const db = createTestDb();
	const alice: UserScope = { db, userId: insertUser(db, 'alice').id };
	const list = createList(alice, { name: 'Chores' });
	return { db, alice, list };
}

function add(scope: UserScope, listId: string, title: string, parentId?: string) {
	const changes = createTask(scope, { listId, title, parentId });
	if (!changes) throw new Error('createTask failed');
	return changes.upserted[0];
}

const open = (scope: UserScope, listId: string) =>
	openTasksOf(getListTasks(scope, listId).map(serializeTask), listId).map((task) => task.title);

const weekly = parseRecurrence({
	frequency: 'weekly',
	interval: 1,
	end: { kind: 'never' },
	anchor: 'schedule'
});

describe('setting a Recurrence', () => {
	it('stores the rule with the driving date’s weekday and starts a new series', () => {
		const { alice, list } = setUp();
		const task = add(alice, list.id, 'Water plants');
		// 2026-11-04 is a Wednesday.
		updateTask(alice, task.id, { planned: dateOnly('2026-11-04') });

		updateTask(alice, task.id, { recurrence: weekly });

		const saved = getTask(alice, task.id)!;
		expect(serializeRecurrence(saved.recurrence!)).toEqual({
			frequency: 'weekly',
			interval: 1,
			weekdays: [3],
			end: { kind: 'never' },
			anchor: 'schedule'
		});
		expect(saved.seriesId).toMatch(/^[0-9a-f-]{36}$/);
		expect(saved.occurrencesSoFar).toBe(1);
	});

	it('refuses a Recurrence on a Completed Task', () => {
		const { alice, list } = setUp();
		const task = add(alice, list.id, 'Water plants');
		updateTask(alice, task.id, { planned: dateOnly('2026-11-04') });
		completeTask(alice, task.id);

		expect(() => updateTask(alice, task.id, { recurrence: weekly })).toThrow(
			'Reopen the task first'
		);
		expect(getTask(alice, task.id)?.recurrence).toBeNull();
	});

	it('needs at least one date, and keeps the last date of a recurring Task', () => {
		const { alice, list } = setUp();
		const task = add(alice, list.id, 'Water plants');

		expect(() => updateTask(alice, task.id, { recurrence: weekly })).toThrow(InvalidInputError);
		expect(getTask(alice, task.id)?.recurrence).toBeNull();

		updateTask(alice, task.id, { due: dateOnly('2026-11-04'), recurrence: weekly });
		updateTask(alice, task.id, { planned: dateOnly('2026-11-03') });
		updateTask(alice, task.id, { due: unsetDate });
		expect(() => updateTask(alice, task.id, { planned: unsetDate })).toThrow(InvalidInputError);
		expect(getTask(alice, task.id)?.planned).toEqual(dateOnly('2026-11-03'));

		// Without its Recurrence, the last date can go.
		updateTask(alice, task.id, { recurrence: null, planned: unsetDate });
		expect(getTask(alice, task.id)).toMatchObject({
			recurrence: null,
			seriesId: null,
			planned: { kind: 'unset' }
		});
	});
});

describe('exclusivity: a Task and its Subtasks can’t both recur', () => {
	function family(scope: UserScope, listId: string) {
		const parent = add(scope, listId, 'Garden');
		const subtask = add(scope, listId, 'Water plants', parent.id);
		const other = add(scope, listId, 'Mow', parent.id);
		for (const task of [parent, subtask, other]) {
			updateTask(scope, task.id, { planned: dateOnly('2026-11-04') });
		}
		return { parent, subtask, other };
	}

	it('refuses a Recurrence on a parent with a recurring Subtask', () => {
		const { alice, list } = setUp();
		const { parent, subtask, other } = family(alice, list.id);

		updateTask(alice, subtask.id, { recurrence: weekly });
		// Several Subtasks may recur.
		updateTask(alice, other.id, { recurrence: weekly });

		expect(() => updateTask(alice, parent.id, { recurrence: weekly })).toThrow(
			'A Subtask of this Task repeats'
		);
		expect(getTask(alice, parent.id)?.recurrence).toBeNull();
	});

	it('refuses a Recurrence on a Subtask whose parent recurs', () => {
		const { alice, list } = setUp();
		const { parent, subtask } = family(alice, list.id);

		updateTask(alice, parent.id, { recurrence: weekly });

		expect(() => updateTask(alice, subtask.id, { recurrence: weekly })).toThrow(
			'The parent Task repeats'
		);
	});

	it('allows it again once the other one stops repeating', () => {
		const { alice, list } = setUp();
		const { parent, subtask } = family(alice, list.id);
		updateTask(alice, subtask.id, { recurrence: weekly });

		updateTask(alice, subtask.id, { recurrence: null });
		updateTask(alice, parent.id, { recurrence: weekly });

		expect(getTask(alice, parent.id)?.recurrence).not.toBeNull();
	});
});

describe('completing an Occurrence', () => {
	it('keeps it Completed and creates the next one in its place, with Subtasks reopened and shifted', () => {
		const { alice, list } = setUp();
		add(alice, list.id, 'Below');
		const task = add(alice, list.id, 'Water plants');
		add(alice, list.id, 'Above');
		updateTask(alice, task.id, {
			description: 'All of them',
			priority: 'high',
			planned: dateOnly('2026-11-04'),
			due: timedDueDate('2026-11-06T18:00', 'Europe/Berlin'),
			recurrence: weekly
		});
		const fern = add(alice, list.id, 'Fern', task.id);
		updateTask(alice, fern.id, { planned: dateOnly('2026-11-05') });
		const cactus = add(alice, list.id, 'Cactus', task.id);
		completeTask(alice, cactus.id);
		const before = getTask(alice, task.id)!;

		const changes = completeTask(alice, task.id, new Date('2026-11-04T10:00:00Z'))!;

		expect(getTask(alice, task.id)?.completedAt).not.toBeNull();
		const next = changes.upserted.find((t) => t.parentId === null && t.completedAt === null)!;
		expect(serializeTask(next)).toMatchObject({
			listId: list.id,
			title: 'Water plants',
			description: 'All of them',
			priority: 'high',
			planned: { kind: 'date', date: '2026-11-11' },
			due: { kind: 'timed', dateTime: '2026-11-13T18:00', timeZone: 'Europe/Berlin' },
			recurrence: serializeRecurrence(before.recurrence!),
			seriesId: before.seriesId,
			occurrencesSoFar: 2,
			generatedFromTaskId: task.id,
			changedSinceGenerated: false,
			completedAt: null
		});
		expect(open(alice, list.id)).toEqual(['Above', 'Water plants', 'Below']);

		const copies = getListTasks(alice, list.id).filter((t) => t.parentId === next.id);
		expect(copies.map((t) => [t.title, t.completedAt, serializePlannedDate(t.planned)])).toEqual([
			['Fern', null, { kind: 'date', date: '2026-11-12' }],
			['Cactus', null, null]
		]);
		expect(changes.upserted.map((t) => t.id)).toEqual(
			expect.arrayContaining([task.id, fern.id, next.id, ...copies.map((t) => t.id)])
		);
		// The Completed Occurrence keeps its own Subtasks.
		expect(getTask(alice, fern.id)).toMatchObject({ parentId: task.id });
		expect(getTask(alice, fern.id)?.completedAt).not.toBeNull();
	});

	it('creates none once the series has ended', () => {
		const { alice, list } = setUp();
		const task = add(alice, list.id, 'Course');
		const twice = parseRecurrence({
			...serializeRecurrence(weekly),
			end: { kind: 'count', count: 2 }
		});
		updateTask(alice, task.id, { planned: dateOnly('2026-11-04'), recurrence: twice });

		const second = completeTask(alice, task.id)!.upserted.find((t) => t.completedAt === null)!;
		const changes = completeTask(alice, second.id)!;

		expect(second.occurrencesSoFar).toBe(2);
		expect(changes.upserted.map((t) => t.id)).toEqual([second.id]);
		expect(open(alice, list.id)).toEqual([]);
	});

	it('counts from the completion date in the completing browser’s zone', () => {
		const { alice, list } = setUp();
		const task = add(alice, list.id, 'Haircut');
		const afterCompletion = parseRecurrence({
			frequency: 'daily',
			interval: 10,
			end: { kind: 'never' },
			anchor: 'completion'
		});
		updateTask(alice, task.id, { planned: dateOnly('2026-11-01'), recurrence: afterCompletion });

		// 23:30 UTC on Nov 4 is already Nov 5 in Berlin.
		const changes = completeTask(
			alice,
			task.id,
			new Date('2026-11-04T23:30:00Z'),
			'Europe/Berlin'
		)!;

		const next = changes.upserted.find((t) => t.completedAt === null)!;
		expect(serializePlannedDate(next.planned)).toEqual({ kind: 'date', date: '2026-11-15' });
	});
});

describe('recurring Subtasks', () => {
	function garden(scope: UserScope, listId: string) {
		const parent = add(scope, listId, 'Garden');
		const subtask = add(scope, listId, 'Water plants', parent.id);
		updateTask(scope, subtask.id, { planned: dateOnly('2026-11-04'), recurrence: weekly });
		return { parent, subtask };
	}

	it('completing one on its own creates its next Occurrence under the same parent', () => {
		const { alice, list } = setUp();
		const { parent, subtask } = garden(alice, list.id);

		const next = completeTask(alice, subtask.id)!.upserted.find((t) => t.completedAt === null)!;

		expect(next).toMatchObject({ parentId: parent.id, generatedFromTaskId: subtask.id });
		expect(serializePlannedDate(next.planned)).toEqual({ kind: 'date', date: '2026-11-11' });
		expect(getTask(alice, parent.id)?.completedAt).toBeNull();
	});

	it('gets no next Occurrence when its parent’s completion closes it, and continues on Reopen', () => {
		const { alice, list } = setUp();
		const { parent, subtask } = garden(alice, list.id);

		const completed = completeTask(alice, parent.id)!;
		expect(completed.upserted.map((t) => t.id).sort()).toEqual([parent.id, subtask.id].sort());
		expect(getListTasks(alice, list.id)).toHaveLength(2);

		reopenTask(alice, parent.id);
		const reopened = getTask(alice, subtask.id)!;
		expect(reopened).toMatchObject({ completedAt: null, occurrencesSoFar: 1 });
		expect(reopened.recurrence).not.toBeNull();

		// Its Recurrence continues from where it was.
		const next = completeTask(alice, subtask.id)!.upserted.find((t) => t.completedAt === null)!;
		expect(serializePlannedDate(next.planned)).toEqual({ kind: 'date', date: '2026-11-11' });
	});
});

describe('Reopen of an Occurrence', () => {
	/** A weekly "Water plants" with a Subtask "Fern", completed once: returns both Occurrences. */
	function completedOnce(scope: UserScope, listId: string) {
		const first = add(scope, listId, 'Water plants');
		updateTask(scope, first.id, { planned: dateOnly('2026-11-04'), recurrence: weekly });
		const fern = add(scope, listId, 'Fern', first.id);
		const changes = completeTask(scope, first.id)!;
		const current = changes.upserted.find((t) => t.parentId === null && t.completedAt === null)!;
		const currentFern = changes.upserted.find((t) => t.parentId === current.id)!;
		return { first, fern, current, currentFern };
	}

	it('right after completing (Undo), removes the new Occurrence and the reopened one is current again', () => {
		const { alice, list } = setUp();
		const { first, fern, current, currentFern } = completedOnce(alice, list.id);

		const changes = reopenTask(alice, first.id)!;

		expect(changes.deleted.sort()).toEqual([current.id, currentFern.id].sort());
		expect(getTask(alice, current.id)).toBeUndefined();
		expect(getTask(alice, currentFern.id)).toBeUndefined();
		const reopened = getTask(alice, first.id)!;
		expect(reopened).toMatchObject({ completedAt: null, occurrencesSoFar: 1 });
		expect(reopened.recurrence).not.toBeNull();
		expect(getTask(alice, fern.id)?.completedAt).toBeNull();
		expect(open(alice, list.id)).toEqual(['Water plants']);

		// And it recurs as before.
		const again = completeTask(alice, first.id)!.upserted.find(
			(t) => t.completedAt === null && t.parentId === null
		)!;
		expect(serializePlannedDate(again.planned)).toEqual({ kind: 'date', date: '2026-11-11' });
	});

	it.each<
		[
			string,
			(scope: UserScope, ids: { current: string; currentFern: string; listId: string }) => void
		]
	>([
		[
			'a field edit',
			(scope, { current }) => updateTask(scope, current, { title: 'Water all plants' })
		],
		[
			'a Subtask edit',
			(scope, { currentFern }) => updateTask(scope, currentFern, { title: 'Ferns' })
		],
		['a Subtask added', (scope, { current, listId }) => add(scope, listId, 'Cactus', current)],
		['a Subtask completed', (scope, { currentFern }) => completeTask(scope, currentFern)],
		['a Subtask deleted', (scope, { currentFern }) => deleteTask(scope, currentFern)]
	])('after %s on the new Occurrence, brings the old one back as a one-off Task', (_, change) => {
		const { alice, list } = setUp();
		const { first, current, currentFern } = completedOnce(alice, list.id);
		change(alice, { current: current.id, currentFern: currentFern.id, listId: list.id });

		const changes = reopenTask(alice, first.id)!;

		expect(changes.deleted).toEqual([]);
		expect(getTask(alice, first.id)).toMatchObject({
			completedAt: null,
			recurrence: null,
			seriesId: null
		});
		expect(getTask(alice, current.id)?.recurrence).not.toBeNull();
		expect(open(alice, list.id)).toHaveLength(2);
	});

	it('brings an older Occurrence back as a one-off Task', () => {
		const { alice, list } = setUp();
		const { first, current } = completedOnce(alice, list.id);
		const third = completeTask(alice, current.id)!.upserted.find(
			(t) => t.completedAt === null && t.parentId === null
		)!;

		reopenTask(alice, first.id);

		expect(getTask(alice, first.id)).toMatchObject({ recurrence: null, seriesId: null });
		expect(getTask(alice, third.id)?.completedAt).toBeNull();
	});

	it('undoes two completions in a row, newest first', () => {
		const { alice, list } = setUp();
		const { first, current } = completedOnce(alice, list.id);
		const third = completeTask(alice, current.id)!.upserted.find(
			(t) => t.completedAt === null && t.parentId === null
		)!;

		expect(reopenTask(alice, current.id)?.deleted).toContain(third.id);
		expect(reopenTask(alice, first.id)?.deleted).toContain(current.id);

		expect(getTask(alice, first.id)?.recurrence).not.toBeNull();
		expect(open(alice, list.id)).toEqual(['Water plants']);
	});

	it('reopening a Subtask of a Completed Occurrence reopens it by the same rules', () => {
		const { alice, list } = setUp();
		const { first, fern, current } = completedOnce(alice, list.id);

		const changes = reopenTask(alice, fern.id)!;

		expect(changes.deleted).toContain(current.id);
		expect(getTask(alice, first.id)?.completedAt).toBeNull();
		expect(getTask(alice, first.id)?.recurrence).not.toBeNull();
	});

	it.each<
		[
			string,
			(scope: UserScope, ids: { current: string; currentFern: string; listId: string }) => void
		]
	>([
		[
			'a move',
			(scope, { current, listId }) => {
				const other = add(scope, listId, 'Other');
				moveTask(scope, current, { listId, parentId: null, after: other.id });
			}
		],
		[
			'a Subtask moved out',
			(scope, { currentFern, listId }) => moveTask(scope, currentFern, { listId, parentId: null })
		],
		[
			'a Subtask moved in',
			(scope, { current, listId }) => {
				const other = add(scope, listId, 'Cactus');
				moveTask(scope, other.id, { listId, parentId: current });
			}
		]
	])('after %s, brings the old one back as a one-off Task', (_, change) => {
		const { alice, list } = setUp();
		const { first, current, currentFern } = completedOnce(alice, list.id);
		change(alice, { current: current.id, currentFern: currentFern.id, listId: list.id });

		expect(reopenTask(alice, first.id)?.deleted).toEqual([]);
		expect(getTask(alice, first.id)?.recurrence).toBeNull();
	});
});
