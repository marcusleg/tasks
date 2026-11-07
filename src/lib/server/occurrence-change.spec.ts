/**
 * The bookkeeping of a change to a Subtask of a recurring Task (CONTEXT.md → Occurrence, Reopen):
 * the parent's changed state, and what the next Occurrence gets.
 *
 * The matrix runs every Subtask change in every scope twice: through the module's interface with
 * the Subtask written by hand, and through the mutation. So it pins the module, and that each
 * mutation goes through it.
 */
import { generateKeyBetween } from 'fractional-indexing';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { dateOnly } from '#lib/domain/dates.js';
import { parseRecurrence } from '#lib/domain/recurrence.js';
import type { ApplyTo } from '#lib/domain/recurring-tasks.js';
import { serializeSeriesTemplate, type Task } from '#lib/domain/tasks.js';
import { toTask } from './db/mapping';
import { tasks } from './db/schema';
import { createList } from './lists';
import {
	beginOccurrenceChange,
	beginOccurrenceMove,
	recordSubtaskProgress
} from './occurrence-change';
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

const weekly = parseRecurrence({
	frequency: 'weekly',
	interval: 1,
	end: { kind: 'never' },
	anchor: 'schedule'
});

interface Family {
	scope: UserScope;
	listId: string;
	parent: Task;
	fern: Task;
	cactus: Task;
	/** A top-level Task of the same List, to move in. */
	moss: Task;
}

function add(scope: UserScope, listId: string, title: string, parentId?: string): Task {
	const changes = createTask(scope, { listId, title, parentId });
	if (!changes) throw new Error('createTask failed');
	return changes.upserted[0];
}

/** A Task with the Subtasks "Fern" and "Cactus"; recurring unless said otherwise. */
function setUp(recurring = true): Family {
	const db = createTestDb();
	const scope: UserScope = { db, userId: insertUser(db, 'alice').id };
	const listId = createList(scope, { name: 'Chores' }).id;
	const moss = add(scope, listId, 'Moss');
	const parent = add(scope, listId, 'Water plants');
	if (recurring) {
		updateTask(scope, parent.id, { planned: dateOnly('2026-11-02'), recurrence: weekly });
	}
	const fern = add(scope, listId, 'Fern', parent.id);
	const cactus = add(scope, listId, 'Cactus', parent.id);
	return { scope, listId, parent: getTask(scope, parent.id)!, fern, cactus, moss };
}

/** The same, after a "This Occurrence" change: its template keeps "Cactus" under the old Title. */
function setUpWithTemplate(): Family {
	const family = setUp();
	updateTask(family.scope, family.cactus.id, { title: 'Cacti' }, 'occurrence');
	return { ...family, parent: getTask(family.scope, family.parent.id)! };
}

function resetChangedState({ scope }: Family) {
	scope.db.update(tasks).set({ changedSinceGenerated: false }).run();
}

const isChanged = ({ scope }: Family, id: string) => getTask(scope, id)?.changedSinceGenerated;
const templateOf = ({ scope }: Family, id: string) => {
	const template = getTask(scope, id)?.seriesTemplate;
	return template ? serializeSeriesTemplate(template) : null;
};

/** The Titles of the Subtasks the next Occurrence gets, which all have to be open. */
function nextSubtasks({ scope, listId, parent }: Family): string[] {
	const changes = completeTask(scope, parent.id, new Date('2026-11-03T10:00:00Z'), 'UTC')!;
	const next = changes.upserted.find((t) => t.parentId === null && t.completedAt === null)!;
	const subtasks = getListTasks(scope, listId).filter((t) => t.parentId === next.id);
	expect(subtasks.filter((t) => t.completedAt !== null)).toEqual([]);
	return subtasks.map((t) => t.title);
}

// The writes a mutation would make, without its bookkeeping.

function writeNewSubtask({ scope, listId, parent, cactus }: Family, title: string): Task {
	const row = scope.db
		.insert(tasks)
		.values({
			userId: scope.userId,
			listId,
			parentId: parent.id,
			title,
			position: generateKeyBetween(cactus.position, null)
		})
		.returning()
		.get();
	return toTask(row);
}

function writeTask(
	{ scope }: Family,
	id: string,
	values: Partial<typeof tasks.$inferInsert>
): Task {
	const row = scope.db
		.update(tasks)
		.set(values)
		.where(and(eq(tasks.userId, scope.userId), eq(tasks.id, id)))
		.returning()
		.get();
	return toTask(row);
}

function writeDeleted({ scope }: Family, id: string) {
	scope.db.delete(tasks).where(eq(tasks.id, id)).run();
}

