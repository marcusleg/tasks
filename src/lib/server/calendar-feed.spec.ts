import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { Temporal } from 'temporal-polyfill';
import { dateOnly, unsetDate, type DueDate, type PlannedDate } from '#lib/domain/dates.js';
import type { RecurrenceRule } from '#lib/domain/recurrence.js';
import { buildCalendarLinkFeed, feedFilename, toCalendarTasks } from './calendar-feed';
import { createCalendarLink } from './calendar-links';
import { dueColumns, plannedColumns, recurrenceColumn } from './db/mapping';
import { tasks } from './db/schema';
import { createList } from './lists';
import type { UserScope } from './scope';
import { createTask, getTask } from './tasks';
import { createTestDb, insertUser } from './testing/index';

const ORIGIN = 'https://tasks.example.com';
const NOW = Temporal.Instant.from('2026-03-01T10:00:00Z');

function setUp() {
	const db = createTestDb();
	const alice: UserScope = { db, userId: insertUser(db, 'alice').id };
	const bob: UserScope = { db, userId: insertUser(db, 'bob').id };
	return { db, alice, bob };
}

interface Extra {
	planned?: PlannedDate;
	due?: DueDate;
	parentId?: string;
	completed?: boolean;
	recurrence?: RecurrenceRule;
}

/** Creates a Task through the data layer, then sets its dates and state directly. */
function add(scope: UserScope, listId: string, title: string, extra: Extra = {}) {
	const changes = createTask(scope, { listId, title, parentId: extra.parentId });
	const id = changes!.upserted[0].id;
	scope.db
		.update(tasks)
		.set({
			...plannedColumns(extra.planned ?? unsetDate),
			...dueColumns(extra.due ?? unsetDate),
			completedAt: extra.completed ? new Date() : null,
			...(extra.recurrence
				? { ...recurrenceColumn(extra.recurrence), seriesId: `series-${title}` }
				: {})
		})
		.where(eq(tasks.id, id))
		.run();
	return getTask(scope, id)!;
}

const day = (date: string) => dateOnly(date);
const weekly: RecurrenceRule = {
	frequency: 'weekly',
	interval: 1,
	weekdays: [1],
	anchor: 'schedule',
	end: { kind: 'never' }
} as RecurrenceRule;

function mapAll(scope: UserScope, listId: string) {
	return () =>
		toCalendarTasks({
			tasks: allTasks(scope, listId),
			listNames: new Map([[listId, 'L']]),
			origin: ORIGIN
		});
}

function allTasks(scope: UserScope, listId: string) {
	return scope.db
		.select({ id: tasks.id })
		.from(tasks)
		.where(eq(tasks.listId, listId))
		.all()
		.map((row) => getTask(scope, row.id)!);
}

