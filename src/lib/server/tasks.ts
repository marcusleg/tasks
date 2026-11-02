/**
 * Data access for Tasks. Every function takes a {@link UserScope} and filters by its User
 * (README → "Data access: always scope by User"), so another User's id matches nothing.
 *
 * Mutations return a {@link TaskChangeSet}: everything they created, changed or deleted. Rules that
 * touch several Tasks at once (the completion cascade in #7, the next Occurrence in #16) belong in
 * these functions, and the browser applies whatever comes back.
 */
import { generateKeyBetween } from 'fractional-indexing';
import { Temporal } from 'temporal-polyfill';
import { and, asc, eq, inArray, isNotNull, isNull, or, type SQL } from 'drizzle-orm';
import type { DueDate, PlannedDate } from '#lib/domain/dates.js';
import {
	parseDescription,
	parseTitle,
	serializeTask,
	type Priority,
	type Task,
	type TaskChanges
} from '#lib/domain/tasks.js';
import {
	completionChanges,
	nestingError,
	newTaskPosition,
	reopenChanges,
	type CompletionChange
} from '#lib/domain/subtasks.js';
import { moveChanges, type TaskMove } from '#lib/domain/moves.js';
import { comparePositions } from '#lib/domain/lists.js';
import { InvalidInputError, isId } from '#lib/domain/validation.js';
import { shiftByDays, stepDriver, type RecurrenceRule } from '#lib/domain/recurrence.js';
import {
	hasDate,
	NEEDS_A_DATE,
	nextOccurrenceStep,
	RECURRENCE_CONFLICT_MESSAGES,
	recurrenceConflict,
	withDrivingDefaults
} from '#lib/domain/recurring-tasks.js';
import { dueColumns, plannedColumns, recurrenceColumn, taskColumns, toTask } from './db/mapping.js';
import { tasks } from './db/schema.js';
import { getList } from './lists.js';
import { ownedBy, type UserScope } from './scope.js';

export interface TaskChangeSet {
	upserted: Task[];
	deleted: string[];
}

export function serializeChanges(changes: TaskChangeSet): TaskChanges {
	return { upserted: changes.upserted.map(serializeTask), deleted: changes.deleted };
}

const noChanges = (): TaskChangeSet => ({ upserted: [], deleted: [] });

/** A change set from Tasks written in order: a Task written twice is listed once, as last written. */
function changeSet(upserted: Task[], deleted: string[] = []): TaskChangeSet {
	const latest = new Map(upserted.map((task) => [task.id, task]));
	return { upserted: [...latest.values()], deleted };
}

function owned(scope: UserScope, ...conditions: SQL[]): SQL {
	return and(ownedBy(tasks.userId, scope), ...conditions) as SQL;
}

/** Every Task of one of the User's Lists (open and Completed, Subtasks included), in Custom Order. */
export function getListTasks(scope: UserScope, listId: string): Task[] {
	return getTasksOfLists(scope, [listId]);
}

/** Every Task of the given Lists of the User, in Custom Order (e.g. for the multi-List columns). */
export function getTasksOfLists(scope: UserScope, listIds: string[]): Task[] {
	if (listIds.length === 0) return [];
	return scope.db
		.select()
		.from(tasks)
		.where(owned(scope, inArray(tasks.listId, listIds)))
		.orderBy(asc(tasks.position), asc(tasks.id))
		.all()
		.map(toTask);
}

/** One of the User's Tasks, or `undefined`. */
export function getTask(scope: UserScope, id: string): Task | undefined {
	const row = scope.db
		.select()
		.from(tasks)
		.where(owned(scope, eq(tasks.id, id)))
		.get();
	return row && toTask(row);
}

/** The positions of the siblings in (list, parent), to place a new Task among them. */
function siblingPositions(
	scope: UserScope,
	listId: string,
	parentId: string | null
): { position: string }[] {
	return scope.db
		.select({ position: tasks.position })
		.from(tasks)
		.where(
			owned(
				scope,
				eq(tasks.listId, listId),
				parentId === null ? isNull(tasks.parentId) : eq(tasks.parentId, parentId)
			)
		)
		.all();
}

