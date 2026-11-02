/**
 * Undo for deleting a Task (#14): `DELETE /api/tasks/[id]` answers with the deleted Tasks, and
 * `POST /api/tasks/restore` puts them back exactly as they were, ids, positions, dates, completion
 * and Recurrence fields included.
 *
 * The Tasks come back from the browser, so they are validated as strictly as any other input:
 * every field is parsed, ownership comes from the {@link UserScope} (never from the body), the
 * List and any parent outside the batch must still be the User's, and an id that is taken makes
 * the whole restore fail with a clash instead of overwriting anything.
 *
 * Undo of skipping an Occurrence ("This Occurrence", #17) restores the skipped one and removes the
 * Occurrence that took its place (`replaces`), in one transaction.
 */
import { and, eq, inArray, type SQL } from 'drizzle-orm';
import { InvalidDateError, parseDueDate, parsePlannedDate } from '#lib/domain/dates.js';
import { isPositionKey } from '#lib/domain/moves.js';
import { InvalidRecurrenceError, parseRecurrence } from '#lib/domain/recurrence.js';
import {
	isPriority,
	parseDescription,
	parseSeriesTemplate,
	parseTitle,
	type Task
} from '#lib/domain/tasks.js';
import { InvalidInputError, isId } from '#lib/domain/validation.js';
import { taskColumns, toTask } from './db/mapping.js';
import { tasks } from './db/schema.js';
import { getList } from './lists.js';
import { ownedBy, type UserScope } from './scope.js';
import type { TaskChangeSet } from './tasks.js';

/** A Task with Subtasks is at most this many Tasks (a generous bound against huge bodies). */
export const MAX_RESTORED_TASKS = 1000;
const MAX_SERIES_TEMPLATE_LENGTH = 20_000;
const SERIES_ID = /^[0-9A-Za-z_-]{1,64}$/;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/** The restore can't happen in the current state (the parent is gone, Completed, …): a 409. */
export class RestoreConflictError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'RestoreConflictError';
	}
}

type Fields = Record<string, unknown>;

function invalid(index: number, message: string): never {
	throw new InvalidInputError(`tasks[${index}]: ${message}`);
}

function timestampField(fields: Fields, key: string, index: number): Date {
	const value = fields[key];
	const date = typeof value === 'string' && ISO_TIMESTAMP.test(value) ? new Date(value) : null;
	if (!date || Number.isNaN(date.getTime())) invalid(index, `${key} must be an ISO timestamp`);
	return date;
}

function booleanField(fields: Fields, key: string, index: number): boolean {
	const value = fields[key];
	if (typeof value !== 'boolean') invalid(index, `${key} must be true or false`);
	return value;
}

function nullableId(fields: Fields, key: string, index: number): string | null {
	const value = fields[key];
	if (value === null) return null;
	if (!isId(value)) invalid(index, `${key} must be an id or null`);
	return value;
}

/** Runs a domain parser, turning its own error type into an `InvalidInputError` for the field. */
function parsed<T>(index: number, key: string, parse: () => T): T {
	try {
		return parse();
	} catch (cause) {
		if (
			cause instanceof InvalidDateError ||
			cause instanceof InvalidRecurrenceError ||
			cause instanceof InvalidInputError
		) {
			invalid(index, `${key}: ${cause.message}`);
		}
		throw cause;
	}
}