/** One change a User can make to a Subtask. Those the User isn't asked a scope for ignore it. */
interface SubtaskChange {
	name: string;
	/** Done with the mutations, before the changed state is reset. */
	prepare?: (family: Family) => void;
	throughModule: (family: Family, applyTo: ApplyTo) => void;
	throughMutation: (family: Family, applyTo: ApplyTo) => void;
	next: Record<ApplyTo, string[]>;
}

const asBefore = ['Fern', 'Cactus'];
const sameInBothScopes = (next: string[]) => ({ occurrence: next, future: next });

const SUBTASK_CHANGES: SubtaskChange[] = [
	{
		name: 'adding a Subtask',
		throughModule(family, applyTo) {
			const change = beginOccurrenceChange(family.scope, family.parent.id, applyTo);
			change.added(writeNewSubtask(family, 'Orchid'));
		},
		throughMutation({ scope, listId, parent }, applyTo) {
			createTask(scope, { listId, title: 'Orchid', parentId: parent.id }, applyTo);
		},
		next: { occurrence: asBefore, future: ['Fern', 'Cactus', 'Orchid'] }
	},
	{
		name: 'editing a Subtask',
		throughModule(family, applyTo) {
			const change = beginOccurrenceChange(family.scope, family.parent.id, applyTo);
			change.edited(writeTask(family, family.fern.id, { title: 'Ferns' }));
		},
		throughMutation({ scope, fern }, applyTo) {
			updateTask(scope, fern.id, { title: 'Ferns' }, applyTo);
		},
		next: { occurrence: asBefore, future: ['Ferns', 'Cactus'] }
	},
	{
		name: 'deleting a Subtask',
		throughModule(family, applyTo) {
			const change = beginOccurrenceChange(family.scope, family.parent.id, applyTo);
			writeDeleted(family, family.fern.id);
			change.deleted(family.fern.id);
		},
		throughMutation({ scope, fern }, applyTo) {
			deleteTask(scope, fern.id, applyTo);
		},
		next: { occurrence: asBefore, future: ['Cactus'] }
	},
	{
		name: 'completing a Subtask',
		throughModule(family) {
			writeTask(family, family.fern.id, { completedAt: new Date() });
			recordSubtaskProgress(family.scope, family.parent.id);
		},
		throughMutation({ scope, fern }) {
			completeTask(scope, fern.id);
		},
		next: sameInBothScopes(asBefore)
	},
	{
		name: 'reopening a Subtask',
		prepare: ({ scope, fern }) => completeTask(scope, fern.id),
		throughModule(family) {
			writeTask(family, family.fern.id, { completedAt: null });
			recordSubtaskProgress(family.scope, family.parent.id);
		},
		throughMutation({ scope, fern }) {
			reopenTask(scope, fern.id);
		},
		next: sameInBothScopes(asBefore)
	},
	{
		name: 'moving a Subtask out',
		throughModule(family) {
			const to = { listId: family.listId, parentId: null, position: 'Zz' };
			const move = beginOccurrenceMove(family.scope, family.fern, to.parentId);
			writeTask(family, family.fern.id, to);
			move.moved(to);
		},
		throughMutation({ scope, listId, fern }) {
			moveTask(scope, fern.id, { listId, parentId: null });
		},
		next: sameInBothScopes(asBefore)
	},
	{
		name: 'moving a Task in',
		throughModule(family) {
			const to = {
				listId: family.listId,
				parentId: family.parent.id,
				position: generateKeyBetween(family.cactus.position, null)
			};
			const move = beginOccurrenceMove(family.scope, family.moss, to.parentId);
			writeTask(family, family.moss.id, to);
			move.moved(to);
		},
		throughMutation({ scope, listId, parent, moss }) {
			moveTask(scope, moss.id, { listId, parentId: parent.id });
		},
		next: sameInBothScopes(asBefore)
	}
];

const STARTING_POINTS = [
	{ template: 'without a Subtask template', make: () => setUp() },
	{ template: 'with a Subtask template', make: setUpWithTemplate }
];
const ROUTES = [
	{ route: 'through the module', run: 'throughModule' },
	{ route: 'through the mutation', run: 'throughMutation' }
] as const;
const SCOPES: { scope: string; applyTo: ApplyTo }[] = [
	{ scope: 'This Occurrence', applyTo: 'occurrence' },
	{ scope: 'This and all future', applyTo: 'future' }
];

