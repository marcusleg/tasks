/**
 * Data access for Tasks. Every function takes a {@link UserScope} and filters by its User
 * (README → "Data access: always scope by User"), so another User's id matches nothing.
 *
 * Mutations return a {@link TaskChangeSet}: everything they created, changed or deleted. Rules that
 * touch several Tasks at once (the completion cascade in #7, the next Occurrence in #16) belong in
 * these functions, and the browser applies whatever comes back.
 */
import { and, asc, eq, inArray, isNotNull, isNull, type SQL } from 'drizzle-orm';
import { generateKeyBetween } from 'fractional-indexing';
import {
	parseDescription,
	parseTitle,
	serializeTask,
	type Task,
	type TaskChanges
} from '#lib/domain/tasks.js';
import { InvalidInputError, isId } from '#lib/domain/validation.js';
import { toTask } from './db/mapping.js';
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

/** The first position among the siblings in (list, parent), or `null` if there are none. */
function firstPosition(scope: UserScope, listId: string, parentId: string | null): string | null {
	const row = scope.db
		.select({ position: tasks.position })
		.from(tasks)
		.where(
			owned(
				scope,
				eq(tasks.listId, listId),
				parentId === null ? isNull(tasks.parentId) : eq(tasks.parentId, parentId)
			)
		)
		.orderBy(asc(tasks.position))
		.limit(1)
		.get();
	return row?.position ?? null;
}

export interface NewTask {
	/** Client-generated id (see `newId`), so an optimistic UI can use it right away. */
	id?: string;
	listId: string;
	title: string;
	description?: string;
	/** Makes the Task a Subtask of this top-level Task, which must be in the same List. */
	parentId?: string | null;
}

/**
 * Creates a Task at the top of its List's Custom Order (or its parent's, for a Subtask).
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
		if (parent.parentId !== null) {
			throw new InvalidInputError('A Subtask cannot have Subtasks of its own');
		}
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
			position: generateKeyBetween(null, firstPosition(scope, input.listId, parentId))
		})
		.returning()
		.get();
	return { upserted: [toTask(row)], deleted: [] };
}

export interface TaskPatch {
	title?: string;
	description?: string;
}

/** Changes a Task's Title and/or Description. `undefined` if it isn't the User's. */
export function updateTask(
	scope: UserScope,
	id: string,
	patch: TaskPatch
): TaskChangeSet | undefined {
	const values: Partial<typeof tasks.$inferInsert> = {};
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
 * Marks a Task Completed. Completing an already Completed Task changes nothing.
 * `undefined` if the Task isn't the User's.
 *
 * #7 adds the cascade to Subtasks here, #16 the next Occurrence.
 */
export function completeTask(
	scope: UserScope,
	id: string,
	now: Date = new Date()
): TaskChangeSet | undefined {
	const task = getTask(scope, id);
	if (!task) return undefined;
	if (task.completedAt) return noChanges();

	const row = scope.db
		.update(tasks)
		.set({ completedAt: now, completedByCascade: false })
		.where(owned(scope, eq(tasks.id, id)))
		.returning()
		.get();
	return { upserted: [toTask(row)], deleted: [] };
}

/**
 * Reopens a Completed Task. Reopening an open Task changes nothing. `undefined` if the Task isn't
 * the User's.
 *
 * #7 adds reopening the Subtasks its completion closed, #16 the Occurrence rules.
 */
export function reopenTask(scope: UserScope, id: string): TaskChangeSet | undefined {
	const task = getTask(scope, id);
	if (!task) return undefined;
	if (!task.completedAt) return noChanges();

	const row = scope.db
		.update(tasks)
		.set({ completedAt: null, completedByCascade: false })
		.where(owned(scope, eq(tasks.id, id)))
		.returning()
		.get();
	return { upserted: [toTask(row)], deleted: [] };
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
