/**
 * Editing or deleting "This Occurrence" or "This and all future" (CONTEXT.md → Occurrence, #17),
 * through the data layer: what the current Occurrence becomes, and what the next one is generated
 * from.
 */
import { describe, expect, it } from 'vitest';
import {
	dateOnly,
	serializeDueDate,
	serializePlannedDate,
	timedPlannedDate
} from '#lib/domain/dates.js';
import { parseRecurrence, serializeRecurrence } from '#lib/domain/recurrence.js';
import type { ApplyTo } from '#lib/domain/recurring-tasks.js';
import { openTasksOf, serializeTask, type Task } from '#lib/domain/tasks.js';
import { createList } from './lists';
import { parseRestoredTasks, RestoreConflictError, restoreTasks } from './task-restore';
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

function add(
	scope: UserScope,
	listId: string,
	title: string,
	parentId?: string,
	applyTo?: ApplyTo
): Task {
	const changes = createTask(scope, { listId, title, parentId }, applyTo);
	if (!changes) throw new Error('createTask failed');
	return changes.upserted[0];
}

const rule = (fields: Record<string, unknown>) =>
	parseRecurrence({ interval: 1, end: { kind: 'never' }, anchor: 'schedule', ...fields });
const weekly = rule({ frequency: 'weekly' });

/** "Water plants" planned on Monday 2 Nov 2026, repeating weekly. */
function waterPlants(scope: UserScope, listId: string): Task {
	const task = add(scope, listId, 'Water plants');
	updateTask(scope, task.id, { planned: dateOnly('2026-11-02'), recurrence: weekly });
	return getTask(scope, task.id)!;
}

/** Completes the current Occurrence and returns the next one (top-level). */
function completeAndGetNext(scope: UserScope, id: string, at = '2026-11-03T10:00:00Z'): Task {
	const changes = completeTask(scope, id, new Date(at), 'Europe/Berlin')!;
	const next = changes.upserted.find((t) => t.completedAt === null && t.parentId === null);
	if (!next) throw new Error('No next Occurrence');
	return next;
}

const planned = (task: Task) => serializePlannedDate(task.planned);

describe('editing This Occurrence', () => {
	it('changes the Title of the current Occurrence only', () => {
		const { alice, list } = setUp();
		const task = waterPlants(alice, list.id);

		updateTask(alice, task.id, { title: 'Water the ferns' }, 'occurrence');

		expect(getTask(alice, task.id)?.title).toBe('Water the ferns');
		const next = completeAndGetNext(alice, task.id);
		expect(next.title).toBe('Water plants');
	});

	it('moving a date keeps the next Occurrence on the rule (scheduled)', () => {
		const { alice, list } = setUp();
		const task = waterPlants(alice, list.id);

		// Monday → Tuesday, this week only.
		updateTask(alice, task.id, { planned: dateOnly('2026-11-03') }, 'occurrence');

		const moved = getTask(alice, task.id)!;
		expect(planned(moved)).toEqual({ kind: 'date', date: '2026-11-03' });
		expect(serializeRecurrence(moved.recurrence!)).toMatchObject({ weekdays: [1] });
		expect(planned(completeAndGetNext(alice, task.id))).toEqual({
			kind: 'date',
			date: '2026-11-09'
		});
	});

	it('moving a date keeps the time of day of the series (after completion)', () => {
		const { alice, list } = setUp();
		const task = add(alice, list.id, 'Haircut');
		updateTask(alice, task.id, {
			planned: timedPlannedDate('2026-11-02T09:00', 'Europe/Berlin'),
			recurrence: rule({ frequency: 'daily', interval: 10, anchor: 'completion' })
		});

		updateTask(
			alice,
			task.id,
			{ planned: timedPlannedDate('2026-11-03T14:00', 'Europe/Berlin') },
			'occurrence'
		);

		// Completed on Nov 4: ten days later, at the series' 09:00.
		expect(planned(completeAndGetNext(alice, task.id, '2026-11-04T15:00:00Z'))).toMatchObject({
			dateTime: '2026-11-14T09:00'
		});
	});

	it('keeps Title, Description and Priority of the series while the dates move', () => {
		const { alice, list } = setUp();
		const task = waterPlants(alice, list.id);

		updateTask(alice, task.id, { priority: 'high', description: 'Just this once' }, 'occurrence');
		updateTask(alice, task.id, { due: dateOnly('2026-11-05') }, 'occurrence');

		const next = completeAndGetNext(alice, task.id);
		expect(next).toMatchObject({ priority: null, description: '' });
		expect(serializeDueDate(next.due)).toBeNull();
	});

	it('is no longer kept apart once it matches the series again', () => {
		const { alice, list } = setUp();
		const task = waterPlants(alice, list.id);

		updateTask(alice, task.id, { planned: dateOnly('2026-11-03') }, 'occurrence');
		expect(getTask(alice, task.id)?.seriesTemplate).not.toBeNull();
		updateTask(alice, task.id, { planned: dateOnly('2026-11-02') }, 'occurrence');

		expect(getTask(alice, task.id)?.seriesTemplate).toBeNull();
	});

	it('changing the Recurrence afterwards keeps the series’ weekday', () => {
		const { alice, list } = setUp();
		const task = waterPlants(alice, list.id);
		updateTask(alice, task.id, { planned: dateOnly('2026-11-04') }, 'occurrence');

		updateTask(alice, task.id, { recurrence: rule({ frequency: 'weekly', interval: 2 }) });

		const changed = getTask(alice, task.id)!;
		expect(serializeRecurrence(changed.recurrence!)).toMatchObject({ interval: 2, weekdays: [1] });
		expect(planned(completeAndGetNext(alice, task.id))).toEqual({
			kind: 'date',
			date: '2026-11-16'
		});
	});

	it('stopping the Recurrence drops the template', () => {
		const { alice, list } = setUp();
		const task = waterPlants(alice, list.id);
		updateTask(alice, task.id, { title: 'Water the ferns' }, 'occurrence');

		updateTask(alice, task.id, { recurrence: null });

		expect(getTask(alice, task.id)).toMatchObject({
			title: 'Water the ferns',
			seriesTemplate: null
		});
	});
});