describe.each(STARTING_POINTS)('a recurring Task $template', ({ make }) => {
	describe.each(ROUTES)('$route', ({ run }) => {
		describe.each(SCOPES)('$scope', ({ applyTo }) => {
			it.each(SUBTASK_CHANGES)('$name', (change) => {
				const family = make();
				change.prepare?.(family);
				resetChangedState(family);

				change[run](family, applyTo);

				expect(isChanged(family, family.parent.id)).toBe(true);
				expect(nextSubtasks(family)).toEqual(change.next[applyTo]);
			});
		});
	});
});

describe('the mutations', () => {
	it('changing only a Subtask’s Recurrence marks it and its parent, but stays out of the template', () => {
		const family = setUp();
		resetChangedState(family);

		const changes = updateTask(family.scope, family.fern.id, { recurrence: null }, 'occurrence')!;

		expect(changes.upserted[0]).toMatchObject({ id: family.fern.id, changedSinceGenerated: true });
		expect(isChanged(family, family.parent.id)).toBe(true);
		expect(templateOf(family, family.parent.id)).toBeNull();
	});

	it('completing an already Completed Subtask marks nothing', () => {
		const family = setUp();
		completeTask(family.scope, family.fern.id);
		resetChangedState(family);

		completeTask(family.scope, family.fern.id);

		expect(isChanged(family, family.parent.id)).toBe(false);
	});

	it('reopening an open Subtask marks nothing', () => {
		const family = setUp();
		resetChangedState(family);

		reopenTask(family.scope, family.fern.id);

		expect(isChanged(family, family.parent.id)).toBe(false);
	});

	describe('answer with the parent as last written, its template and changed state included', () => {
		function expectParentInAnswer(family: Family, upserted: Task[], template: string[]) {
			const parent = upserted.find((task) => task.id === family.parent.id);
			expect(parent).toEqual(getTask(family.scope, family.parent.id));
			expect(parent?.changedSinceGenerated).toBe(true);
			expect(parent?.seriesTemplate?.subtasks?.map((entry) => entry.title)).toEqual(template);
		}

		it('createTask', () => {
			const family = setUp();
			resetChangedState(family);
			const { scope, listId, parent } = family;

			const changes = createTask(
				scope,
				{ listId, title: 'Moss', parentId: parent.id },
				'occurrence'
			)!;

			expectParentInAnswer(family, changes.upserted, ['Fern', 'Cactus']);
		});

		it('deleteTask', () => {
			const family = setUp();
			resetChangedState(family);

			const changes = deleteTask(family.scope, family.fern.id, 'occurrence')!;

			expectParentInAnswer(family, changes.upserted, ['Fern', 'Cactus']);
		});

		it('moveTask', () => {
			const family = setUp();
			resetChangedState(family);
			const { scope, listId, fern } = family;

			const changes = moveTask(scope, fern.id, { listId, parentId: null })!;

			expectParentInAnswer(family, changes.upserted, ['Fern', 'Cactus']);
		});
	});
});

describe('beginOccurrenceChange', () => {
	it('returns the parent as last written, so the change set has its changed state and template', () => {
		const family = setUp();
		resetChangedState(family);

		const change = beginOccurrenceChange(family.scope, family.parent.id, 'occurrence');
		const written = change.added(writeNewSubtask(family, 'Orchid'));

		expect(written.at(-1)).toEqual(getTask(family.scope, family.parent.id));
	});

	it('returns nothing when there was nothing to write', () => {
		const family = setUp();

		const change = beginOccurrenceChange(family.scope, family.parent.id, 'future');

		expect(change.added(writeNewSubtask(family, 'Orchid'))).toEqual([]);
	});

	it('marks the edited Task itself, top-level or not', () => {
		const family = setUp();
		resetChangedState(family);

		const edit = (id: string, parentId: string | null) =>
			beginOccurrenceChange(family.scope, parentId, 'future').edited(
				writeTask(family, id, { title: 'Edited' })
			);

		expect(edit(family.moss.id, null).map((t) => t.id)).toEqual([family.moss.id]);
		expect(edit(family.fern.id, family.parent.id).map((t) => t.id)).toEqual([
			family.fern.id,
			family.parent.id
		]);
	});

	it('doesn’t mark a new Subtask or its siblings', () => {
		const family = setUp();
		resetChangedState(family);

		const change = beginOccurrenceChange(family.scope, family.parent.id, 'future');
		const orchid = writeNewSubtask(family, 'Orchid');
		change.added(orchid);

		expect(isChanged(family, orchid.id)).toBe(false);
		expect(isChanged(family, family.fern.id)).toBe(false);
	});

	it('`null` marks but leaves the template alone, whichever template the parent has', () => {
		for (const make of [() => setUp(), setUpWithTemplate]) {
			const family = make();
			resetChangedState(family);
			const before = templateOf(family, family.parent.id);

			const change = beginOccurrenceChange(family.scope, family.parent.id, null);
			change.edited(writeTask(family, family.fern.id, { title: 'Ferns' }));

			expect(isChanged(family, family.parent.id)).toBe(true);
			expect(isChanged(family, family.fern.id)).toBe(true);
			expect(templateOf(family, family.parent.id)).toEqual(before);
		}
	});

	it('marks a parent that doesn’t recur, without giving it a template', () => {
		const family = setUp(false);
		resetChangedState(family);

		const change = beginOccurrenceChange(family.scope, family.parent.id, 'occurrence');
		change.deleted(family.fern.id);

		expect(isChanged(family, family.parent.id)).toBe(true);
		expect(templateOf(family, family.parent.id)).toBeNull();
	});

	it('marks a Completed recurring parent, without giving it a template', () => {
		const family = setUp();
		completeTask(family.scope, family.parent.id);
		resetChangedState(family);

		const change = beginOccurrenceChange(family.scope, family.parent.id, 'occurrence');
		change.edited(writeTask(family, family.fern.id, { title: 'Ferns' }));

		expect(isChanged(family, family.parent.id)).toBe(true);
		expect(templateOf(family, family.parent.id)).toBeNull();
	});

	it('doesn’t touch another User’s parent', () => {
		const family = setUp();
		resetChangedState(family);
		const bob: UserScope = {
			db: family.scope.db,
			userId: insertUser(family.scope.db, 'bob').id
		};

		const change = beginOccurrenceChange(bob, family.parent.id, 'occurrence');

		expect(change.deleted(family.fern.id)).toEqual([]);
		expect(isChanged(family, family.parent.id)).toBe(false);
		expect(templateOf(family, family.parent.id)).toBeNull();
	});
});

