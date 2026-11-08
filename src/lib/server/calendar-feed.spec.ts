import { eq } from 'drizzle-orm';
import ICAL from 'ical.js';
import { describe, expect, it } from 'vitest';
import { Temporal } from 'temporal-polyfill';
import {
	dateOnly,
	timedPlannedDate,
	unsetDate,
	type DueDate,
	type PlannedDate
} from '#lib/domain/dates.js';
import { isLanguagePreference } from '#lib/language.js';
import { parseRecurrence, type RecurrenceRule } from '#lib/domain/recurrence.js';
import { buildCalendarLinkFeed, feedFilename, toCalendarTasks } from './calendar-feed';
import { createCalendarLink, findCalendarLinkByToken } from './calendar-links';
import { setLanguagePreference } from './language-preference';
import { dueColumns, plannedColumns, recurrenceColumn } from './db/mapping';
import { tasks, userPreferences } from './db/schema';
import { createList } from './lists';
import type { UserScope } from './scope';
import { completeTask, createTask, deleteTask, getTask, updateTask } from './tasks';
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

describe("buildCalendarLinkFeed in the owner's Language (#79)", () => {
	/** The feed as the public endpoint builds it: the link looked up by token, no session. */
	function publicFeed(preference: string | undefined) {
		const { db, alice, bob } = setUp();
		if (preference && isLanguagePreference(preference)) {
			setLanguagePreference(alice, preference, 'en');
		}
		// Bob chose German; Alice's feed must not follow him.
		setLanguagePreference(bob, 'de', 'en');
		const list = createList(alice, { name: 'Home' });
		if (preference && !isLanguagePreference(preference)) {
			// Not storable through the API: a value from a removed Language, say.
			db.update(userPreferences)
				.set({ languagePreference: preference })
				.where(eq(userPreferences.userId, alice.userId))
				.run();
		}
		const parent = add(alice, list.id, 'Garden');
		const child = add(alice, list.id, 'Water', {
			parentId: parent.id,
			planned: day('2026-03-05'),
			due: day('2026-03-06')
		});
		const link = createCalendarLink(alice, { name: 'x' });
		const feed = buildCalendarLinkFeed(db, findCalendarLinkByToken(db, link.token)!, ORIGIN, NOW);
		return { feed, childId: child.id };
	}

	it('is German for an owner who chose Deutsch', () => {
		const { feed } = publicFeed('de');
		expect(feed).toContain('SUMMARY:Fällig: Water');
		expect(feed).toContain('DESCRIPTION:Liste: Home\\nUnteraufgabe von: Garden');
		expect(feed).not.toContain('Due:');
	});

	it.each([['en'], ['automatic'], ['fr'], [undefined]])(
		'is English for an owner on %s',
		(preference) => {
			const { feed } = publicFeed(preference);
			expect(feed).toContain('SUMMARY:Due: Water');
			expect(feed).toContain('DESCRIPTION:List: Home\\nSubtask of: Garden');
		}
	);

	it('keeps the event UIDs whatever the Language', () => {
		const german = publicFeed('de');
		const english = publicFeed('en');
		const uids = (feed: string, id: string) => [`UID:${id}-planned@tasks`, `UID:${id}-due@tasks`];
		for (const { feed, childId } of [german, english]) {
			for (const uid of uids(feed, childId)) expect(feed).toContain(uid);
		}
	});
});

describe('buildCalendarLinkFeed with recurring Tasks', () => {
	it('publishes the current Occurrence as a series that moves on as Occurrences are completed', () => {
		const { db, alice } = setUp();
		const list = createList(alice, { name: 'Chores' });
		const task = add(alice, list.id, 'Water plants', { planned: day('2026-03-04') });
		updateTask(alice, task.id, {
			recurrence: parseRecurrence({
				frequency: 'weekly',
				interval: 1,
				end: { kind: 'count', count: 3 },
				anchor: 'schedule'
			})
		});
		const link = createCalendarLink(alice, { name: 'Chores' });
		const seriesId = getTask(alice, task.id)!.seriesId;
		const feed = () => buildCalendarLinkFeed(db, link, ORIGIN, NOW);

		expect(feed()).toContain(`UID:${seriesId}-planned@tasks`);
		expect(feed()).toContain('DTSTART;VALUE=DATE:20260304');
		expect(feed()).toContain('RRULE:FREQ=WEEKLY;BYDAY=WE;COUNT=3');

		completeTask(alice, task.id);

		const after = feed();
		expect(after.match(/BEGIN:VEVENT/g)).toHaveLength(1);
		expect(after).toContain(`UID:${seriesId}-planned@tasks`);
		expect(after).toContain('DTSTART;VALUE=DATE:20260311');
		expect(after).toContain('RRULE:FREQ=WEEKLY;BYDAY=WE;COUNT=2');
	});
});

