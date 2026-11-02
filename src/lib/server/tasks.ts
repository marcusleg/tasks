/**
 * Data access for Tasks. Every function takes a {@link UserScope} and filters by its User
 * (README → "Data access: always scope by User"), so another User's id matches nothing.
 *
 * Mutations return a {@link TaskChangeSet}: everything they created, changed or deleted. Rules that
 * touch several Tasks at once (the completion cascade in #7, the next Occurrence in #16) belong in
 * these functions, and the browser applies whatever comes back.
 */
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
import { InvalidInputError, isId } from '#lib/domain/validation.js';
import { dueColumns, plannedColumns, toTask } from './db/mapping.js';
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
	return { upserted: [toTask(row)], deleted: [] };
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
	if (Object.keys(values).length === 0) {
		const task = getTask(scope, id);
		return task && { upserted: [task], deleted: [] };
	}
	// #16: an edited Occurrence no longer replaces itself on Reopen.
	values.changedSinceGenerated = true;

	const row = scope.db
		.update(tasks)
		.set(values)
		.where(owned(scope, eq(tasks.id, id)))
		.returning()
		.get();
	return row && { upserted: [toTask(row)], deleted: [] };
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

/** Writes completion changes in one transaction and returns the changed Tasks. */
function applyCompletionChanges(
	scope: UserScope,
	changes: CompletionChange<Date>[]
): TaskChangeSet {
	const upserted = scope.db.transaction((tx) =>
		changes.map(({ id, ...values }) =>
			toTask(
				tx
					.update(tasks)
					.set(values)
					.where(owned(scope, eq(tasks.id, id)))
					.returning()
					.get()
			)
		)
	);
	return { upserted, deleted: [] };
}

/**
 * Marks a Task Completed, and with it all of its open Subtasks (marked as closed by the cascade,
 * so Reopen can restore exactly those). Completing the last open Subtask leaves the parent open.
 * Completing an already Completed Task changes nothing. `undefined` if the Task isn't the User's.
 *
 * #16 adds the next Occurrence here.
 */
export function completeTask(
	scope: UserScope,
	id: string,
	now: Date = new Date()
): TaskChangeSet | undefined {
	const task = getTask(scope, id);
	if (!task) return undefined;
	return applyCompletionChanges(scope, completionChanges(familyOf(scope, task), id, now));
}

/**
 * Reopens a Completed Task: a parent together with the Subtasks its completion closed, a Subtask
 * together with its parent if that is Completed (see `reopenChanges`). Reopening an open Task
 * changes nothing. `undefined` if the Task isn't the User's.
 *
 * #16 adds the Occurrence rules.
 */
export function reopenTask(scope: UserScope, id: string): TaskChangeSet | undefined {
	const task = getTask(scope, id);
	if (!task) return undefined;
	return applyCompletionChanges(scope, reopenChanges(familyOf(scope, task), id));
}

/**
 * Moves a Task in Custom Order (see `moveChanges` in `#lib/domain/moves.ts`): among its siblings,
 * under another top-level Task of the target List (it becomes a Subtask), out of its parent, or to
 * another of the User's Lists, where its Subtasks follow it. Only the moved Task gets a new
 * position. `undefined` if the Task or the target List isn't the User's. Throws
 * `InvalidInputError` for a move the rules don't allow (one level deep, Recurrence, Completed
 * Tasks, unknown parent or neighbour).
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
		return { upserted, deleted: [] };
	});
}

/** Deletes a Task and its Subtasks. `undefined` if the Task isn't the User's. */
export function deleteTask(scope: UserScope, id: string): TaskChangeSet | undefined {
	const task = getTask(scope, id);
	if (!task) return undefined;

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
	return { upserted: [], deleted: [id, ...subtaskIds] };
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