describe('recordSubtaskProgress', () => {
	it('leaves the template alone', () => {
		const family = setUp();
		resetChangedState(family);

		recordSubtaskProgress(family.scope, family.parent.id);

		expect(isChanged(family, family.parent.id)).toBe(true);
		expect(templateOf(family, family.parent.id)).toBeNull();
	});

	it('does nothing for a top-level Task', () => {
		const family = setUp();
		resetChangedState(family);

		expect(recordSubtaskProgress(family.scope, null)).toEqual([]);
	});
});

describe('beginOccurrenceMove', () => {
	it('keeps the template of both parents when a Subtask moves between recurring Tasks', () => {
		const family = setUp();
		const other = add(family.scope, family.listId, 'Feed fish');
		updateTask(family.scope, other.id, { planned: dateOnly('2026-11-02'), recurrence: weekly });
		const guppy = add(family.scope, family.listId, 'Guppy', other.id);
		resetChangedState(family);

		const move = beginOccurrenceMove(family.scope, family.fern, other.id);
		const to = {
			listId: family.listId,
			parentId: other.id,
			position: generateKeyBetween(guppy.position, null)
		};
		writeTask(family, family.fern.id, to);
		const marked = move.moved(to);

		expect(move.kept.map((t) => t.id)).toEqual([family.parent.id, other.id]);
		expect(marked.map((t) => t.id)).toEqual([family.fern.id, family.parent.id, other.id]);
	});

	it('reordering among siblings marks but doesn’t keep', () => {
		const family = setUp();
		resetChangedState(family);

		const move = beginOccurrenceMove(family.scope, family.cactus, family.parent.id);
		const to = { ...family.cactus, position: generateKeyBetween(null, family.fern.position) };
		writeTask(family, family.cactus.id, { position: to.position });
		move.moved(to);

		expect(move.kept).toEqual([]);
		expect(isChanged(family, family.cactus.id)).toBe(true);
		expect(isChanged(family, family.parent.id)).toBe(true);
		expect(templateOf(family, family.parent.id)).toBeNull();
	});

	it('moving a top-level Task to another List marks only the Task', () => {
		const family = setUp();
		const elsewhere = createList(family.scope, { name: 'Elsewhere' });
		resetChangedState(family);

		const move = beginOccurrenceMove(family.scope, family.parent, null);
		const marked = move.moved({ ...family.parent, listId: elsewhere.id });

		expect(move.kept).toEqual([]);
		expect(marked.map((t) => t.id)).toEqual([family.parent.id]);
	});

	it('a move that changes nothing marks nothing', () => {
		const family = setUp();
		resetChangedState(family);

		const move = beginOccurrenceMove(family.scope, family.fern, family.parent.id);

		expect(move.moved(family.fern)).toEqual([]);
		expect(isChanged(family, family.fern.id)).toBe(false);
		expect(isChanged(family, family.parent.id)).toBe(false);
	});
});