/** One serialized Task (the shape `serializeTask` produces). Throws `InvalidInputError`. */
function parseRestoredTask(value: unknown, index: number): Task {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		invalid(index, 'must be a Task');
	}
	const fields = value as Fields;

	if (!isId(fields.id)) invalid(index, 'id must be an id');
	if (typeof fields.listId !== 'string' || fields.listId === '') {
		invalid(index, 'listId is required');
	}
	if (!isPositionKey(fields.position)) invalid(index, 'position must be a Custom Order key');
	if (fields.priority !== null && !isPriority(fields.priority)) {
		invalid(index, 'priority must be high, medium, low or null');
	}
	const seriesId = fields.seriesId;
	if (seriesId !== null && (typeof seriesId !== 'string' || !SERIES_ID.test(seriesId))) {
		invalid(index, 'seriesId must be an id or null');
	}
	const occurrences = fields.occurrencesSoFar;
	if (typeof occurrences !== 'number' || !Number.isInteger(occurrences) || occurrences < 1) {
		invalid(index, 'occurrencesSoFar must be a whole number of at least 1');
	}
	const template = fields.seriesTemplate;
	if (
		template !== null &&
		(typeof template !== 'object' ||
			Array.isArray(template) ||
			JSON.stringify(template).length > MAX_SERIES_TEMPLATE_LENGTH)
	) {
		invalid(index, 'seriesTemplate must be an object or null');
	}
	const completedAt =
		fields.completedAt === null ? null : timestampField(fields, 'completedAt', index);

	return {
		id: fields.id,
		listId: fields.listId,
		parentId: nullableId(fields, 'parentId', index),
		title: parsed(index, 'title', () => parseTitle(fields.title)),
		description: parsed(index, 'description', () => parseDescription(fields.description)),
		position: fields.position,
		planned: parsed(index, 'planned', () => parsePlannedDate(fields.planned)),
		due: parsed(index, 'due', () => parseDueDate(fields.due)),
		priority: fields.priority,
		completedAt,
		completedByCascade: booleanField(fields, 'completedByCascade', index),
		recurrence:
			fields.recurrence === null
				? null
				: parsed(index, 'recurrence', () => parseRecurrence(fields.recurrence)),
		seriesId: seriesId as string | null,
		occurrencesSoFar: occurrences,
		generatedFromTaskId: nullableId(fields, 'generatedFromTaskId', index),
		changedSinceGenerated: booleanField(fields, 'changedSinceGenerated', index),
		seriesTemplate:
			template === null
				? null
				: parsed(index, 'seriesTemplate', () => parseSeriesTemplate(template)),
		createdAt: timestampField(fields, 'createdAt', index),
		updatedAt: timestampField(fields, 'updatedAt', index)
	};
}

/**
 * The Tasks of a restore body's `tasks` field: serialized Tasks of one List, each id once, every
 * parent either top-level in the batch or outside it (checked against the database by
 * {@link restoreTasks}). Throws `InvalidInputError`.
 */
export function parseRestoredTasks(value: unknown): Task[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new InvalidInputError('tasks must be a non-empty list of Tasks');
	}
	if (value.length > MAX_RESTORED_TASKS) {
		throw new InvalidInputError(`At most ${MAX_RESTORED_TASKS} Tasks can be restored at once`);
	}
	const restored = value.map(parseRestoredTask);

	const byId = new Map<string, Task>();
	for (const task of restored) {
		if (byId.has(task.id)) throw new InvalidInputError(`Task ${task.id} is listed twice`);
		byId.set(task.id, task);
	}
	if (new Set(restored.map((task) => task.listId)).size > 1) {
		throw new InvalidInputError('The Tasks must all belong to one List');
	}
	for (const task of restored) {
		if (task.parentId === task.id) throw new InvalidInputError('A Task can’t be its own Subtask');
		const parent = task.parentId === null ? undefined : byId.get(task.parentId);
		if (!parent) continue;
		if (parent.parentId !== null) {
			throw new InvalidInputError('A Subtask can’t have Subtasks of its own');
		}
		if (parent.recurrence && task.recurrence) {
			throw new InvalidInputError('A Task and its Subtasks can’t both recur');
		}
		if (parent.completedAt && !task.completedAt) {
			throw new InvalidInputError('A Completed Task can’t have open Subtasks');
		}
	}
	return restored;
}

/**
 * Puts deleted Tasks back as they were (see {@link parseRestoredTasks} for the input). Returns
 * them as `upserted`, or `undefined` if the List isn't the User's (any more). Throws
 * `RestoreConflictError` when a parent outside the batch is gone, in another List, or doesn't fit
 * the Subtask rules any more, and the primary key constraint error (a 409 through
 * `withInputErrors`) when an id is taken. Nothing is written unless everything fits.
 *
 * `replaces` is the Occurrence that took the place of a skipped one (the first restored Task): it
 * is deleted with its Subtasks, and listed as `deleted`. It must be the User's open Occurrence of
 * the same series, in the same place, and unchanged since it was generated; otherwise
 * `RestoreConflictError`.
 */
