/**
 * Undo: puts back the exact state before the User's latest action (CONTEXT.md → Undo, ADR 0004).
 * It is its own operation, not a Reopen or a move back: it knows nothing about what the action was.
 *
 * An endpoint wraps a mutation in {@link undoable}, which compares the User's Tasks before and after
 * it, so nothing the mutation or a foreign key does can be missed. What differs decides the Task
 * families to record (a family is a top-level Task and its Subtasks): all of their Tasks as they
 * were and as the action left them, in the User's one record.
 *
 * {@link undoLatest} puts back what differs. **The state has moved on**, and Undo overwrites nothing,
 * if, apart from `updatedAt`:
 * - a Task Undo would write or delete isn't as the action left it, or one it would put back has
 *   returned by id,
 * - the top-level Task of a family the action touched isn't as the action left it: a Subtask can't
 *   come back to a parent that has been completed or deleted, or whose Subtask template has changed,
 * - the action changed that top-level Task, and any Task of the family isn't as the action left it,
 *   or a new Subtask has joined it. Undo then writes the parent's changed state and template, or
 *   deletes the parent, which would lose what those later changes meant for the series.
 * - a List to put a Task back into is gone.
 * Otherwise later changes don't get in the way: other Tasks of the List, and siblings of a Subtask
 * whose parent the action didn't change. A Task whose key a sibling took in the meantime goes right
 * before that sibling.
 */