describe('editing This and all future', () => {
	it('changes the Title of the current Occurrence and the ones after it', () => {
		const { alice, list } = setUp();
		const task = waterPlants(alice, list.id);

		updateTask(alice, task.id, { title: 'Water the ferns' }, 'future');

		const next = completeAndGetNext(alice, task.id);
		expect(next.title).toBe('Water the ferns');
		expect(completeAndGetNext(alice, next.id, '2026-11-10T10:00:00Z').title).toBe(
			'Water the ferns'
		);
	});

	it('moving a date moves the weekday of the rule (scheduled)', () => {
		const { alice, list } = setUp();
		const task = waterPlants(alice, list.id);

		updateTask(alice, task.id, { planned: dateOnly('2026-11-03') }, 'future');

		expect(serializeRecurrence(getTask(alice, task.id)!.recurrence!)).toMatchObject({
			weekdays: [2]
		});
		expect(planned(completeAndGetNext(alice, task.id))).toEqual({
			kind: 'date',
			date: '2026-11-10'
		});
	});

	it('moving a date swaps just that weekday of a rule with several', () => {
		const { alice, list } = setUp();
		const task = add(alice, list.id, 'Gym');
		updateTask(alice, task.id, {
			planned: dateOnly('2026-11-02'),
			recurrence: rule({ frequency: 'weekly', weekdays: [1, 4] })
		});

		updateTask(alice, task.id, { planned: dateOnly('2026-11-03') }, 'future');

		expect(serializeRecurrence(getTask(alice, task.id)!.recurrence!)).toMatchObject({
			weekdays: [2, 4]
		});
		expect(planned(completeAndGetNext(alice, task.id))).toEqual({
			kind: 'date',
			date: '2026-11-05'
		});
	});

	it('moving a date moves the day of a monthly rule', () => {
		const { alice, list } = setUp();
		const task = add(alice, list.id, 'Rent');
		updateTask(alice, task.id, {
			due: dateOnly('2026-11-30'),
			recurrence: rule({ frequency: 'monthly' })
		});

		updateTask(alice, task.id, { due: dateOnly('2026-11-27') }, 'future');

		expect(serializeRecurrence(getTask(alice, task.id)!.recurrence!)).toMatchObject({
			monthDay: 27
		});
		expect(serializeDueDate(completeAndGetNext(alice, task.id).due)).toEqual({
			kind: 'date',
			date: '2026-12-27'
		});
	});

	it('moving a date carries the new time of day on (after completion)', () => {
		const { alice, list } = setUp();
		const task = add(alice, list.id, 'Haircut');
		updateTask(alice, task.id, {
			planned: timedPlannedDate('2026-11-02T09:00', 'Europe/Berlin'),
			recurrence: rule({ frequency: 'daily', interval: 10, anchor: 'completion' })
		});

		updateTask(
			alice,
			task.id,
			{ planned: timedPlannedDate('2026-11-03T14:00', 'Europe/Berlin') },
			'future'
		);

		expect(planned(completeAndGetNext(alice, task.id, '2026-11-04T15:00:00Z'))).toMatchObject({
			dateTime: '2026-11-14T14:00'
		});
	});

	it('after a This Occurrence move, re-bases the series on this Occurrence', () => {
		const { alice, list } = setUp();
		const task = waterPlants(alice, list.id);
		updateTask(alice, task.id, { title: 'Water the ferns' }, 'occurrence');
		updateTask(alice, task.id, { planned: dateOnly('2026-11-03') }, 'occurrence');

		// Wednesday from now on; the Title stays this Occurrence's own.
		updateTask(alice, task.id, { planned: dateOnly('2026-11-04') }, 'future');

		const next = completeAndGetNext(alice, task.id);
		expect(planned(next)).toEqual({ kind: 'date', date: '2026-11-11' });
		expect(next.title).toBe('Water plants');
		expect(serializeRecurrence(next.recurrence!)).toMatchObject({ weekdays: [3] });
	});

	it('is the default, as before Occurrence scopes existed', () => {
		const { alice, list } = setUp();
		const task = waterPlants(alice, list.id);

		updateTask(alice, task.id, { title: 'Water the ferns' });

		expect(completeAndGetNext(alice, task.id).title).toBe('Water the ferns');
	});
});

