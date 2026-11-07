/**
 * Undo (CONTEXT.md → Undo, ADR 0004). `expectUndoRestoresLists` does the comparing; these specs say
 * which states and actions it has to hold for, and when Undo has to refuse.
 */
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { dateOnly } from '#lib/domain/dates.js';
import { parseRecurrence } from '#lib/domain/recurrence.js';
import type { ApplyTo } from '#lib/domain/recurring-tasks.js';
import { InvalidInputError } from '#lib/domain/validation.js';
import type { Task } from '#lib/domain/tasks.js';
import { tasks, undoRecords, users } from './db/schema';
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
		expect(records[0].before.map((task) => task.id)).toEqual([parent.id]);
		expect(records[0].after).toEqual([]);
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
			what: 'a sibling was edited',
			after: ({ scope, cactus }) => updateTask(scope, cactus.id, { title: 'Cacti' })
		},
		{
			what: 'a sibling was completed',
			after: ({ scope, cactus }) => completeTask(scope, cactus.id)
		},
		{
			what: 'a sibling was deleted',
			after: ({ scope, cactus }) => deleteTask(scope, cactus.id)
		},
		{
			what: 'a Subtask was added',
			after: ({ scope, listId, parent }) => add(scope, listId, 'Reed', parent.id)
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

	it('the List was deleted', () => {
		const family = setUp();
		const undoId = undoable(family.scope, () =>
			deleteTask(family.scope, family.parent.id)
		)!.undoId!;
		deleteList(family.scope, family.listId);

		expect(() => undoLatest(family.scope, undoId)).toThrow(/List is gone/);
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
});