export interface NewTask {
	/** Client-generated id (see `newId`), so an optimistic UI can use it right away. */
	id?: string;
	listId: string;
	title: string;
	description?: string;
	/** Makes the Task a Subtask of this open top-level Task, which must be in the same List. */
	parentId?: string | null;
	planned?: PlannedDate;
	due?: DueDate;
	priority?: Priority | null;
}

/**
 * Creates a Task at the top of its List's Custom Order, or a Subtask at the bottom of its parent's
 * Subtasks. The parent must be an open top-level Task (see `nestingError`).
 * Returns `undefined` when the List or parent isn't the User's. Throws `InvalidInputError`.
 */
export function createTask(scope: UserScope, input: NewTask): TaskChangeSet | undefined {
	if (input.id !== undefined && !isId(input.id)) throw new InvalidInputError('Invalid id');
	const title = parseTitle(input.title);
	const description = parseDescription(input.description ?? '');
	if (!getList(scope, input.listId)) return undefined;

	const parentId = input.parentId ?? null;
	if (parentId !== null) {
		const parent = getTask(scope, parentId);
		if (!parent || parent.listId !== input.listId) return undefined;
		const problem = nestingError(parent);
		if (problem) throw new InvalidInputError(problem);
	}

	return scope.db.transaction(() => {
		const row = scope.db
			.insert(tasks)
			.values({
				id: input.id,
				userId: scope.userId,
				listId: input.listId,
				parentId,
				title,
				description,
				position: newTaskPosition(siblingPositions(scope, input.listId, parentId), parentId),
				...dateAndPriorityColumns(input)
			})
			.returning()
			.get();
		return changeSet([toTask(row), ...markChanged(scope, parentId)]);
	});
}

/**
 * Records that the User changed the Occurrence with this id (#16): it no longer gives way to the
 * Occurrence before it when that one is reopened (CONTEXT.md → Reopen). Every User change to a
 * Task or its Subtasks lands here: field edits mark the Task itself, and adding, editing,
 * completing, reopening, deleting or moving a Subtask marks its parent. Completing or reopening a
 * Task itself doesn't count, so Undo of a completion still restores the previous Occurrence.
 *
 * Returns the Tasks that weren't marked before. `null` (no parent) does nothing.
 */
function markChanged(scope: UserScope, id: string | null): Task[] {
	if (id === null) return [];
	return scope.db
		.update(tasks)
		.set({ changedSinceGenerated: true })
		.where(owned(scope, eq(tasks.id, id), eq(tasks.changedSinceGenerated, false)))
		.returning()
		.all()
		.map(toTask);
}

export interface TaskPatch {
	title?: string;
	description?: string;
	/**
	 * Saved as given, zone included: the browser sends its own zone only for a date it just edited,
	 * so changing other fields never moves a timed date to another zone.
	 */
	planned?: PlannedDate;
	due?: DueDate;
	priority?: Priority | null;
	/**
	 * A new Recurrence, or `null` to stop repeating. The weekdays or month day of the driving date
	 * are filled in when the rule doesn't name them (`withDrivingDefaults`).
	 */
	recurrence?: RecurrenceRule | null;
}

/** The columns for whichever of the dates and Priority are given. */
function dateAndPriorityColumns(
	fields: Pick<TaskPatch, 'planned' | 'due' | 'priority'>
): Partial<typeof tasks.$inferInsert> {
	return {
		...(fields.planned && plannedColumns(fields.planned)),
		...(fields.due && dueColumns(fields.due)),
		...(fields.priority !== undefined && { priority: fields.priority })
	};
}