describe('Reopen of an Occurrence with a template', () => {
	it('right after completing, restores it with its template', () => {
		const { alice, list } = setUp();
		const task = waterPlants(alice, list.id);
		updateTask(alice, task.id, { planned: dateOnly('2026-11-03') }, 'occurrence');
		completeAndGetNext(alice, task.id);

		reopenTask(alice, task.id);

		expect(planned(completeAndGetNext(alice, task.id))).toEqual({
			kind: 'date',
			date: '2026-11-09'
		});
	});

	it('as a one-off Task, drops its template', () => {
		const { alice, list } = setUp();
		const task = waterPlants(alice, list.id);
		updateTask(alice, task.id, { title: 'Water the ferns' }, 'occurrence');
		const next = completeAndGetNext(alice, task.id);
		updateTask(alice, next.id, { description: 'Changed' });

		reopenTask(alice, task.id);

		expect(getTask(alice, task.id)).toMatchObject({ recurrence: null, seriesTemplate: null });
	});
});

describe('Occurrences without a template (created before #17)', () => {
	it('are generated from the current Occurrence, as before', () => {
		const { alice, list } = setUp();
		const task = waterPlants(alice, list.id);
		expect(task.seriesTemplate).toBeNull();

		const next = completeAndGetNext(alice, task.id);

		expect(next).toMatchObject({ title: 'Water plants', seriesTemplate: null });
		expect(planned(next)).toEqual({ kind: 'date', date: '2026-11-09' });
	});

	it('the next Occurrence is its own template again', () => {
		const { alice, list } = setUp();
		const task = waterPlants(alice, list.id);
		updateTask(alice, task.id, { planned: dateOnly('2026-11-03') }, 'occurrence');

		expect(completeAndGetNext(alice, task.id).seriesTemplate).toBeNull();
	});
});

