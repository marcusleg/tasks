/**
 * Undo: puts back the exact state before the User's latest action (CONTEXT.md → Undo, ADR 0004).
 * It is its own operation, not a Reopen or a move back: it knows nothing about what the action was.
 *
 * An endpoint wraps a mutation in {@link undoable}, which compares the User's Tasks before and after
 * it, so nothing the mutation or a foreign key does can be missed. What differs decides the Task
 * families to record (a family is a top-level Task and its Subtasks): all of their Tasks as they
 * were and as the action left them, in the User's one record.
 *
 * {@link undoLatest} puts them back. **The state has moved on**, and Undo overwrites nothing, unless
 * - the record's families are exactly as the action left them, apart from `updatedAt`: the same
 *   Tasks with the same values, so no later change to a Task, its parent or a sibling is lost, and
 * - every Task to put back still has its List.
 * Changes elsewhere, including to other Tasks of the List, don't get in the way.
 */
import { and, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { toTask } from './db/mapping.js';
import { lists, tasks, undoRecords, type TaskImage, type TaskRow } from './db/schema.js';
import { ownedBy, type UserScope } from './scope.js';
import type { TaskChangeSet } from './tasks.js';

/** The state has moved on (see above): a 409, and nothing was written. */
export class UndoConflictError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'UndoConflictError';
	}
}

/**
 * Runs a mutation and records it as the User's latest action, replacing the record before it, in
 * one transaction. Returns its result (`undefined` stays `undefined`, and records nothing) with
 * `undoId`, for {@link undoLatest}; that is `null` if the action changed nothing, which leaves the
 * record as it was.
 *
 * It reads all of the User's Tasks twice, so wrap only what the User can undo.
 */
export function undoable<T extends object>(
	scope: UserScope,
	action: () => T | undefined
): (T & { undoId: string | null }) | undefined {
	return scope.db.transaction(() => {
		const before = tasksOfUser(scope);
		const result = action();
		if (result === undefined) return undefined;
		const families = touchedFamilies(before, tasksOfUser(scope));
		if (!families) return { ...result, undoId: null };

		const record = { id: crypto.randomUUID(), ...families };
		scope.db
			.insert(undoRecords)
			.values({ userId: scope.userId, ...record })
			.onConflictDoUpdate({ target: undoRecords.userId, set: record })
			.run();
		return { ...result, undoId: record.id };
	});
}

/**
 * Undoes the action `undoId` names, if it is still the User's latest and hasn't been undone: the
 * record is used up. Returns what that wrote and deleted (with each Task's `updatedAt` as it was),
 * or `undefined` if there is no such record, which is also what another User's `undoId` gets.
 * Throws {@link UndoConflictError} if the state has moved on, leaving the record in place.
 */
export function undoLatest(scope: UserScope, undoId: string): TaskChangeSet | undefined {
	return scope.db.transaction(() => {
		const record = scope.db
			.select()
			.from(undoRecords)
			.where(and(ownedBy(undoRecords.userId, scope), eq(undoRecords.id, undoId)))
			.get();
		if (!record) return undefined;
		assertNotMovedOn(scope, record);

		const after = byId(record.after);
		const wasThere = byId(record.before);
		const created = record.after.filter((task) => !wasThere.has(task.id)).map((task) => task.id);
		scope.db
			.delete(tasks)
			.where(owned(scope, inArray(tasks.id, created)))
			.run();

		// Restored Tasks can refer to each other in any order. Resets itself when the transaction ends.
		scope.db.run(sql`PRAGMA defer_foreign_keys = ON`);
		const changed = record.before.filter((task) => !sameValues(task, after.get(task.id)));
		const sources = existingIds(scope, changed);
		const upserted = changed.map((image) => {
			const row = fromImage(image);
			const source = row.generatedFromTaskId;
			// If the Occurrence it came from is gone since, the foreign key would have cleared this too.
			if (source !== null && !wasThere.has(source) && !sources.has(source)) {
				row.generatedFromTaskId = null;
			}
			return toTask(writeRow(scope, row, after.has(row.id)));
		});

		scope.db.delete(undoRecords).where(ownedBy(undoRecords.userId, scope)).run();
		return { upserted, deleted: created };
	});
}