/** Changes a Task's Title, Description, dates or Priority. `undefined` if it isn't the User's. */
export function updateTask(
	scope: UserScope,
	id: string,
	patch: TaskPatch
): TaskChangeSet | undefined {
	const values: Partial<typeof tasks.$inferInsert> = dateAndPriorityColumns(patch);
	if (patch.title !== undefined) values.title = parseTitle(patch.title);
	if (patch.description !== undefined) values.description = parseDescription(patch.description);
	if (Object.keys(values).length === 0 && patch.recurrence === undefined) {
		const task = getTask(scope, id);
		return task && { upserted: [task], deleted: [] };
	}

	return scope.db.transaction(() => {
		const task = getTask(scope, id);
		if (!task) return undefined;
		Object.assign(values, recurrenceColumns(scope, task, patch));
		// An edited Occurrence no longer gives way to the one before it on Reopen.
		values.changedSinceGenerated = true;
		const row = scope.db
			.update(tasks)
			.set(values)
			.where(owned(scope, eq(tasks.id, id)))
			.returning()
			.get();
		return changeSet([toTask(row), ...markChanged(scope, task.parentId)]);
	});
}

const COMPLETED_CANT_START_RECURRENCE =
	'A Completed Task can’t get a Recurrence. Reopen the task first';

/** The Recurrence columns a patch changes. */
function recurrenceColumns(
	scope: UserScope,
	task: Task,
	patch: TaskPatch
): Partial<typeof tasks.$inferInsert> {
	const dates = { planned: patch.planned ?? task.planned, due: patch.due ?? task.due };
	const recurs = patch.recurrence === undefined ? task.recurrence !== null : !!patch.recurrence;
	if (recurs && !hasDate(dates)) throw new InvalidInputError(NEEDS_A_DATE);
	if (patch.recurrence === undefined) return {};
	if (patch.recurrence === null) return { recurrence: null, seriesId: null };
	// The next Occurrence is created on completion, so a Completed Task can't start a series.
	if (task.completedAt) throw new InvalidInputError(COMPLETED_CANT_START_RECURRENCE);
	const conflict = recurrenceConflict(task, familyOf(scope, task));
	if (conflict) throw new InvalidInputError(RECURRENCE_CONFLICT_MESSAGES[conflict]);
	const rule = withDrivingDefaults(patch.recurrence, dates);
	return {
		...recurrenceColumn(rule),
		...(task.recurrence === null || task.seriesId === null
			? { seriesId: crypto.randomUUID(), occurrencesSoFar: 1 }
			: {})
	};
}

/**
 * The Task's family: its parent (if it is a Subtask) or itself, and all of that one's Subtasks.
 * The completion rules (`#lib/domain/subtasks.ts`) work on these.
 */
function familyOf(scope: UserScope, task: Task): Task[] {
	const rootId = task.parentId ?? task.id;
	return scope.db
		.select()
		.from(tasks)
		.where(owned(scope, or(eq(tasks.id, rootId), eq(tasks.parentId, rootId)) as SQL))
		.all()
		.map(toTask);
}

/** Writes completion changes and returns the changed Tasks. Call it inside a transaction. */
function applyCompletionChanges(scope: UserScope, changes: CompletionChange<Date>[]): Task[] {
	return changes.map(({ id, ...values }) =>
		toTask(
			scope.db
				.update(tasks)
				.set(values)
				.where(owned(scope, eq(tasks.id, id)))
				.returning()
				.get()
		)
	);
}

/**
 * Marks a Task Completed, and with it all of its open Subtasks (marked as closed by the cascade,
 * so Reopen can restore exactly those). Completing the last open Subtask leaves the parent open.
 * Completing an already Completed Task changes nothing. `undefined` if the Task isn't the User's.
 *
 * Completing an Occurrence of a recurring Task also creates the next Occurrence (see
 * {@link createNextOccurrence}); a recurring Subtask closed by its parent's cascade gets none.
 * `timeZone` is the completing browser's zone: completion-anchored Recurrences read the completion
 * date of a date-only Task in it (a timed one is read in its own zone). Without it, the driving
 * date's zone is used, or UTC for a date-only one.
 */