describe('Subtasks of a recurring Task', () => {
	/** "Water plants" with the Subtasks "Fern" and "Cactus". */
	function withSubtasks(scope: UserScope, listId: string) {
		const task = waterPlants(scope, listId);
		const fern = add(scope, listId, 'Fern', task.id);
		const cactus = add(scope, listId, 'Cactus', task.id);
		return { task, fern, cactus };
	}

	const subtaskTitles = (scope: UserScope, listId: string, parentId: string) =>
		getListTasks(scope, listId)
			.filter((t) => t.parentId === parentId)
			.map((t) => t.title);

	it('a Subtask added to This Occurrence isn’t passed on', () => {
		const { alice, list } = setUp();
		const { task } = withSubtasks(alice, list.id);

		add(alice, list.id, 'Orchid', task.id, 'occurrence');

		expect(subtaskTitles(alice, list.id, task.id)).toEqual(['Fern', 'Cactus', 'Orchid']);
		const next = completeAndGetNext(alice, task.id);
		expect(subtaskTitles(alice, list.id, next.id)).toEqual(['Fern', 'Cactus']);
	});

	it('a Subtask added to all future Occurrences is passed on, also after a This Occurrence change', () => {
		const { alice, list } = setUp();
		const { task } = withSubtasks(alice, list.id);
		add(alice, list.id, 'Orchid', task.id, 'occurrence');

		add(alice, list.id, 'Basil', task.id, 'future');

		const next = completeAndGetNext(alice, task.id);
		expect(subtaskTitles(alice, list.id, next.id)).toEqual(['Fern', 'Cactus', 'Basil']);
	});

	it('editing a Subtask for This Occurrence keeps it as it was in the next one, dates shifted', () => {
		const { alice, list } = setUp();
		const { task, fern } = withSubtasks(alice, list.id);
		updateTask(alice, fern.id, { planned: dateOnly('2026-11-03') });

		updateTask(alice, fern.id, { title: 'Ferns', planned: dateOnly('2026-11-04') }, 'occurrence');

		expect(getTask(alice, fern.id)?.title).toBe('Ferns');
		const next = completeAndGetNext(alice, task.id);
		const nextFern = getListTasks(alice, list.id).find(
			(t) => t.parentId === next.id && t.title === 'Fern'
		)!;
		expect(planned(nextFern)).toEqual({ kind: 'date', date: '2026-11-10' });
	});

	it('editing a Subtask for all future Occurrences reaches the template', () => {
		const { alice, list } = setUp();
		const { task, fern, cactus } = withSubtasks(alice, list.id);
		updateTask(alice, cactus.id, { title: 'Cacti' }, 'occurrence');

		updateTask(alice, fern.id, { title: 'Ferns' }, 'future');

		const next = completeAndGetNext(alice, task.id);
		expect(subtaskTitles(alice, list.id, next.id)).toEqual(['Ferns', 'Cactus']);
	});

	it('deleting a Subtask from This Occurrence keeps it in the next one', () => {
		const { alice, list } = setUp();
		const { task, fern } = withSubtasks(alice, list.id);

		deleteTask(alice, fern.id, 'occurrence');

		expect(subtaskTitles(alice, list.id, task.id)).toEqual(['Cactus']);
		const next = completeAndGetNext(alice, task.id);
		expect(subtaskTitles(alice, list.id, next.id)).toEqual(['Fern', 'Cactus']);
	});

	it('deleting a Subtask from all future Occurrences removes it from the template', () => {
		const { alice, list } = setUp();
		const { task, fern } = withSubtasks(alice, list.id);
		add(alice, list.id, 'Orchid', task.id, 'occurrence');

		deleteTask(alice, fern.id, 'future');

		const next = completeAndGetNext(alice, task.id);
		expect(subtaskTitles(alice, list.id, next.id)).toEqual(['Cactus']);
	});

	it('completing a Subtask is progress, not a change to the series', () => {
		const { alice, list } = setUp();
		const { task, fern } = withSubtasks(alice, list.id);

		completeTask(alice, fern.id);

		expect(getTask(alice, task.id)?.seriesTemplate).toBeNull();
	});

	it('moving a Subtask out changes This Occurrence only', () => {
		const { alice, list } = setUp();
		const { task, fern } = withSubtasks(alice, list.id);

		moveTask(alice, fern.id, { listId: list.id, parentId: null });

		const next = completeAndGetNext(alice, task.id);
		expect(subtaskTitles(alice, list.id, next.id)).toEqual(['Fern', 'Cactus']);
	});
});

