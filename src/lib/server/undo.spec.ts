/**
 * Undo (CONTEXT.md → Undo, ADR 0004). `expectUndoRestoresLists` does the comparing; these specs say
 * which states and actions it has to hold for, and when Undo has to refuse.
 */
import { eq, inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { dateOnly } from '#lib/domain/dates.js';
import { parseRecurrence } from '#lib/domain/recurrence.js';
import type { ApplyTo } from '#lib/domain/recurring-tasks.js';
import { InvalidInputError } from '#lib/domain/validation.js';
import type { Task } from '#lib/domain/tasks.js';
import { lists, tasks, undoRecords, users } from './db/schema';
import { createList, deleteList } from './lists';
import type { UserScope } from './scope';
import {
	completeTask,
	createTask,
	deleteCompletedTasks,
	deleteTask,
	getListTasks,
	getTask,
	moveTask,
	reopenTask,
	updateTask
} from './tasks';
import { createTestDb, insertUser } from './testing/index';
import { expectUndoRestoresLists, wholeLists } from './testing/undo';
import { undoable, undoLatest, UndoConflictError } from './undo';

const weekly = parseRecurrence({
	frequency: 'weekly',
	interval: 1,
	end: { kind: 'never' },
	anchor: 'schedule'
});

function add(scope: UserScope, listId: string, title: string, parentId?: string): Task {
	return createTask(scope, { listId, title, parentId })!.upserted[0];
}

/** "Water plants" with the Subtasks "Fern" and "Cactus", and "Moss" elsewhere in the List. */
function setUp(recurring = true) {
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
	return { db, scope, listId, parent, fern, cactus, moss };
}

type Family = ReturnType<typeof setUp>;

/** The bug of #58: the Subtasks have a template, made by editing one with "This Occurrence". */
function withTemplate(family: Family): Family {
	updateTask(family.scope, family.cactus.id, { title: 'Cacti' }, 'occurrence');
	expect(getTask(family.scope, family.parent.id)?.seriesTemplate?.subtasks).toHaveLength(2);
	return family;
}

/** The parent is the next Occurrence, unchanged since it was generated, with its own Subtasks. */
function generated(family: Family): Family {
	const { scope, listId, parent } = family;
	const now = new Date('2026-11-03T10:00:00Z');
	const next = completeTask(scope, parent.id, now, 'UTC')!.upserted.find(
		(task) => task.parentId === null && task.completedAt === null
	)!;
	const [fern, cactus] = getListTasks(scope, listId).filter((task) => task.parentId === next.id);
	expect(next.changedSinceGenerated).toBe(false);
	return { ...family, parent: next, fern, cactus };
}

const deleteFern = ({ scope, fern }: Family, applyTo: ApplyTo) =>
	deleteTask(scope, fern.id, applyTo);

/** Deletes "Fern" and answers with the action's `undoId`. */
function deleteFernUndoably(family: Family, applyTo: ApplyTo = 'future'): string {
	const done = undoable(family.scope, () => deleteFern(family, applyTo));
	return done!.undoId!;
}

/** The Titles of the Subtasks the next Occurrence gets. */
function nextSubtasks({ scope, listId, parent }: Family): string[] {
	const changes = completeTask(scope, parent.id, new Date('2026-11-20T10:00:00Z'), 'UTC')!;
	const next = changes.upserted.find((t) => t.parentId === null && t.completedAt === null)!;
	return getListTasks(scope, listId)
		.filter((t) => t.parentId === next.id)
		.map((t) => t.title);
}

const STARTING_POINTS = [
	{ state: 'without a template', make: () => setUp() },
	{ state: 'with a template', make: () => withTemplate(setUp()) },
	{ state: 'unchanged since it was generated', make: () => generated(setUp()) },
	{ state: 'generated, with a template', make: () => withTemplate(generated(setUp())) }
];

describe.each(STARTING_POINTS)('deleting a Subtask of a recurring Task $state', ({ make }) => {
	describe.each<ApplyTo>(['occurrence', 'future'])('with scope %s', (applyTo) => {
		it('and Undo: the whole List is as before, the parent’s template and changed state too', () => {
			const family = make();
			const { deleted } = expectUndoRestoresLists(family.scope, [family.listId], () =>
				deleteFern(family, applyTo)
			);

			expect(deleted).toEqual([]);
		});

		it('and Undo: the next Occurrence has the restored Subtask', () => {
			const family = make();
			const expected = nextSubtasks(make());

			expectUndoRestoresLists(family.scope, [family.listId], () => deleteFern(family, applyTo));

			expect(nextSubtasks(family)).toEqual(expected);
			expect(expected).toContain('Fern');
		});
	});
});

describe('deleting a Subtask of a Task that doesn’t recur, and Undo', () => {
	it('puts the parent’s changed state back', () => {
		const family = setUp(false);
		family.scope.db.update(tasks).set({ changedSinceGenerated: false }).run();

		expectUndoRestoresLists(family.scope, [family.listId], () => deleteFern(family, 'future'));

		expect(getTask(family.scope, family.parent.id)?.changedSinceGenerated).toBe(false);
	});
});

describe('after Undo of deleting a Subtask of the next Occurrence', () => {
	it('reopening the previous Occurrence still makes that one give way', () => {
		const family = setUp();
		const previous = family.parent;
		const next = generated(family);

		expectUndoRestoresLists(next.scope, [next.listId], () => deleteFern(next, 'future'));

		expect(reopenTask(next.scope, previous.id)?.deleted).toContain(next.parent.id);
	});
});

describe('the action behind the record doesn’t matter', () => {
	it('a Task with Subtasks deleted', () => {
		const family = setUp();
		expectUndoRestoresLists(family.scope, [family.listId], () =>
			deleteTask(family.scope, family.parent.id)
		);
	});

	it('an Occurrence skipped: the next one goes again', () => {
		const family = setUp();
		const changes = expectUndoRestoresLists(family.scope, [family.listId], () =>
			deleteTask(family.scope, family.parent.id, 'occurrence')
		);
		expect(changes.deleted).toHaveLength(3);
	});

	it('an Occurrence completed: the next one goes again, the Subtasks reopen', () => {
		const family = setUp();
		expectUndoRestoresLists(family.scope, [family.listId], () =>
			completeTask(family.scope, family.parent.id)
		);
	});

	it('a Subtask completed', () => {
		const family = generated(setUp());
		expectUndoRestoresLists(family.scope, [family.listId], () =>
			completeTask(family.scope, family.fern.id)
		);
	});

	it('a Subtask moved to another List, with its parent keeping a template', () => {
		const family = setUp();
		const work = createList(family.scope, { name: 'Work' }).id;
		expectUndoRestoresLists(family.scope, [family.listId, work], () =>
			moveTask(family.scope, family.fern.id, { listId: work, parentId: null })
		);
	});

	it('a foreign key’s effect on another List: the Occurrence it generated keeps the link', () => {
		const family = setUp();
		const previous = family.parent;
		const next = generated(family).parent;
		const work = createList(family.scope, { name: 'Work' }).id;
		moveTask(family.scope, next.id, { listId: work, parentId: null });
		expect(getTask(family.scope, next.id)?.generatedFromTaskId).toBe(previous.id);

		expectUndoRestoresLists(family.scope, [family.listId, work], () =>
			deleteTask(family.scope, previous.id)
		);

		expect(getTask(family.scope, next.id)?.generatedFromTaskId).toBe(previous.id);
	});
});

describe('undoable', () => {
	it('records nothing when the action found nothing', () => {
		const { scope } = setUp();
		expect(undoable(scope, () => undefined)).toBeUndefined();
		expect(scope.db.select().from(undoRecords).all()).toEqual([]);
	});

	it('keeps the latest record when the action changed nothing', () => {
		const family = setUp();
		const undoId = deleteFernUndoably(family);

		const done = undoable(family.scope, () => ({ nothing: true }));

		expect(done?.undoId).toBeNull();
		expect(undoLatest(family.scope, undoId)).toBeDefined();
	});

	it('leaves everything as it was when the action fails', () => {
		const family = setUp();
		const undoId = deleteFernUndoably(family);
		const before = wholeLists(family.scope, family.listId);

		expect(() =>
			undoable(family.scope, () => {
				updateTask(family.scope, family.moss.id, { title: 'Half done' });
				throw new InvalidInputError('Nope');
			})
		).toThrow(InvalidInputError);

		expect(wholeLists(family.scope, family.listId)).toEqual(before);
		expect(undoLatest(family.scope, undoId)).toBeDefined();
	});
});

describe('the record', () => {
	it('stays at one per User, holding only the touched families', () => {
		const family = setUp();
		const { db, scope, moss, parent } = family;
		deleteFernUndoably(family);
		undoable(scope, () => deleteTask(scope, family.cactus.id));
		undoable(scope, () => updateTask(scope, moss.id, { title: 'Mosses' }));
		undoable(scope, () => deleteTask(scope, parent.id));

		const records = db.select().from(undoRecords).all();
		expect(records).toHaveLength(1);
		const before: { id: string }[] = JSON.parse(records[0].before);
		expect(before.map((task) => task.id)).toEqual([parent.id]);
		expect(JSON.parse(records[0].after)).toEqual([]);
	});

	it('is used up by Undo, so a second Undo finds nothing', () => {
		const family = setUp();
		const undoId = deleteFernUndoably(family);

		expect(undoLatest(family.scope, undoId)).toBeDefined();
		expect(family.db.select().from(undoRecords).all()).toEqual([]);
		expect(undoLatest(family.scope, undoId)).toBeUndefined();
	});

	it('goes with the User', () => {
		const family = setUp();
		deleteFernUndoably(family);

		family.db.delete(users).where(eq(users.id, family.scope.userId)).run();

		expect(family.db.select().from(undoRecords).all()).toEqual([]);
	});
});

describe('only the User’s latest action can be undone', () => {
	it('an older action’s id finds nothing and writes nothing', () => {
		const family = setUp();
		const older = deleteFernUndoably(family);
		const newer = undoable(family.scope, () => deleteTask(family.scope, family.cactus.id))!.undoId!;
		const before = wholeLists(family.scope, family.listId);

		expect(undoLatest(family.scope, older)).toBeUndefined();

		expect(wholeLists(family.scope, family.listId)).toEqual(before);
		expect(undoLatest(family.scope, newer)).toBeDefined();
	});

	it('another User’s id finds nothing and writes nothing, and leaves their Undo in place', () => {
		const family = setUp();
		const bob: UserScope = { db: family.db, userId: insertUser(family.db, 'bob').id };
		const undoId = deleteFernUndoably(family);

		expect(undoLatest(bob, undoId)).toBeUndefined();

		expect(getTask(family.scope, family.fern.id)).toBeUndefined();
		expect(undoLatest(family.scope, undoId)).toBeDefined();
	});

	it('another User’s action doesn’t replace the record', () => {
		const family = setUp();
		const bob: UserScope = { db: family.db, userId: insertUser(family.db, 'bob').id };
		const bobsTask = add(bob, createList(bob, { name: 'Bob' }).id, 'Bob’s');
		const undoId = deleteFernUndoably(family);

		undoable(bob, () => deleteTask(bob, bobsTask.id));

		expect(undoLatest(family.scope, undoId)).toBeDefined();
	});
});

/** Later changes to a sibling of "Fern", given a third Subtask "Reed". */
const LATER_TO_A_SIBLING: { what: string; after: (family: Family, reed: Task) => unknown }[] = [
	{
		what: 'was edited',
		after: ({ scope, cactus }) => updateTask(scope, cactus.id, { title: 'Cacti' }, 'occurrence')
	},
	{
		what: 'was completed',
		after: ({ scope, cactus }) => completeTask(scope, cactus.id)
	},
	{
		what: 'was deleted',
		after: ({ scope, cactus }) => deleteTask(scope, cactus.id, 'occurrence')
	},
	{
		what: 'was reordered',
		after: ({ scope, listId, parent, cactus }, reed) =>
			moveTask(scope, reed.id, { listId, parentId: parent.id, before: cactus.id })
	}
];

/** A plain Task "Party", already changed, with "Cake" and a recurring Subtask "Candles". */
function recurringSubtask() {
	const db = createTestDb();
	const scope: UserScope = { db, userId: insertUser(db, 'alice').id };
	const listId = createList(scope, { name: 'Groceries' }).id;
	const party = add(scope, listId, 'Party');
	add(scope, listId, 'Cake', party.id);
	const candles = add(scope, listId, 'Candles', party.id);
	updateTask(scope, candles.id, { planned: dateOnly('2026-11-02'), recurrence: weekly });
	return { scope, listId, party, candles: getTask(scope, candles.id)! };
}

describe('when the state has moved on, Undo throws and overwrites nothing', () => {
	const MOVED_ON: { what: string; after: (family: Family) => unknown }[] = [
		{
			what: 'the parent was edited',
			after: ({ scope, parent }) => updateTask(scope, parent.id, { title: 'Water it all' })
		},
		{
			what: 'the parent was completed',
			after: ({ scope, parent }) => completeTask(scope, parent.id)
		},
		{
			what: 'the parent was deleted',
			after: ({ scope, parent }) => deleteTask(scope, parent.id)
		},
		{
			what: 'the parent was moved to another List',
			after: ({ scope, parent }) =>
				moveTask(scope, parent.id, {
					listId: createList(scope, { name: 'Elsewhere' }).id,
					parentId: null
				})
		},
		{
			what: 'a Task was moved in under the parent',
			after: ({ scope, listId, parent, moss }) =>
				moveTask(scope, moss.id, { listId, parentId: parent.id })
		}
	];

	it.each(MOVED_ON)('$what', ({ after }) => {
		const family = setUp();
		const undoId = deleteFernUndoably(family);
		after(family);
		const before = family.db.select().from(tasks).all();

		expect(() => undoLatest(family.scope, undoId)).toThrow(UndoConflictError);

		expect(family.db.select().from(tasks).all()).toEqual(before);
	});

	// The action changed the parent, so Undo would write it (its template, here) back.
	describe('a sibling, once the action has changed the parent', () => {
		it.each(LATER_TO_A_SIBLING)('$what', ({ after }) => {
			const family = setUp();
			const reed = add(family.scope, family.listId, 'Reed', family.parent.id);
			const undoId = deleteFernUndoably(family, 'occurrence');
			after(family, reed);
			const before = family.db.select().from(tasks).all();

			expect(() => undoLatest(family.scope, undoId)).toThrow(UndoConflictError);

			expect(family.db.select().from(tasks).all()).toEqual(before);
		});

		it('was added with "This Occurrence", which would otherwise reach future Occurrences', () => {
			const family = setUp();
			const { scope, listId, parent } = family;
			const undoId = deleteFernUndoably(family, 'occurrence');
			createTask(scope, { listId, title: 'Reed', parentId: parent.id }, 'occurrence');

			expect(() => undoLatest(scope, undoId)).toThrow(UndoConflictError);
		});
	});

	it('the next Occurrence of a skipped Subtask was changed, under an unchanged parent', () => {
		const { scope, candles } = recurringSubtask();
		const skipped = undoable(scope, () => deleteTask(scope, candles.id, 'occurrence'))!;
		updateTask(scope, skipped.nextOccurrenceId!, { title: 'Tall candles' });

		expect(() => undoLatest(scope, skipped.undoId!)).toThrow(UndoConflictError);

		expect(getTask(scope, skipped.nextOccurrenceId!)?.title).toBe('Tall candles');
		expect(getTask(scope, candles.id)).toBeUndefined();
	});

	it('a Subtask joined a next Occurrence Undo would delete', () => {
		const family = setUp();
		const skipped = undoable(family.scope, () =>
			deleteTask(family.scope, family.parent.id, 'occurrence')
		)!;
		const reed = add(family.scope, family.listId, 'Reed', skipped.nextOccurrenceId!);

		expect(() => undoLatest(family.scope, skipped.undoId!)).toThrow(UndoConflictError);
		expect(getTask(family.scope, reed.id)?.title).toBe('Reed');
	});

	it('a List to put a Task back into is gone, and it isn’t another User’s List of that id', () => {
		const family = setUp();
		const bob: UserScope = { db: family.db, userId: insertUser(family.db, 'bob').id };
		const undoId = undoable(family.scope, () =>
			deleteTask(family.scope, family.parent.id)
		)!.undoId!;
		// Not through `deleteList`, which would also drop the record: this is the check behind that.
		family.db.delete(lists).where(eq(lists.id, family.listId)).run();
		createList(bob, { id: family.listId, name: 'Bob’s' });

		expect(() => undoLatest(family.scope, undoId)).toThrow(/List is gone/);

		expect(getListTasks(bob, family.listId)).toEqual([]);
	});

	it('a Task the action deleted has come back', () => {
		const family = setUp();
		const undoId = deleteFernUndoably(family);
		createTask(family.scope, { id: family.fern.id, listId: family.listId, title: 'Fern again' });

		expect(() => undoLatest(family.scope, undoId)).toThrow(UndoConflictError);
		expect(getTask(family.scope, family.fern.id)?.title).toBe('Fern again');
	});

	it('another User has taken the id of a deleted Task: their Task is safe', () => {
		const family = setUp();
		const bob: UserScope = { db: family.db, userId: insertUser(family.db, 'bob').id };
		const undoId = deleteFernUndoably(family);
		const bobsList = createList(bob, { name: 'Bob' }).id;
		createTask(bob, { id: family.fern.id, listId: bobsList, title: 'Bob’s' });
		const before = wholeLists(family.scope, family.listId);

		expect(() => undoLatest(family.scope, undoId)).toThrow(/UNIQUE/);

		expect(getTask(bob, family.fern.id)?.title).toBe('Bob’s');
		expect(wholeLists(family.scope, family.listId)).toEqual(before);
	});

	it('the next Occurrence of a skipped one was changed: it isn’t discarded', () => {
		const family = setUp();
		const skipped = undoable(family.scope, () =>
			deleteTask(family.scope, family.parent.id, 'occurrence')
		)!;
		updateTask(family.scope, skipped.nextOccurrenceId!, { title: 'Water the ferns' });

		expect(() => undoLatest(family.scope, skipped.undoId!)).toThrow(UndoConflictError);
		expect(getTask(family.scope, skipped.nextOccurrenceId!)?.title).toBe('Water the ferns');
		expect(getTask(family.scope, family.parent.id)).toBeUndefined();
	});
});

describe('what doesn’t count as moving on', () => {
	it('a Subtask added next to a deleted one: a plain Task gets both', () => {
		const db = createTestDb();
		const scope: UserScope = { db, userId: insertUser(db, 'alice').id };
		const listId = createList(scope, { name: 'Groceries' }).id;
		const party = add(scope, listId, 'Party');
		const cake = add(scope, listId, 'Cake', party.id);
		add(scope, listId, 'Candles', party.id);
		const undoId = undoable(scope, () => deleteTask(scope, cake.id))!.undoId!;
		add(scope, listId, 'Balloons', party.id);

		expect(undoLatest(scope, undoId)).toBeDefined();

		const subtasks = getListTasks(scope, listId).filter((task) => task.parentId === party.id);
		expect(subtasks.map((task) => task.title)).toEqual(['Cake', 'Candles', 'Balloons']);
	});

	// The action didn't change the parent ("Fern" is deleted from all future Occurrences, and it has
	// no template), so Undo only puts "Fern" back and these changes stay.
	describe('a sibling, when the action didn’t change the parent', () => {
		it.each(LATER_TO_A_SIBLING)('$what', ({ after }) => {
			const family = setUp(false);
			const { scope, listId, parent, fern } = family;
			const reed = add(scope, listId, 'Reed', parent.id);
			const parentBefore = getTask(scope, parent.id);
			const undoId = deleteFernUndoably(family);
			expect(getTask(scope, parent.id)?.changedSinceGenerated).toBe(
				parentBefore?.changedSinceGenerated
			);
			after(family, reed);
			const later = wholeLists(scope, listId);

			const changes = undoLatest(scope, undoId)!;

			expect(changes.upserted.map((task) => task.id)).toEqual([fern.id]);
			expect(getTask(scope, fern.id)?.title).toBe('Fern');
			const fernId = fern.id;
			expect(wholeLists(scope, listId).filter((task) => task.id !== fernId)).toEqual(later);
		});

		it('of a recurring Task without a template, added for all future Occurrences', () => {
			const family = setUp();
			const { scope, listId, parent } = family;
			const undoId = deleteFernUndoably(family);
			add(scope, listId, 'Reed', parent.id);

			expect(undoLatest(scope, undoId)).toBeDefined();

			expect(nextSubtasks(family)).toEqual(['Fern', 'Cactus', 'Reed']);
		});
	});

	// All the action did to the parent was to mark it as changed, so Undo has no template to write.
	describe('a sibling of a Subtask of an Occurrence unchanged since it was generated', () => {
		/** The next Occurrence, with a third Subtask "Reed" it got from the previous one. */
		function generatedWithReed() {
			const family = setUp();
			add(family.scope, family.listId, 'Reed', family.parent.id);
			const previous = family.parent;
			const next = generated(family);
			const reed = getListTasks(next.scope, next.listId).find(
				(task) => task.parentId === next.parent.id && task.title === 'Reed'
			)!;
			const isChanged = () => getTask(next.scope, next.parent.id)?.changedSinceGenerated;
			expect(isChanged()).toBe(false);
			return { next, previous, reed, isChanged };
		}

		it.each<{ what: string; after: (family: Family, reed: Task) => unknown }>([
			{
				what: 'edited for all future Occurrences',
				after: ({ scope, cactus }) => updateTask(scope, cactus.id, { title: 'Cacti' }, 'future')
			},
			{
				what: 'completed',
				after: ({ scope, cactus }) => completeTask(scope, cactus.id)
			},
			{
				what: 'deleted from all future Occurrences',
				after: ({ scope, cactus }) => deleteTask(scope, cactus.id, 'future')
			},
			{
				what: 'reordered',
				after: ({ scope, listId, parent, cactus }, reed) =>
					moveTask(scope, reed.id, { listId, parentId: parent.id, before: cactus.id })
			}
		])('$what: the Subtask comes back, and the parent stays marked as changed', ({ after }) => {
			const { next, reed, isChanged } = generatedWithReed();
			const undoId = deleteFernUndoably(next);
			after(next, reed);

			const changes = undoLatest(next.scope, undoId)!;

			expect(changes.upserted.map((task) => task.id)).toEqual([next.fern.id]);
			expect(isChanged()).toBe(true);
		});

		it('added: the parent stays marked, so on Reopen the current Occurrence stays', () => {
			const { next, previous, isChanged } = generatedWithReed();
			const { scope, listId, parent, fern } = next;
			const undoId = deleteFernUndoably(next);
			const added = add(scope, listId, 'Moss', parent.id);

			undoLatest(scope, undoId);

			expect(getTask(scope, fern.id)?.title).toBe('Fern');
			expect(getTask(scope, added.id)?.title).toBe('Moss');
			expect(isChanged()).toBe(true);
			expect(reopenTask(scope, previous.id)?.deleted).toEqual([]);
			expect(getTask(scope, parent.id)).toBeDefined();
			expect(getTask(scope, previous.id)?.recurrence).toBeNull();
		});

		it('left alone: the parent’s mark goes back too, so on Reopen the current Occurrence gives way', () => {
			const { next, previous, isChanged } = generatedWithReed();
			const undoId = deleteFernUndoably(next);

			const changes = undoLatest(next.scope, undoId)!;

			expect(changes.upserted.map((task) => task.id).sort()).toEqual(
				[next.fern.id, next.parent.id].sort()
			);
			expect(isChanged()).toBe(false);
			expect(reopenTask(next.scope, previous.id)?.deleted).toContain(next.parent.id);
		});

		it('edited with "This Occurrence": that gives the parent a template, so it refuses', () => {
			const { next } = generatedWithReed();
			const { scope, cactus } = next;
			const undoId = deleteFernUndoably(next);
			updateTask(scope, cactus.id, { title: 'Cacti' }, 'occurrence');

			expect(() => undoLatest(scope, undoId)).toThrow(UndoConflictError);
		});

		it('deleted with "This Occurrence" the parent gets a template, so a later Subtask refuses', () => {
			const { next } = generatedWithReed();
			const { scope, listId, parent } = next;
			const undoId = deleteFernUndoably(next, 'occurrence');
			add(scope, listId, 'Moss', parent.id);

			expect(() => undoLatest(scope, undoId)).toThrow(UndoConflictError);
		});
	});

	it('changes to other Tasks of the List', () => {
		const family = setUp();
		const undoId = deleteFernUndoably(family);
		updateTask(family.scope, family.moss.id, { title: 'Mosses' });
		add(family.scope, family.listId, 'Another');

		expect(undoLatest(family.scope, undoId)).toBeDefined();

		expect(getTask(family.scope, family.fern.id)).toBeDefined();
		expect(getTask(family.scope, family.moss.id)?.title).toBe('Mosses');
	});

	it('a save that changes nothing but `updatedAt`', () => {
		const family = setUp();
		updateTask(family.scope, family.cactus.id, { title: 'Cacti' });
		const undoId = deleteFernUndoably(family);
		updateTask(family.scope, family.cactus.id, { title: 'Cacti' });

		expect(undoLatest(family.scope, undoId)).toBeDefined();
	});

	it('`updatedAt` of the whole family, once the action has changed the parent', () => {
		const family = setUp();
		const { db, scope, parent, cactus } = family;
		const undoId = deleteFernUndoably(family, 'occurrence');
		db.update(tasks)
			.set({ updatedAt: new Date(1000) })
			.where(inArray(tasks.id, [parent.id, cactus.id]))
			.run();

		expect(undoLatest(scope, undoId)).toBeDefined();
	});

	it('a recurring Subtask skipped under an unchanged parent: the next one goes again', () => {
		const { scope, listId, candles } = recurringSubtask();

		const changes = expectUndoRestoresLists(scope, [listId], () =>
			deleteTask(scope, candles.id, 'occurrence')
		);

		expect(changes.deleted).toHaveLength(1);
	});

	it('a sibling being gone that a restored Subtask came from: the link is cleared, not a failure', () => {
		const { scope, listId, candles } = recurringSubtask();
		const next = completeTask(scope, candles.id)!.upserted.find(
			(task) => task.parentId === candles.parentId && task.completedAt === null
		)!;
		expect(next.generatedFromTaskId).toBe(candles.id);
		const undoId = undoable(scope, () => deleteTask(scope, next.id))!.undoId!;
		deleteCompletedTasks(scope, listId);
		expect(getTask(scope, candles.id)).toBeUndefined();

		expect(undoLatest(scope, undoId)).toBeDefined();

		expect(getTask(scope, next.id)?.generatedFromTaskId).toBeNull();
	});

	it('the Occurrence a restored Task came from being gone: the link is cleared, as the foreign key would', () => {
		const family = setUp();
		const previous = family.parent;
		const next = generated(family).parent;
		const undoId = undoable(family.scope, () => deleteTask(family.scope, next.id))!.undoId!;
		deleteCompletedTasks(family.scope, family.listId);
		expect(getTask(family.scope, previous.id)).toBeUndefined();

		undoLatest(family.scope, undoId);

		expect(getTask(family.scope, next.id)?.generatedFromTaskId).toBeNull();
	});

	it('another User taking that Occurrence’s id: the link is cleared all the same', () => {
		const family = setUp();
		const bob: UserScope = { db: family.db, userId: insertUser(family.db, 'bob').id };
		const previous = family.parent;
		const next = generated(family).parent;
		const undoId = undoable(family.scope, () => deleteTask(family.scope, next.id))!.undoId!;
		deleteCompletedTasks(family.scope, family.listId);
		const bobsList = createList(bob, { name: 'Bob' }).id;
		createTask(bob, { id: previous.id, listId: bobsList, title: 'Bob’s' });

		undoLatest(family.scope, undoId);

		expect(getTask(family.scope, next.id)?.generatedFromTaskId).toBeNull();
	});
});

describe('a Subtask moved out, and a later change to a sibling', () => {
	const moveFernOut = (family: Family) => {
		const work = createList(family.scope, { name: 'Work' }).id;
		return undoable(family.scope, () =>
			moveTask(family.scope, family.fern.id, { listId: work, parentId: null })
		)!.undoId!;
	};
	const reorderReed = ({ scope, listId, parent, cactus }: Family, reed: Task) =>
		moveTask(scope, reed.id, { listId, parentId: parent.id, before: cactus.id });

	it('a plain parent: Undo applies, whatever happened to the sibling', () => {
		const family = setUp(false);
		const reed = add(family.scope, family.listId, 'Reed', family.parent.id);
		const undoId = moveFernOut(family);
		reorderReed(family, reed);
		deleteTask(family.scope, family.cactus.id);

		expect(undoLatest(family.scope, undoId)).toBeDefined();

		expect(getTask(family.scope, family.fern.id)?.parentId).toBe(family.parent.id);
	});

	it('a recurring parent with a template: Undo applies unless that template changed', () => {
		const family = withTemplate(setUp());
		const reed = add(family.scope, family.listId, 'Reed', family.parent.id);
		const undoId = moveFernOut(family);
		reorderReed(family, reed);
		completeTask(family.scope, family.cactus.id);

		const changed = withTemplate(setUp());
		const refused = moveFernOut(changed);
		updateTask(changed.scope, changed.cactus.id, { title: 'Prickly' }, 'future');

		expect(undoLatest(family.scope, undoId)).toBeDefined();
		expect(() => undoLatest(changed.scope, refused)).toThrow(UndoConflictError);
	});

	it('a recurring parent the move made keep a template: Undo refuses', () => {
		const family = setUp();
		const reed = add(family.scope, family.listId, 'Reed', family.parent.id);
		const undoId = moveFernOut(family);
		reorderReed(family, reed);

		expect(() => undoLatest(family.scope, undoId)).toThrow(UndoConflictError);
	});
});

describe('a Task whose Custom Order key was taken in the meantime', () => {
	/** A Task between the two that came to hold one key, to see that the two can be told apart. */
	function expectAMoveBetween(scope: UserScope, listId: string, parentId: string | null) {
		const siblings = getListTasks(scope, listId).filter((task) => task.parentId === parentId);
		expect(new Set(siblings.map((task) => task.position)).size).toBe(siblings.length);
		const newcomer = add(scope, listId, 'Newcomer');
		const after = siblings.at(-2)!;
		moveTask(scope, newcomer.id, { listId, parentId, after: after.id });
		const order = getListTasks(scope, listId)
			.filter((task) => task.parentId === parentId)
			.map((task) => task.id);
		expect(order.indexOf(newcomer.id)).toBe(order.indexOf(after.id) + 1);
	}

	it('the last Subtask comes back right before the sibling that took its key', () => {
		const family = setUp();
		const { scope, listId, parent, cactus } = family;
		const undoId = undoable(scope, () => deleteTask(scope, cactus.id))!.undoId!;
		const reed = add(scope, listId, 'Reed', parent.id);
		expect(reed.position).toBe(cactus.position);

		const changes = undoLatest(scope, undoId)!;

		const restored = changes.upserted.find((task) => task.id === cactus.id)!;
		expect(restored.position).not.toBe(cactus.position);
		const subtasks = getListTasks(scope, listId).filter((task) => task.parentId === parent.id);
		expect(subtasks.map((task) => task.title)).toEqual(['Fern', 'Cactus', 'Reed']);
		expectAMoveBetween(scope, listId, parent.id);
	});

	it('the top Task of a List comes back right before the Task that took its key', () => {
		const db = createTestDb();
		const scope: UserScope = { db, userId: insertUser(db, 'alice').id };
		const listId = createList(scope, { name: 'Chores' }).id;
		add(scope, listId, 'Milk');
		const top = add(scope, listId, 'Bread');
		const undoId = undoable(scope, () => deleteTask(scope, top.id))!.undoId!;
		const eggs = add(scope, listId, 'Eggs');
		expect(eggs.position).toBe(top.position);

		undoLatest(scope, undoId);

		const titles = getListTasks(scope, listId).map((task) => task.title);
		expect(titles).toEqual(['Bread', 'Eggs', 'Milk']);
		expectAMoveBetween(scope, listId, null);
	});

	it('a key nobody holds comes back as it was', () => {
		const family = setUp();
		const { scope, listId, parent, fern } = family;
		const undoId = deleteFernUndoably(family);
		add(scope, listId, 'Reed', parent.id);

		const changes = undoLatest(scope, undoId)!;

		expect(changes.upserted.find((task) => task.id === fern.id)?.position).toBe(fern.position);
	});
});

describe('restored Tasks that refer to each other', () => {
	it('come back in any order: the next Occurrence above the deleted one it came from', () => {
		const family = setUp();
		const { scope, listId } = family;
		const previous = family.parent;
		const next = generated(family).parent;
		moveTask(scope, next.id, { listId, parentId: null, before: previous.id });
		expect(getTask(scope, next.id)?.generatedFromTaskId).toBe(previous.id);

		expectUndoRestoresLists(scope, [listId], () => deleteTask(scope, previous.id));

		expect(getTask(scope, next.id)?.generatedFromTaskId).toBe(previous.id);
	});
});

describe('a record that can’t be read', () => {
	/** A top-level Task deleted with no effect elsewhere, so `after` is empty and nothing compares. */
	function deletedTask() {
		const db = createTestDb();
		const scope: UserScope = { db, userId: insertUser(db, 'alice').id };
		const listId = createList(scope, { name: 'Chores' }).id;
		const task = createTask(scope, {
			listId,
			title: 'Water plants',
			description: 'The ferns too',
			priority: 'high'
		})!.upserted[0];
		const undoId = undoable(scope, () => deleteTask(scope, task.id))!.undoId!;
		const before: Record<string, unknown>[] = JSON.parse(
			db.select().from(undoRecords).get()!.before
		);
		expect(JSON.parse(db.select().from(undoRecords).get()!.after)).toEqual([]);
		return { db, scope, listId, undoId, before };
	}

	it.each([
		{
			what: 'written when `tasks` had other columns',
			edit: ([{ description, priority, ...image }]: Record<string, unknown>[]) =>
				JSON.stringify([{ ...image, details: description, importance: priority }])
		},
		{
			what: 'written before `tasks` got a column',
			edit: ([image]: Record<string, unknown>[]) =>
				JSON.stringify([{ ...image, priority: undefined }])
		},
		{
			what: 'written after `tasks` lost a column',
			edit: ([image]: Record<string, unknown>[]) => JSON.stringify([{ ...image, extra: 1 }])
		},
		{
			what: 'with a corrupt date',
			edit: ([image]: Record<string, unknown>[]) =>
				JSON.stringify([{ ...image, createdAt: 'yesterday' }])
		},
		{
			what: 'with a corrupt Recurrence',
			edit: ([image]: Record<string, unknown>[]) =>
				JSON.stringify([{ ...image, recurrence: { frequency: 'sometimes' } }])
		},
		{ what: 'that isn’t a list', edit: () => '{"not":"a list"}' },
		{ what: 'that is an empty string', edit: () => '""' },
		{ what: 'that isn’t JSON', edit: () => 'not json' }
	])('$what is refused, and nothing is written', ({ edit }) => {
		const { db, scope, listId, undoId, before } = deletedTask();
		db.update(undoRecords)
			.set({ before: edit(before) })
			.run();

		expect(() => undoLatest(scope, undoId)).toThrow(UndoConflictError);

		expect(getListTasks(scope, listId)).toEqual([]);
	});

	it.each([
		{ what: 'that isn’t JSON', after: 'not json' },
		{ what: 'that is an empty string', after: '""' },
		{ what: 'with other columns', after: '[{"id":"x"}]' }
	])('an `after` $what is refused too, and nothing is written', ({ after }) => {
		const { db, scope, listId, undoId } = deletedTask();
		db.update(undoRecords).set({ after }).run();

		expect(() => undoLatest(scope, undoId)).toThrow(UndoConflictError);

		expect(getListTasks(scope, listId)).toEqual([]);
	});

	it('the next action replaces it', () => {
		const { db, scope, listId, undoId } = deletedTask();
		db.update(undoRecords).set({ before: 'not json' }).run();
		const milk = add(scope, listId, 'Milk');

		const done = undoable(scope, () => deleteTask(scope, milk.id))!;

		expect(undoLatest(scope, undoId)).toBeUndefined();
		expect(undoLatest(scope, done.undoId!)).toBeDefined();
	});

	it('a List’s deletion still drops it', () => {
		const { db, scope, listId } = deletedTask();
		db.update(undoRecords)
			.set({ before: `not json ${listId}` })
			.run();

		deleteList(scope, listId);

		expect(db.select().from(undoRecords).all()).toEqual([]);
	});
});

describe('deleting a List', () => {
	it('drops a record that touches it: nothing to undo, and no copies of its Tasks left', () => {
		const family = setUp();
		const undoId = deleteFernUndoably(family);

		deleteList(family.scope, family.listId);

		expect(family.db.select().from(undoRecords).all()).toEqual([]);
		expect(undoLatest(family.scope, undoId)).toBeUndefined();
	});

	it('leaves a record of another List in place', () => {
		const family = setUp();
		const other = createList(family.scope, { name: 'Other' }).id;
		const undoId = deleteFernUndoably(family);

		deleteList(family.scope, other);

		expect(undoLatest(family.scope, undoId)).toBeDefined();
	});

	it('drops a record that only touched it as where a Task went', () => {
		const family = setUp();
		const work = createList(family.scope, { name: 'Work' }).id;
		undoable(family.scope, () =>
			moveTask(family.scope, family.moss.id, { listId: work, parentId: null })
		);

		deleteList(family.scope, work);

		expect(family.db.select().from(undoRecords).all()).toEqual([]);
	});

	it('reads only that User’s record: theirs goes, and another User’s stays', () => {
		const family = setUp();
		const bob: UserScope = { db: family.db, userId: insertUser(family.db, 'bob').id };
		const undoId = deleteFernUndoably(family);
		const bobsList = createList(bob, { name: 'Bob' }).id;
		const bobsTask = add(bob, bobsList, 'Bob’s');
		undoable(bob, () => deleteTask(bob, bobsTask.id));

		deleteList(bob, bobsList);

		const left = family.db.select().from(undoRecords).all();
		expect(left.map((record) => record.userId)).toEqual([family.scope.userId]);
		expect(undoLatest(family.scope, undoId)).toBeDefined();
	});

	it('another User’s deletion doesn’t touch the record', () => {
		const family = setUp();
		const bob: UserScope = { db: family.db, userId: insertUser(family.db, 'bob').id };
		const undoId = deleteFernUndoably(family);

		expect(deleteList(bob, family.listId)).toBe(false);

		expect(undoLatest(family.scope, undoId)).toBeDefined();
	});
});