export function completeTask(
	scope: UserScope,
	id: string,
	now: Date = new Date(),
	timeZone?: string
): TaskChangeSet | undefined {
	const task = getTask(scope, id);
	if (!task) return undefined;
	return scope.db.transaction(() => {
		const family = familyOf(scope, task);
		const changes = completionChanges(family, id, now);
		const upserted = applyCompletionChanges(scope, changes);
		if (changes.length > 0 && task.recurrence) {
			upserted.push(
				...createNextOccurrence(
					scope,
					{ ...task, recurrence: task.recurrence },
					family,
					now,
					timeZone
				)
			);
		}
		if (changes.length > 0) upserted.push(...markChanged(scope, task.parentId));
		return changeSet(upserted);
	});
}

/** The completion instant as the Recurrence module wants it (see {@link completeTask}). */
function completionInstant(task: Task, now: Date, timeZone: string | undefined) {
	const driver = task[stepDriver(task)];
	const zone = timeZone ?? (driver.kind === 'timed' ? driver.timeZone : 'UTC');
	return Temporal.Instant.fromEpochMilliseconds(now.getTime()).toZonedDateTimeISO(zone);
}

/**
 * Creates the Occurrence after a just-Completed one, unless its Recurrence has ended: an open
 * Task with the same fields and Recurrence, in the same List and parent, placed right after the
 * Completed one in Custom Order so it takes its place among the open Tasks. Its Subtasks are
 * copies of the Completed one's, reopened, with their dates shifted by the same number of days as
 * the Occurrence's own step. Returns the created Tasks.
 */
function createNextOccurrence(
	scope: UserScope,
	completed: Task & { recurrence: RecurrenceRule },
	family: Task[],
	now: Date,
	timeZone: string | undefined
): Task[] {
	if (!hasDate(completed)) return [];
	const step = nextOccurrenceStep(completed, completionInstant(completed, now, timeZone));
	if (!step) return [];

	const after = siblingPositions(scope, completed.listId, completed.parentId)
		.map((sibling) => sibling.position)
		.filter((position) => comparePositions(position, completed.position) > 0)
		.sort(comparePositions)[0];
	const insert = (task: Task) =>
		toTask(
			scope.db
				.insert(tasks)
				.values({
					...taskColumns(task),
					id: crypto.randomUUID(),
					userId: scope.userId,
					listId: completed.listId
				})
				.returning()
				.get()
		);
	const next = insert({
		...completed,
		position: generateKeyBetween(completed.position, after ?? null),
		planned: step.planned,
		due: step.due,
		completedAt: null,
		completedByCascade: false,
		occurrencesSoFar: completed.occurrencesSoFar + 1,
		generatedFromTaskId: completed.id,
		changedSinceGenerated: false
	});
	const subtasks = family
		.filter((task) => task.parentId === completed.id)
		.map((subtask) =>
			insert({
				...subtask,
				parentId: next.id,
				planned: shiftByDays(subtask.planned, step.days),
				due: shiftByDays(subtask.due, step.days),
				completedAt: null,
				completedByCascade: false,
				// A recurring parent's Subtasks don't recur (exclusivity), not even reopened copies.
				recurrence: null,
				seriesId: null,
				occurrencesSoFar: 1,
				generatedFromTaskId: null,
				changedSinceGenerated: false,
				seriesTemplate: null
			})
		);
	return [next, ...subtasks];
}

/**
 * Reopens a Completed Task: a parent together with the Subtasks its completion closed, a Subtask
 * together with its parent if that is Completed (see `reopenChanges`). Reopening an open Task
 * changes nothing. `undefined` if the Task isn't the User's.
 *
 * A reopened Occurrence follows CONTEXT.md → Reopen (see {@link reopenOccurrence}).
 */