describe('deleting This Occurrence (skip)', () => {
	it('removes it and brings the next Occurrence, without a Completed entry', () => {
		const { alice, list } = setUp();
		const task = waterPlants(alice, list.id);
		add(alice, list.id, 'Fern', task.id);

		const changes = deleteTask(alice, task.id, 'occurrence')!;

		expect(getTask(alice, task.id)).toBeUndefined();
		const all = getListTasks(alice, list.id);
		expect(all.filter((t) => t.completedAt !== null)).toEqual([]);
		const [next] = openTasksOf(all.map(serializeTask), list.id);
		expect(next).toMatchObject({
			title: 'Water plants',
			planned: { kind: 'date', date: '2026-11-09' },
			occurrencesSoFar: 2,
			seriesId: task.seriesId,
			generatedFromTaskId: null
		});
		expect(all.filter((t) => t.parentId === next.id).map((t) => t.title)).toEqual(['Fern']);
		expect(changes.deleted).toContain(task.id);
		expect(changes.upserted.map((t) => t.id)).toContain(next.id);
	});

	it('generates the next Occurrence from the template', () => {
		const { alice, list } = setUp();
		const task = waterPlants(alice, list.id);
		updateTask(
			alice,
			task.id,
			{ title: 'Water the ferns', planned: dateOnly('2026-11-05') },
			'occurrence'
		);

		deleteTask(alice, task.id, 'occurrence');

		const [next] = getListTasks(alice, list.id);
		expect(next.title).toBe('Water plants');
		expect(planned(next)).toEqual({ kind: 'date', date: '2026-11-09' });
	});

	it('leaves nothing once the series is used up', () => {
		const { alice, list } = setUp();
		const task = add(alice, list.id, 'Course');
		updateTask(alice, task.id, {
			planned: dateOnly('2026-11-02'),
			recurrence: rule({ frequency: 'weekly', end: { kind: 'count', count: 2 } })
		});

		deleteTask(alice, task.id, 'occurrence');
		const [second] = getListTasks(alice, list.id);
		expect(second.occurrencesSoFar).toBe(2);
		const changes = deleteTask(alice, second.id, 'occurrence')!;

		expect(changes.upserted).toEqual([]);
		expect(getListTasks(alice, list.id)).toEqual([]);
	});

	it('counts a completion-anchored rule from the skip', () => {
		const { alice, list } = setUp();
		const task = add(alice, list.id, 'Haircut');
		updateTask(alice, task.id, {
			planned: dateOnly('2026-11-01'),
			recurrence: rule({ frequency: 'daily', interval: 10, anchor: 'completion' })
		});

		deleteTask(alice, task.id, 'occurrence', new Date('2026-11-04T23:30:00Z'), 'Europe/Berlin');

		expect(planned(getListTasks(alice, list.id)[0])).toEqual({ kind: 'date', date: '2026-11-15' });
	});
});

describe('deleting This and all future', () => {
	it('deletes the current Occurrence with its Subtasks and ends the Recurrence', () => {
		const { alice, list } = setUp();
		const task = waterPlants(alice, list.id);
		const fern = add(alice, list.id, 'Fern', task.id);
		const previous = completeAndGetNext(alice, task.id);

		const changes = deleteTask(alice, previous.id, 'future')!;

		expect(changes.upserted.filter((t) => t.completedAt === null)).toEqual([]);
		expect(openTasksOf(getListTasks(alice, list.id).map(serializeTask), list.id)).toEqual([]);
		// The Completed Occurrence stays in the history.
		expect(getTask(alice, task.id)?.completedAt).not.toBeNull();
		expect(getTask(alice, fern.id)).toBeDefined();
	});

	it('is the default', () => {
		const { alice, list } = setUp();
		const task = waterPlants(alice, list.id);

		deleteTask(alice, task.id);

		expect(getListTasks(alice, list.id)).toEqual([]);
	});
});