describe('toCalendarTasks', () => {
	it('publishes dated open Tasks with a deep link and skips undated and Completed ones', () => {
		const { alice } = setUp();
		const list = createList(alice, { name: 'L' });
		const dated = add(alice, list.id, 'Dated', { planned: day('2026-03-05') });
		add(alice, list.id, 'Undated');
		add(alice, list.id, 'Done', { planned: day('2026-03-05'), completed: true });

		const result = mapAll(alice, list.id)();
		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			id: dated.id,
			title: 'Dated',
			listName: 'L',
			url: `${ORIGIN}/lists/${list.id}?task=${dated.id}`
		});
		expect(result[0].recurrence).toBeUndefined();
	});

	it('puts undated Subtasks in the parent checklist and publishes dated Subtasks on their own', () => {
		const { alice } = setUp();
		const list = createList(alice, { name: 'L' });
		const parent = add(alice, list.id, 'Parent', { due: day('2026-03-10') });
		add(alice, list.id, 'Open sub', { parentId: parent.id });
		add(alice, list.id, 'Done sub', { parentId: parent.id, completed: true });
		add(alice, list.id, 'Dated sub', { parentId: parent.id, planned: day('2026-03-07') });
		add(alice, list.id, 'Completed dated sub', {
			parentId: parent.id,
			planned: day('2026-03-07'),
			completed: true
		});

		const result = mapAll(alice, list.id)();
		expect(result.map((t) => t.title).sort()).toEqual(['Dated sub', 'Parent']);
		expect(result.find((t) => t.title === 'Parent')?.undatedSubtasks).toEqual([
			{ title: 'Open sub', completed: false },
			{ title: 'Done sub', completed: true }
		]);
		const sub = result.find((t) => t.title === 'Dated sub')!;
		expect(sub.parentTitle).toBe('Parent');
		expect(sub.undatedSubtasks).toEqual([]);
	});

	it('publishes dated Subtasks of an undated parent, but not the parent', () => {
		const { alice } = setUp();
		const list = createList(alice, { name: 'L' });
		const parent = add(alice, list.id, 'Parent');
		add(alice, list.id, 'Sub', { parentId: parent.id, due: day('2026-03-07') });

		expect(mapAll(alice, list.id)().map((t) => t.title)).toEqual(['Sub']);
	});

	it('leaves out recurring Subtasks of a Completed parent', () => {
		const { alice } = setUp();
		const list = createList(alice, { name: 'L' });
		const parent = add(alice, list.id, 'Parent', { due: day('2026-03-10') });
		add(alice, list.id, 'Recurring sub', {
			parentId: parent.id,
			planned: day('2026-03-07'),
			recurrence: weekly
		});
		// Completed parents can't get new Subtasks, so mark the parent Completed afterwards.
		alice.db.update(tasks).set({ completedAt: new Date() }).where(eq(tasks.id, parent.id)).run();

		expect(mapAll(alice, list.id)()).toEqual([]);
	});

	it('passes the Recurrence of a recurring Task', () => {
		const { alice } = setUp();
		const list = createList(alice, { name: 'L' });
		add(alice, list.id, 'Weekly', { planned: day('2026-03-02'), recurrence: weekly });

		const [task] = mapAll(alice, list.id)();
		expect(task.recurrence).toMatchObject({
			seriesId: 'series-Weekly',
			occurrencesSoFar: 1,
			rule: weekly
		});
		expect(task.recurrence?.detached).toBeUndefined();
	});
});

describe('buildCalendarLinkFeed', () => {
	it('covers the chosen Lists, or all Lists including later ones', () => {
		const { db, alice } = setUp();
		const a = createList(alice, { name: 'A' });
		add(alice, a.id, 'In A', { planned: day('2026-03-05') });
		const all = createCalendarLink(alice, { name: 'Everything' });
		const onlyA = createCalendarLink(alice, { name: 'Just A', listIds: [a.id] });

		const b = createList(alice, { name: 'B' });
		add(alice, b.id, 'In B', { planned: day('2026-03-06') });

		const feed = (link: typeof all) => buildCalendarLinkFeed(db, link, ORIGIN, NOW);
		expect(feed(all)).toContain('SUMMARY:In A');
		expect(feed(all)).toContain('SUMMARY:In B');
		expect(feed(onlyA)).toContain('SUMMARY:In A');
		expect(feed(onlyA)).not.toContain('In B');
		expect(feed(all)).toContain('X-WR-CALNAME:Everything');
	});

	it("never includes another User's Tasks", () => {
		const { db, alice, bob } = setUp();
		const mine = createList(alice, { name: 'Mine' });
		add(alice, mine.id, 'My task', { planned: day('2026-03-05') });
		const theirs = createList(bob, { name: 'Theirs' });
		add(bob, theirs.id, 'Secret task', { planned: day('2026-03-05') });

		const link = createCalendarLink(alice, { name: 'x' });
		const feed = buildCalendarLinkFeed(db, link, ORIGIN, NOW);
		expect(feed).toContain('My task');
		expect(feed).not.toContain('Secret');
	});
});

describe('feedFilename', () => {
	it('slugifies the name', () => {
		expect(feedFilename('Proton Calendar!')).toBe('proton-calendar.ics');
		expect(feedFilename('日本語')).toBe('calendar.ics');
	});
});