/** The feed's events, as ical.js reads them. */
function eventsOf(feed: string): ICAL.Event[] {
	return new ICAL.Component(ICAL.parse(feed))
		.getAllSubcomponents('vevent')
		.map((component) => new ICAL.Event(component));
}

/** The first `count` starts of an event (series or not), as ical.js expands them. */
function starts(event: ICAL.Event, count = 3): string[] {
	const iterator = event.iterator();
	const result: string[] = [];
	for (let next = iterator.next(); next && result.length < count; next = iterator.next()) {
		result.push(next.toString());
	}
	return result;
}

function byUid(feed: string, uid: string): ICAL.Event {
	const event = eventsOf(feed).find((candidate) => candidate.uid === uid);
	if (!event) throw new Error(`No event ${uid} in the feed`);
	return event;
}

describe('buildCalendarLinkFeed: recurring Tasks as event series (#20)', () => {
	function recurring(scope: UserScope, listId: string, title: string, fields: object) {
		const task = add(scope, listId, title);
		updateTask(scope, task.id, fields);
		return getTask(scope, task.id)!;
	}

	const rule = (fields: Record<string, unknown>) =>
		parseRecurrence({ interval: 1, end: { kind: 'never' }, anchor: 'schedule', ...fields });

	it('keeps the series UID across completions while the series moves on', () => {
		const { db, alice } = setUp();
		const list = createList(alice, { name: 'Chores' });
		const task = recurring(alice, list.id, 'Water plants', {
			planned: day('2026-03-02'),
			recurrence: rule({ frequency: 'weekly' })
		});
		const link = createCalendarLink(alice, { name: 'Chores' });
		const uid = `${task.seriesId}-planned@tasks`;

		expect(starts(byUid(buildCalendarLinkFeed(db, link, ORIGIN, NOW), uid))).toEqual([
			'2026-03-02',
			'2026-03-09',
			'2026-03-16'
		]);
		const second = completeTask(alice, task.id)!.upserted.find((t) => t.completedAt === null)!;
		completeTask(alice, second.id);

		const feed = buildCalendarLinkFeed(db, link, ORIGIN, NOW);
		expect(eventsOf(feed).map((event) => event.uid)).toEqual([uid]);
		expect(starts(byUid(feed, uid))).toEqual(['2026-03-16', '2026-03-23', '2026-03-30']);
	});

	it('ends the series with COUNT (what is left) or UNTIL', () => {
		const { db, alice } = setUp();
		const list = createList(alice, { name: 'Chores' });
		const counted = recurring(alice, list.id, 'Course', {
			planned: day('2026-03-02'),
			recurrence: rule({ frequency: 'weekly', end: { kind: 'count', count: 3 } })
		});
		const until = recurring(alice, list.id, 'Season', {
			due: day('2026-03-03'),
			recurrence: rule({ frequency: 'weekly', end: { kind: 'until', date: '2026-03-17' } })
		});
		completeTask(alice, counted.id);
		const link = createCalendarLink(alice, { name: 'Chores' });

		const feed = buildCalendarLinkFeed(db, link, ORIGIN, NOW);
		expect(starts(byUid(feed, `${counted.seriesId}-planned@tasks`), 5)).toEqual([
			'2026-03-09',
			'2026-03-16'
		]);
		expect(starts(byUid(feed, `${until.seriesId}-due@tasks`), 5)).toEqual([
			'2026-03-03',
			'2026-03-10',
			'2026-03-17'
		]);
	});

	it('projects a completion-anchored series as if each Occurrence is completed on time', () => {
		const { db, alice } = setUp();
		const list = createList(alice, { name: 'Self' });
		const task = recurring(alice, list.id, 'Haircut', {
			planned: day('2026-03-02'),
			recurrence: rule({ frequency: 'daily', interval: 10, anchor: 'completion' })
		});
		const link = createCalendarLink(alice, { name: 'Self' });

		const feed = buildCalendarLinkFeed(db, link, ORIGIN, NOW);
		expect(starts(byUid(feed, `${task.seriesId}-planned@tasks`))).toEqual([
			'2026-03-02',
			'2026-03-12',
			'2026-03-22'
		]);
	});

	it('leaves out a recurring Subtask of a Completed parent', () => {
		const { db, alice } = setUp();
		const list = createList(alice, { name: 'Garden' });
		const parent = add(alice, list.id, 'Garden');
		const subtask = add(alice, list.id, 'Water plants', { parentId: parent.id });
		updateTask(alice, subtask.id, {
			planned: day('2026-03-04'),
			recurrence: rule({ frequency: 'weekly' })
		});
		const link = createCalendarLink(alice, { name: 'Garden' });
		expect(eventsOf(buildCalendarLinkFeed(db, link, ORIGIN, NOW))).toHaveLength(1);

		completeTask(alice, parent.id);

		expect(eventsOf(buildCalendarLinkFeed(db, link, ORIGIN, NOW))).toEqual([]);
	});

	describe('an Occurrence changed with "This Occurrence"', () => {
		/** Weekly on Mondays at 09:00 (Berlin); this week's moved to Tuesday 14:00. */
		function moved(db: ReturnType<typeof setUp>['db'], alice: UserScope) {
			const list = createList(alice, { name: 'Chores' });
			const task = recurring(alice, list.id, 'Water plants', {
				planned: timedPlannedDate('2026-03-02T09:00', 'Europe/Berlin'),
				recurrence: rule({ frequency: 'weekly', end: { kind: 'count', count: 3 } })
			});
			updateTask(
				alice,
				task.id,
				{
					title: 'Water the ferns',
					planned: timedPlannedDate('2026-03-03T14:00', 'Europe/Berlin')
				},
				'occurrence'
			);
			const link = createCalendarLink(alice, { name: 'Chores' });
			return { task, feed: () => buildCalendarLinkFeed(db, link, ORIGIN, NOW) };
		}

		it('is passed on as detached, with the template the series steps from', () => {
			const { alice } = setUp();
			const list = createList(alice, { name: 'L' });
			const task = recurring(alice, list.id, 'Water plants', {
				planned: day('2026-03-02'),
				recurrence: rule({ frequency: 'weekly' })
			});
			updateTask(alice, task.id, { planned: day('2026-03-03') }, 'occurrence');

			const [calendarTask] = mapAll(alice, list.id)();
			expect(calendarTask.recurrence).toMatchObject({
				detached: true,
				template: { title: 'Water plants', planned: day('2026-03-02') }
			});
		});

		it('is published on its own, followed by the series from the template', () => {
			const { db, alice } = setUp();
			const { task, feed } = moved(db, alice);

			const single = byUid(feed(), `${task.id}-planned@tasks`);
			expect(starts(single)).toEqual(['2026-03-03T14:00:00']);
			expect(single.summary).toBe('Water the ferns');
			const series = byUid(feed(), `${task.seriesId}-planned@tasks`);
			// Two Occurrences are left after this one, on Mondays at 09:00 as before.
			expect(starts(series, 5)).toEqual(['2026-03-09T09:00:00', '2026-03-16T09:00:00']);
			expect(series.summary).toBe('Water plants');
		});

		it('once completed, gives way to the series under the same UID', () => {
			const { db, alice } = setUp();
			const { task, feed } = moved(db, alice);

			completeTask(alice, task.id, new Date('2026-03-03T14:30:00Z'));

			expect(eventsOf(feed()).map((event) => event.uid)).toEqual([
				`${task.seriesId}-planned@tasks`
			]);
			expect(starts(byUid(feed(), `${task.seriesId}-planned@tasks`), 5)).toEqual([
				'2026-03-09T09:00:00',
				'2026-03-16T09:00:00'
			]);
		});

		it('when skipped, is replaced by the series from the next Occurrence', () => {
			const { db, alice } = setUp();
			const { task, feed } = moved(db, alice);

			deleteTask(alice, task.id, 'occurrence');

			expect(eventsOf(feed()).map((event) => event.uid)).toEqual([
				`${task.seriesId}-planned@tasks`
			]);
			expect(starts(byUid(feed(), `${task.seriesId}-planned@tasks`), 5)).toEqual([
				'2026-03-09T09:00:00',
				'2026-03-16T09:00:00'
			]);
		});
	});
});

describe('feedFilename', () => {
	it('slugifies the name', () => {
		expect(feedFilename('Phone Calendar!')).toBe('phone-calendar.ics');
		expect(feedFilename('日本語')).toBe('calendar.ics');
	});
});