export function restoreTasks(
	scope: UserScope,
	restored: Task[],
	replaces?: string
): TaskChangeSet | undefined {
	const listId = restored[0].listId;
	if (!getList(scope, listId)) return undefined;
	const owned = (...conditions: SQL[]) => and(ownedBy(tasks.userId, scope), ...conditions) as SQL;
	const ids = new Set(restored.map((task) => task.id));

	return scope.db.transaction((tx) => {
		/** Deletes the Occurrence `replaces` (and its Subtasks) after checking it may go. */
		const removeReplaced = (id: string): string[] => {
			const skipped = restored[0];
			const row = tx
				.select()
				.from(tasks)
				.where(owned(eq(tasks.id, id)))
				.get();
			const next = row && toTask(row);
			const fits =
				next &&
				!ids.has(id) &&
				skipped.seriesId !== null &&
				next.seriesId === skipped.seriesId &&
				next.listId === skipped.listId &&
				next.parentId === skipped.parentId &&
				next.completedAt === null;
			if (!fits) throw new RestoreConflictError('The next Occurrence isn’t there any more');
			if (next.changedSinceGenerated) {
				throw new RestoreConflictError('The next Occurrence was changed meanwhile');
			}
			const subtaskIds = tx
				.select({ id: tasks.id })
				.from(tasks)
				.where(owned(eq(tasks.parentId, id)))
				.all()
				.map((subtask) => subtask.id);
			tx.delete(tasks)
				.where(owned(eq(tasks.id, id)))
				.run();
			return [id, ...subtaskIds];
		};

		/** The User's Tasks outside the batch that the batch refers to through `wanted`. */
		const outside = (wanted: (task: Task) => string | null) => {
			const lookup = [...new Set(restored.map(wanted))].filter(
				(id): id is string => id !== null && !ids.has(id)
			);
			if (lookup.length === 0) return new Map<string, Task>();
			const rows = tx
				.select()
				.from(tasks)
				.where(owned(inArray(tasks.id, lookup)))
				.all();
			return new Map(rows.map((row) => [row.id, toTask(row)]));
		};

		const parents = outside((task) => task.parentId);
		for (const task of restored) {
			if (task.parentId === null || ids.has(task.parentId)) continue;
			const parent = parents.get(task.parentId);
			if (!parent) throw new RestoreConflictError('The parent Task no longer exists');
			if (parent.listId !== listId) {
				throw new RestoreConflictError('The parent Task is in another List now');
			}
			if (parent.parentId !== null) {
				throw new RestoreConflictError('The parent Task is a Subtask now');
			}
			if (parent.completedAt && !task.completedAt) {
				throw new RestoreConflictError('The parent Task was completed meanwhile');
			}
			if (parent.recurrence && task.recurrence) {
				throw new RestoreConflictError('The parent Task recurs now');
			}
		}

		const deleted = replaces === undefined ? [] : removeReplaced(replaces);

		// The Occurrence a Task was generated from may be gone by now (the column is `set null`).
		const sources = outside((task) => task.generatedFromTaskId);
		const source = (id: string | null) =>
			id !== null && (ids.has(id) || sources.has(id)) ? id : null;

		// Parents before their Subtasks, for the foreign key.
		const ordered = [...restored].sort(
			(a, b) => Number(a.parentId !== null) - Number(b.parentId !== null)
		);
		const upserted = ordered.map((task) =>
			toTask(
				tx
					.insert(tasks)
					.values({
						id: task.id,
						userId: scope.userId,
						listId,
						...taskColumns({ ...task, generatedFromTaskId: null }),
						createdAt: task.createdAt,
						updatedAt: task.updatedAt
					})
					.returning()
					.get()
			)
		);
		// Links between restored Tasks can only be set once all of them exist.
		const linked = ordered.filter((task) => source(task.generatedFromTaskId) !== null);
		for (const task of linked) {
			const row = tx
				.update(tasks)
				.set({ generatedFromTaskId: task.generatedFromTaskId, updatedAt: task.updatedAt })
				.where(owned(eq(tasks.id, task.id)))
				.returning()
				.get();
			upserted[ordered.indexOf(task)] = toTask(row);
		}
		return { upserted, deleted };
	});
}