describe('Undo of deleting a recurring Task', () => {
	/** Deletes and returns what the browser keeps for Undo, through JSON like the browser's copy. */
	function deleteForUndo(scope: UserScope, id: string, applyTo: ApplyTo) {
		const changes = deleteTask(scope, id, applyTo)!;
		const removed = JSON.parse(JSON.stringify(changes.removed.map(serializeTask)));
		return { removed: parseRestoredTasks(removed), next: changes.nextOccurrenceId };
	}

	it('of This Occurrence brings the skipped Occurrence back in place of the next one', () => {
		const { alice, list } = setUp();
		const task = waterPlants(alice, list.id);
		add(alice, list.id, 'Fern', task.id);
		updateTask(alice, task.id, { planned: dateOnly('2026-11-03') }, 'occurrence');
		const { removed, next } = deleteForUndo(alice, task.id, 'occurrence');
		expect(next).not.toBeNull();
		const nextFern = getListTasks(alice, list.id).find((t) => t.parentId === next)!;

		const changes = restoreTasks(alice, removed, next!)!;

		expect(changes.deleted.sort()).toEqual([next, nextFern.id].sort());
		expect(getTask(alice, next!)).toBeUndefined();
		const restored = getTask(alice, task.id)!;
		expect(restored).toMatchObject({ occurrencesSoFar: 1, completedAt: null });
		expect(planned(restored)).toEqual({ kind: 'date', date: '2026-11-03' });
		expect(
			getListTasks(alice, list.id)
				.map((t) => t.title)
				.sort()
		).toEqual(['Fern', 'Water plants']);
		// And the series goes on from the template as before.
		const again = completeAndGetNext(alice, task.id);
		expect(again.occurrencesSoFar).toBe(2);
		expect(planned(again)).toEqual({ kind: 'date', date: '2026-11-09' });
	});

	it('of This Occurrence when the series had ended just brings it back', () => {
		const { alice, list } = setUp();
		const task = add(alice, list.id, 'Course');
		updateTask(alice, task.id, {
			planned: dateOnly('2026-11-02'),
			recurrence: rule({ frequency: 'weekly', end: { kind: 'count', count: 1 } })
		});
		const { removed, next } = deleteForUndo(alice, task.id, 'occurrence');
		expect(next).toBeNull();

		restoreTasks(alice, removed);

		expect(getListTasks(alice, list.id).map((t) => t.id)).toEqual([task.id]);
	});

	it('of This Occurrence is refused once the next Occurrence was changed', () => {
		const { alice, list } = setUp();
		const task = waterPlants(alice, list.id);
		const { removed, next } = deleteForUndo(alice, task.id, 'occurrence');
		updateTask(alice, next!, { title: 'Water the ferns' });

		expect(() => restoreTasks(alice, removed, next!)).toThrow(RestoreConflictError);
		expect(getTask(alice, task.id)).toBeUndefined();
		expect(getTask(alice, next!)?.title).toBe('Water the ferns');
	});

	it('only replaces an open Occurrence of the same series, of the same User', () => {
		const { db, alice, list } = setUp();
		const task = waterPlants(alice, list.id);
		const other = waterPlants(alice, list.id);
		const { removed } = deleteForUndo(alice, task.id, 'occurrence');
		const bob: UserScope = { db, userId: insertUser(db, 'bob').id };
		const bobsList = createList(bob, { name: 'Bob' });
		const bobs = waterPlants(bob, bobsList.id);

		expect(() => restoreTasks(alice, removed, other.id)).toThrow(RestoreConflictError);
		expect(() => restoreTasks(alice, removed, bobs.id)).toThrow(RestoreConflictError);
		expect(getTask(bob, bobs.id)).toBeDefined();
		expect(getTask(alice, other.id)).toBeDefined();
	});

	it('of This and all future restores the series as it was', () => {
		const { alice, list } = setUp();
		const task = waterPlants(alice, list.id);
		updateTask(alice, task.id, { title: 'Water the ferns' }, 'occurrence');
		const { removed, next } = deleteForUndo(alice, task.id, 'future');
		expect(next).toBeNull();

		restoreTasks(alice, removed);

		expect(getTask(alice, task.id)).toMatchObject({ seriesId: task.seriesId });
		expect(completeAndGetNext(alice, task.id).title).toBe('Water plants');
	});
});