export function reopenTask(scope: UserScope, id: string): TaskChangeSet | undefined {
	const task = getTask(scope, id);
	if (!task) return undefined;
	return scope.db.transaction(() => {
		const family = familyOf(scope, task);
		const changes = reopenChanges(family, id);
		const upserted = applyCompletionChanges(scope, changes);
		const deleted: string[] = [];
		for (const change of changes) {
			const before = family.find((candidate) => candidate.id === change.id);
			if (change.completedAt !== null || !before) continue;
			const outcome = reopenOccurrence(scope, before);
			upserted.push(...outcome.upserted);
			deleted.push(...outcome.deleted);
		}
		if (changes.length > 0) upserted.push(...markChanged(scope, task.parentId));
		return changeSet(upserted, deleted);
	});
}

/**
 * Moves a Task in Custom Order (see `moveChanges` in `#lib/domain/moves.ts`): among its siblings,
 * under another top-level Task of the target List (it becomes a Subtask), out of its parent, or to
 * another of the User's Lists, where its Subtasks follow it. Only the moved Task gets a new
 * position. `undefined` if the Task or the target List isn't the User's. Throws
 * `InvalidInputError` for a move the rules don't allow (one level deep, Recurrence, Completed
 * Tasks, unknown parent or neighbour). A move that changes anything marks the moved Task and its
 * old and new parent as changed since generated (`markChanged`).
 */
export function moveTask(scope: UserScope, id: string, move: TaskMove): TaskChangeSet | undefined {
	const task = getTask(scope, id);
	if (!task || !getList(scope, move.listId)) return undefined;

	// better-sqlite3 runs on one connection, so these reads are part of the transaction.
	return scope.db.transaction((tx) => {
		const changes = moveChanges(
			getTasksOfLists(scope, [...new Set([task.listId, move.listId])]),
			id,
			move
		);
		const upserted = changes.map(({ id, ...values }) =>
			toTask(
				tx
					.update(tasks)
					.set(values)
					.where(owned(scope, eq(tasks.id, id)))
					.returning()
					.get()
			)
		);
		const [moved] = changes;
		const actuallyMoved =
			moved.listId !== task.listId ||
			moved.parentId !== task.parentId ||
			moved.position !== task.position;
		if (actuallyMoved) {
			// The moved Task, and the parents it left and joined, count as changed by the User.
			for (const changedId of new Set([task.id, task.parentId, moved.parentId])) {
				upserted.push(...markChanged(scope, changedId));
			}
		}
		return changeSet(upserted);
	});
}

/**
 * The Occurrence rules of Reopen, for a Task that was Completed and has just been reopened. If
 * it is the Occurrence that created the current one, and the User hasn't changed that one, the
 * current Occurrence (with its Subtasks) is deleted and the reopened one is current again. Any
 * other reopened Occurrence comes back as a one-off Task without Recurrence.
 *
 * A recurring Subtask closed by its parent's completion created no next Occurrence; it keeps
 * its Recurrence, which continues.
 */
function reopenOccurrence(scope: UserScope, reopened: Task): TaskChangeSet {
	if (!reopened.recurrence || reopened.completedByCascade) return noChanges();
	const current = scope.db
		.select()
		.from(tasks)
		.where(owned(scope, eq(tasks.generatedFromTaskId, reopened.id), isNull(tasks.completedAt)))
		.get();
	if (current && !current.changedSinceGenerated) {
		return { upserted: [], deleted: deleteWithSubtasks(scope, current.id) };
	}
	const oneOff = scope.db
		.update(tasks)
		.set({ recurrence: null, seriesId: null })
		.where(owned(scope, eq(tasks.id, reopened.id)))
		.returning()
		.get();
	return { upserted: [toTask(oneOff)], deleted: [] };
}