import { and, eq, getTableColumns, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { restoredPosition } from '#lib/domain/moves.js';
import { byCustomOrder, serializeTask } from '#lib/domain/tasks.js';
import { toTask } from './db/mapping.js';
import { lists, tasks, undoRecords, type TaskRow } from './db/schema.js';
import { ownedBy, type UserScope } from './scope.js';
import type { TaskChangeSet } from './tasks.js';

/** A whole `tasks` row as JSON, its timestamps as ISO strings. */
type TaskImage = Omit<TaskRow, 'completedAt' | 'createdAt' | 'updatedAt'> & {
	completedAt: string | null;
	createdAt: string;
	updatedAt: string;
};

interface Families {
	before: TaskImage[];
	after: TaskImage[];
}

/** The state has moved on (see above), or the record is unusable: a 409, and nothing was written. */
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
 * Wrap only actions that offer Undo: any other would replace the record of the action whose toast
 * is still showing, and turn that Undo into a 404.
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

		const record = {
			id: crypto.randomUUID(),
			before: JSON.stringify(families.before),
			after: JSON.stringify(families.after)
		};
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
 * record is used up. Returns what that wrote and deleted, or `undefined` if there is no such record,
 * which is also what another User's `undoId` gets. Throws {@link UndoConflictError} if the state has
 * moved on or the record can't be read, leaving the record in place.
 */
export function undoLatest(scope: UserScope, undoId: string): TaskChangeSet | undefined {
	return scope.db.transaction(() => {
		const record = scope.db
			.select()
			.from(undoRecords)
			.where(and(ownedBy(undoRecords.userId, scope), eq(undoRecords.id, undoId)))
			.get();
		if (!record) return undefined;
		const families = { before: readImages(record.before), after: readImages(record.after) };
		assertNotMovedOn(scope, families);

		const after = byId(families.after);
		const wasThere = byId(families.before);
		const created = families.after.filter((task) => !wasThere.has(task.id)).map((task) => task.id);
		scope.db
			.delete(tasks)
			.where(owned(scope, inArray(tasks.id, created)))
			.run();

		// Restored Tasks can refer to each other in any order. Resets itself when the transaction ends.
		scope.db.run(sql`PRAGMA defer_foreign_keys = ON`);
		const changed = families.before.filter((task) => !sameValues(task, after.get(task.id)));
		const sources = existingIds(scope, changed);
		const upserted = changed.map((image) => {
			const row = fromImage(image);
			const source = row.generatedFromTaskId;
			// If the Occurrence it came from is gone since, the foreign key would have cleared this too.
			if (source !== null && !wasThere.has(source) && !sources.has(source)) {
				row.generatedFromTaskId = null;
			}
			row.position = restoredPosition(siblingsOf(scope, row), row.position);
			return toTask(writeRow(scope, row, after.has(row.id)));
		});

		scope.db.delete(undoRecords).where(ownedBy(undoRecords.userId, scope)).run();
		return { upserted, deleted: created };
	});
}

/**
 * Call when a List is deleted. A record that mentions it can't be undone any more, and its copies of
 * the List's Tasks shouldn't outlive the List. List ids are random, so looking through the text
 * finds exactly those records, even one that can't be read.
 */
export function forgetList(scope: UserScope, listId: string): void {
	const record = scope.db
		.select()
		.from(undoRecords)
		.where(ownedBy(undoRecords.userId, scope))
		.get();
	if (record && (record.before.includes(listId) || record.after.includes(listId))) {
		scope.db.delete(undoRecords).where(ownedBy(undoRecords.userId, scope)).run();
	}
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

const TASK_COLUMNS = Object.keys(getTableColumns(tasks)).sort().join();

/**
 * The images in a record's JSON. A record that can't be read, or was written before `tasks` got its
 * current columns, is refused: put back as it is, it would silently lose those fields.
 */
function readImages(json: string): TaskImage[] {
	try {
		const images: TaskImage[] = JSON.parse(json);
		for (const image of images) {
			if (Object.keys(image).sort().join() !== TASK_COLUMNS) throw new Error('Other columns');
			serializeTask(toTask(fromImage(image)));
		}
		return images;
	} catch {
		throw new UndoConflictError('That action can’t be undone any more');
	}
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
): Families | null {
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

/** Throws unless the state is still one Undo can apply to; the rule is at the top of this file. */
function assertNotMovedOn(scope: UserScope, { before, after }: Families) {
	const listIds = [...new Set(before.map((task) => task.listId))];
	const existingLists = scope.db
		.select({ id: lists.id })
		.from(lists)
		.where(and(ownedBy(lists.userId, scope), inArray(lists.id, listIds)))
		.all();
	if (existingLists.length < listIds.length) throw new UndoConflictError('The List is gone');

	const was = byId(before);
	const left = byId(after);
	const undone = [...new Set([...was.keys(), ...left.keys()])].filter(
		(id) => !sameValues(was.get(id), left.get(id))
	);
	const topLevel = new Set(
		undone.flatMap((id) => [was.get(id), left.get(id)].flatMap((t) => (t ? familyOf(t) : [])))
	);
	const rewritten = new Set(undone.filter((id) => topLevel.has(id)));

	const expected = after.filter(
		(task) => undone.includes(task.id) || topLevel.has(task.id) || rewritten.has(familyOf(task))
	);
	const current = scope.db
		.select()
		.from(tasks)
		.where(
			owned(
				scope,
				or(
					inArray(tasks.id, [...undone, ...topLevel, ...expected.map((task) => task.id)]),
					inArray(tasks.parentId, [...rewritten])
				) as SQL
			)
		)
		.all()
		.map(toImage);
	const expectedById = byId(expected);
	const asLeft =
		current.length === expectedById.size &&
		current.every((task) => sameValues(task, expectedById.get(task.id)));
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

/** The other Tasks where `row` goes, as they are now, in Custom Order. */
function siblingsOf(scope: UserScope, row: TaskRow) {
	return scope.db
		.select({ id: tasks.id, position: tasks.position })
		.from(tasks)
		.where(
			owned(
				scope,
				eq(tasks.listId, row.listId),
				row.parentId === null ? isNull(tasks.parentId) : eq(tasks.parentId, row.parentId),
				ne(tasks.id, row.id)
			)
		)
		.all()
		.sort(byCustomOrder);
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