function owned(scope: UserScope, ...conditions: SQL[]): SQL {
	return and(ownedBy(tasks.userId, scope), ...conditions) as SQL;
}

function toImage(row: TaskRow): TaskImage {
	return {
		...row,
		completedAt: row.completedAt?.toISOString() ?? null,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString()
	};
}

function fromImage(image: TaskImage): TaskRow {
	return {
		...image,
		completedAt: image.completedAt === null ? null : new Date(image.completedAt),
		createdAt: new Date(image.createdAt),
		updatedAt: new Date(image.updatedAt)
	};
}

function byId(images: TaskImage[]): Map<string, TaskImage> {
	return new Map(images.map((image) => [image.id, image]));
}

function tasksOfUser(scope: UserScope): Map<string, TaskImage> {
	return byId(scope.db.select().from(tasks).where(owned(scope)).all().map(toImage));
}

/** The top-level Task of an image's family. */
const familyOf = (image: TaskImage) => image.parentId ?? image.id;

/** Compares everything but `updatedAt`, which a save that changes nothing still moves. */
function sameValues(a: TaskImage | undefined, b: TaskImage | undefined): boolean {
	return (
		a !== undefined &&
		b !== undefined &&
		JSON.stringify({ ...a, updatedAt: '' }) === JSON.stringify({ ...b, updatedAt: '' })
	);
}

/** The families with a Task that differs, before and after; `null` if nothing does. */
function touchedFamilies(
	before: Map<string, TaskImage>,
	after: Map<string, TaskImage>
): { before: TaskImage[]; after: TaskImage[] } | null {
	const touched = new Set<string>();
	for (const id of new Set([...before.keys(), ...after.keys()])) {
		const images = [before.get(id), after.get(id)];
		if (sameValues(images[0], images[1])) continue;
		for (const image of images) if (image) touched.add(familyOf(image));
	}
	if (touched.size === 0) return null;
	const ofFamilies = (images: Map<string, TaskImage>) =>
		[...images.values()].filter((image) => touched.has(familyOf(image)));
	return { before: ofFamilies(before), after: ofFamilies(after) };
}

function assertNotMovedOn(scope: UserScope, record: { before: TaskImage[]; after: TaskImage[] }) {
	const listIds = [...new Set(record.before.map((task) => task.listId))];
	const existingLists = scope.db
		.select({ id: lists.id })
		.from(lists)
		.where(and(ownedBy(lists.userId, scope), inArray(lists.id, listIds)))
		.all();
	if (existingLists.length < listIds.length) throw new UndoConflictError('The List is gone');

	// By id as well, so that a Task the action deleted is noticed if it has come back.
	const images = [...record.before, ...record.after];
	const current = scope.db
		.select()
		.from(tasks)
		.where(
			owned(
				scope,
				or(
					inArray(tasks.id, [...new Set(images.map((task) => task.id))]),
					inArray(tasks.parentId, [...new Set(images.map(familyOf))])
				) as SQL
			)
		)
		.all()
		.map(toImage);
	const expected = byId(record.after);
	const asLeft =
		current.length === expected.size &&
		current.every((task) => sameValues(task, expected.get(task.id)));
	if (!asLeft) throw new UndoConflictError('The Task or its Subtasks changed in the meantime');
}

/** Which of the Occurrences these Tasks were generated from are still there. */
function existingIds(scope: UserScope, images: TaskImage[]): Set<string> {
	const sources = images.flatMap((task) => task.generatedFromTaskId ?? []);
	const rows = scope.db
		.select({ id: tasks.id })
		.from(tasks)
		.where(owned(scope, inArray(tasks.id, sources)))
		.all();
	return new Set(rows.map((row) => row.id));
}

/**
 * A Task that is gone is inserted, not upserted: an id another User has taken since must clash (a
 * 409 through `withInputErrors`), never overwrite their Task.
 */
function writeRow(scope: UserScope, row: TaskRow, exists: boolean): TaskRow {
	if (!exists) return scope.db.insert(tasks).values(row).returning().get();
	return scope.db
		.update(tasks)
		.set(row)
		.where(owned(scope, eq(tasks.id, row.id)))
		.returning()
		.get();
}