/** Deletes a Task and its Subtasks; returns their ids. */
function deleteWithSubtasks(scope: UserScope, id: string): string[] {
	const subtaskIds = scope.db
		.select({ id: tasks.id })
		.from(tasks)
		.where(owned(scope, eq(tasks.parentId, id)))
		.all()
		.map((row) => row.id);
	scope.db
		.delete(tasks)
		.where(owned(scope, eq(tasks.id, id)))
		.run();
	return [id, ...subtaskIds];
}

/** What {@link deleteTask} removed, with the Tasks as they were, so Undo can restore them. */
export interface DeletedTasks extends TaskChangeSet {
	/** The deleted Task first, then its Subtasks in Custom Order. */
	removed: Task[];
}

/**
 * Deletes a Task and its Subtasks, and returns them as they were (for `restoreTasks`).
 * `undefined` if the Task isn't the User's.
 */
export function deleteTask(scope: UserScope, id: string): DeletedTasks | undefined {
	return scope.db.transaction((tx) => {
		const task = getTask(scope, id);
		if (!task) return undefined;

		const subtasks = tx
			.select()
			.from(tasks)
			.where(owned(scope, eq(tasks.parentId, id)))
			.orderBy(asc(tasks.position), asc(tasks.id))
			.all()
			.map(toTask);
		const deleted = deleteWithSubtasks(scope, id);
		const removed = [task, ...subtasks];
		return { ...changeSet(markChanged(scope, task.parentId), deleted), removed };
	});
}

/**
 * Deletes every Completed Task of a List (and, by cascade, their Subtasks). Open Tasks and other
 * Lists are untouched. `undefined` if the List isn't the User's.
 */
export function deleteCompletedTasks(scope: UserScope, listId: string): TaskChangeSet | undefined {
	if (!getList(scope, listId)) return undefined;

	return scope.db.transaction((tx) => {
		const completed = tx
			.select({ id: tasks.id })
			.from(tasks)
			.where(owned(scope, eq(tasks.listId, listId), isNotNull(tasks.completedAt)))
			.all()
			.map((row) => row.id);
		if (completed.length === 0) return noChanges();

		const subtasks = tx
			.select({ id: tasks.id })
			.from(tasks)
			.where(owned(scope, inArray(tasks.parentId, completed)))
			.all()
			.map((row) => row.id);
		tx.delete(tasks)
			.where(owned(scope, inArray(tasks.id, completed)))
			.run();
		return { upserted: [], deleted: [...new Set([...completed, ...subtasks])] };
	});
}

export interface PriorityViewTasks {
	/** The Priority View's Tasks: open Tasks and Subtasks with a Priority, in any List. */
	tasks: Task[];
	/**
	 * What the rows and the detail panel need besides: the parents of those Subtasks (for the
	 * breadcrumb) and all Subtasks of those that are top-level Tasks.
	 */
	related: Task[];
}

/** The open Tasks of the User that have a Priority, across all Lists (uses the partial index). */
export function getPriorityViewTasks(scope: UserScope): PriorityViewTasks {
	const matches = scope.db
		.select()
		.from(tasks)
		.where(owned(scope, isNull(tasks.completedAt), isNotNull(tasks.priority)))
		.orderBy(asc(tasks.position), asc(tasks.id))
		.all()
		.map(toTask);
	const have = new Set(matches.map((task) => task.id));
	const parentIds = [
		...new Set(
			matches.flatMap((task) => (task.parentId && !have.has(task.parentId) ? [task.parentId] : []))
		)
	];
	const topLevelIds = matches.filter((task) => task.parentId === null).map((task) => task.id);
	const related = (ids: string[], column: typeof tasks.id | typeof tasks.parentId) =>
		ids.length === 0
			? []
			: scope.db
					.select()
					.from(tasks)
					.where(owned(scope, inArray(column, ids)))
					.all()
					.map(toTask);
	const extra = new Map<string, Task>();
	for (const task of [...related(parentIds, tasks.id), ...related(topLevelIds, tasks.parentId)]) {
		if (!have.has(task.id)) extra.set(task.id, task);
	}
	return { tasks: matches, related: [...extra.values()] };
}
