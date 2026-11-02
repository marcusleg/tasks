import ICAL from 'ical.js';
import rrule from 'rrule';
import { Temporal } from 'temporal-polyfill';
import { describe, expect, it } from 'vitest';
import {
	dateOnly,
	timedDueDate,
	timedPlannedDate,
	toZonedDateTime,
	unsetDate,
	type TaskDate
} from './dates';
import { buildCalendar, type CalendarTask } from './ics';
import {
	nextOccurrence,
	parseRecurrence,
	stepDriver,
	type OccurrenceDates,
	type RecurrenceRule
} from './recurrence';

const { rrulestr } = rrule;
const now = Temporal.Instant.from('2026-11-02T08:30:15.123Z');

/** The content lines of an iCalendar document, unfolded (RFC 5545 §3.1). */
function lines(ics: string): string[] {
	return ics.replace(/\r\n[ \t]/g, '').split('\r\n');
}

function parse(ics: string): ICAL.Component {
	return new ICAL.Component(ICAL.parse(ics));
}

function task(overrides: Partial<CalendarTask> = {}): CalendarTask {
	return {
		id: 'task-1',
		title: 'Water the plants',
		description: '',
		listName: 'Home',
		url: 'https://tasks.example/lists/home/tasks/task-1',
		planned: unsetDate,
		due: unsetDate,
		undatedSubtasks: [],
		...overrides
	};
}

function calendarOf(...tasks: CalendarTask[]): string {
	return buildCalendar({ calendarName: 'Home', tasks, now });
}

function events(ics: string): ICAL.Component[] {
	return parse(ics).getAllSubcomponents('vevent');
}

/** The unfolded content lines of the only VEVENT. */
function eventLines(ics: string): string[] {
	const all = lines(ics);
	const begin = all.indexOf('BEGIN:VEVENT');
	expect(all.lastIndexOf('BEGIN:VEVENT')).toBe(begin);
	return all.slice(begin + 1, all.indexOf('END:VEVENT'));
}

describe('the calendar', () => {
	it('is a published Gregorian iCalendar with a name, refresh hint and CRLF line endings', () => {
		const ics = buildCalendar({ calendarName: 'Work', tasks: [], now });

		expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
		expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
		expect(ics.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
		const calendar = parse(ics);
		expect(calendar.name).toBe('vcalendar');
		expect(calendar.getFirstPropertyValue('version')).toBe('2.0');
		expect(calendar.getFirstPropertyValue('prodid')).toBe('-//marcusleg//Tasks//EN');
		expect(calendar.getFirstPropertyValue('calscale')).toBe('GREGORIAN');
		expect(calendar.getFirstPropertyValue('method')).toBe('PUBLISH');
		expect(calendar.getFirstPropertyValue('x-wr-calname')).toBe('Work');
		expect(lines(ics)).toContain('REFRESH-INTERVAL;VALUE=DURATION:PT1H');
		expect(lines(ics)).toContain('X-PUBLISHED-TTL:PT1H');
		expect(calendar.getAllSubcomponents()).toEqual([]);
	});

	it('takes a custom PRODID', () => {
		const ics = buildCalendar({ calendarName: 'Work', tasks: [], now, prodId: '-//Acme//X//EN' });

		expect(parse(ics).getFirstPropertyValue('prodid')).toBe('-//Acme//X//EN');
	});
});

describe('a date-only Planned Date', () => {
	it('is an all-day event lasting one day, titled with the Task title', () => {
		const ics = calendarOf(task({ planned: dateOnly('2026-11-04') }));

		expect(eventLines(ics)).toEqual(
			expect.arrayContaining([
				'UID:task-1-planned@tasks',
				'DTSTAMP:20261102T083015Z',
				'DTSTART;VALUE=DATE:20261104',
				'DTEND;VALUE=DATE:20261105',
				'SUMMARY:Water the plants'
			])
		);
		const [event] = events(ics);
		expect(event.getFirstPropertyValue('dtstart')?.toString()).toBe('2026-11-04');
		expect(event.getFirstPropertyValue('dtend')?.toString()).toBe('2026-11-05');
	});

	it('ends on the first day of the next month and year', () => {
		const ics = calendarOf(task({ planned: dateOnly('2026-12-31') }));

		expect(eventLines(ics)).toContain('DTEND;VALUE=DATE:20270101');
	});
});

describe('a Task without dates', () => {
	it('publishes no event', () => {
		expect(events(calendarOf(task()))).toEqual([]);
	});
});

describe('a date-only Due Date', () => {
	it('is an all-day event titled "Due: <title>"', () => {
		const ics = calendarOf(task({ due: dateOnly('2026-11-06') }));

		expect(eventLines(ics)).toEqual(
			expect.arrayContaining([
				'UID:task-1-due@tasks',
				'DTSTART;VALUE=DATE:20261106',
				'DTEND;VALUE=DATE:20261107',
				'SUMMARY:Due: Water the plants'
			])
		);
	});
});

describe('a Task with both dates', () => {
	it('publishes a Planned and a Due event with distinct UIDs', () => {
		const ics = calendarOf(task({ planned: dateOnly('2026-11-04'), due: dateOnly('2026-11-06') }));

		expect(
			events(ics).map((event) => [
				event.getFirstPropertyValue('uid'),
				event.getFirstPropertyValue('summary'),
				event.getFirstPropertyValue('dtstart')?.toString()
			])
		).toEqual([
			['task-1-planned@tasks', 'Water the plants', '2026-11-04'],
			['task-1-due@tasks', 'Due: Water the plants', '2026-11-06']
		]);
	});

	it('publishes only the Due event when both are the same date', () => {
		const ics = calendarOf(task({ planned: dateOnly('2026-11-04'), due: dateOnly('2026-11-04') }));

		expect(eventLines(ics)).toEqual(
			expect.arrayContaining([
				'UID:task-1-due@tasks',
				'DTSTART;VALUE=DATE:20261104',
				'SUMMARY:Due: Water the plants'
			])
		);
	});
});

describe('a timed Planned Date', () => {
	it('starts at its wall-clock time in its zone and lasts its Duration', () => {
		const ics = calendarOf(
			task({ planned: timedPlannedDate('2026-11-04T09:00', 'Europe/Berlin', 45) })
		);

		expect(eventLines(ics)).toEqual(
			expect.arrayContaining([
				'UID:task-1-planned@tasks',
				'DTSTART;TZID=Europe/Berlin:20261104T090000',
				'DTEND;TZID=Europe/Berlin:20261104T094500',
				'SUMMARY:Water the plants'
			])
		);
	});

	it('ends on the next day when its Duration crosses midnight', () => {
		const ics = calendarOf(
			task({ planned: timedPlannedDate('2026-11-04T23:30', 'America/New_York', 90) })
		);

		expect(eventLines(ics)).toContain('DTEND;TZID=America/New_York:20261105T010000');
	});

	it('lasts its Duration in elapsed time across a DST change', () => {
		// Clocks go back from 03:00 to 02:00 on 2026-10-25 in Berlin.
		const ics = calendarOf(
			task({ planned: timedPlannedDate('2026-10-25T01:00', 'Europe/Berlin', 180) })
		);

		expect(eventLines(ics)).toContain('DTEND;TZID=Europe/Berlin:20261025T030000');
	});

	it('uses DURATION when its end is a repeated wall-clock time that DTEND would misread', () => {
		// 01:30 CEST + 2 h is 02:30 CET, but a DTEND of 02:30 reads as the earlier 02:30 CEST.
		const ics = calendarOf(
			task({ planned: timedPlannedDate('2026-10-25T01:30', 'Europe/Berlin', 120) })
		);

		expect(eventLines(ics)).toContain('DURATION:PT120M');
		expect(eventLines(ics).some((line) => line.startsWith('DTEND'))).toBe(false);
	});
});

describe('a timed Due Date', () => {
	it('is a zero-length event at its wall-clock time in its zone', () => {
		const ics = calendarOf(task({ due: timedDueDate('2026-11-06T17:00', 'Europe/Berlin') }));

		const lines = eventLines(ics);
		expect(lines).toEqual(
			expect.arrayContaining([
				'UID:task-1-due@tasks',
				'DTSTART;TZID=Europe/Berlin:20261106T170000',
				'DURATION:PT0S',
				'SUMMARY:Due: Water the plants'
			])
		);
		expect(lines.some((line) => line.startsWith('DTEND'))).toBe(false);
		const event = new ICAL.Event(events(ics)[0]);
		expect(event.endDate.compare(event.startDate)).toBe(0);
	});

	it('can be published with a fixed length instead, for calendars that hide zero-length events', () => {
		const ics = buildCalendar({
			calendarName: 'Home',
			tasks: [task({ due: timedDueDate('2026-11-06T17:00', 'Europe/Berlin') })],
			now,
			dueEventMinutes: 1
		});

		expect(eventLines(ics)).toContain('DURATION:PT1M');
	});

	it.each([-1, 1.5, Number.NaN])('rejects a fixed length of %s minutes', (dueEventMinutes) => {
		expect(() => buildCalendar({ calendarName: 'Home', tasks: [], now, dueEventMinutes })).toThrow(
			RangeError
		);
	});
});

describe('a Task with both dates timed', () => {
	it('publishes only the Due event when both are the same time in the same zone', () => {
		const ics = calendarOf(
			task({
				planned: timedPlannedDate('2026-11-06T17:00', 'Europe/Berlin', 60),
				due: timedDueDate('2026-11-06T17:00', 'Europe/Berlin')
			})
		);

		expect(eventLines(ics)).toEqual(
			expect.arrayContaining([
				'UID:task-1-due@tasks',
				'DTSTART;TZID=Europe/Berlin:20261106T170000',
				'DURATION:PT0S',
				'SUMMARY:Due: Water the plants'
			])
		);
	});

	it.each([
		['a different time', timedDueDate('2026-11-06T18:00', 'Europe/Berlin')],
		['the same wall-clock time in another zone', timedDueDate('2026-11-06T17:00', 'Europe/London')],
		['the same day without a time', dateOnly('2026-11-06')]
	])('publishes both events when the Due Date is %s', (_, due) => {
		const ics = calendarOf(
			task({ planned: timedPlannedDate('2026-11-06T17:00', 'Europe/Berlin'), due })
		);

		expect(events(ics)).toHaveLength(2);
	});
});

describe('the event description', () => {
	const planned = dateOnly('2026-11-04');

	function description(overrides: Partial<CalendarTask>): string {
		return events(calendarOf(task({ planned, ...overrides })))[0].getFirstPropertyValue(
			'description'
		) as string;
	}

	it('names the List and links back to the Task', () => {
		const ics = calendarOf(task({ planned }));

		expect(description({})).toBe('List: Home\n\nhttps://tasks.example/lists/home/tasks/task-1');
		expect(events(ics)[0].getFirstPropertyValue('url')).toBe(
			'https://tasks.example/lists/home/tasks/task-1'
		);
	});

	it('includes the Task description', () => {
		expect(description({ description: 'Ficus twice,\ncactus once.' })).toBe(
			'List: Home\n\nFicus twice,\ncactus once.\n\nhttps://tasks.example/lists/home/tasks/task-1'
		);
	});

	it('lists undated Subtasks as a checklist', () => {
		const undatedSubtasks = [
			{ title: 'Fill the can', completed: true },
			{ title: 'Ficus', completed: false }
		];

		expect(description({ undatedSubtasks })).toBe(
			'List: Home\n\n☑ Fill the can\n☐ Ficus\n\nhttps://tasks.example/lists/home/tasks/task-1'
		);
	});

	it('names the parent of a dated Subtask', () => {
		expect(description({ title: 'Ficus', parentTitle: 'Water the plants' })).toBe(
			'List: Home\nSubtask of: Water the plants\n\nhttps://tasks.example/lists/home/tasks/task-1'
		);
	});

	it('is the same on the Due event', () => {
		const ics = calendarOf(
			task({ planned, due: dateOnly('2026-11-05'), description: 'Ficus twice.' })
		);

		const [plannedEvent, dueEvent] = events(ics);
		expect(dueEvent.getFirstPropertyValue('description')).toBe(
			plannedEvent.getFirstPropertyValue('description')
		);
	});
});

describe('text values', () => {
	const planned = dateOnly('2026-11-04');

	it('escape backslashes, semicolons, commas and newlines', () => {
		const title = 'Buy soil, pots; and C:\\Plants\\list\r\nthen water';
		const ics = calendarOf(task({ planned, title }));

		expect(eventLines(ics)).toContain(
			'SUMMARY:Buy soil\\, pots\\; and C:\\\\Plants\\\\list\\nthen water'
		);
		expect(events(ics)[0].getFirstPropertyValue('summary')).toBe(
			'Buy soil, pots; and C:\\Plants\\list\nthen water'
		);
	});

	it('round-trip in the calendar name, List name, description and checklist', () => {
		const ics = buildCalendar({
			calendarName: 'Home, garden; more',
			now,
			tasks: [
				task({
					planned,
					listName: 'A;B',
					description: 'one,\r\ntwo\\three',
					undatedSubtasks: [{ title: 'x,y', completed: false }]
				})
			]
		});

		// ical.js leaves X- properties unescaped, so check the content line itself.
		expect(lines(ics)).toContain('X-WR-CALNAME:Home\\, garden\\; more');
		expect(events(ics)[0].getFirstPropertyValue('description')).toBe(
			'List: A;B\n\none,\ntwo\\three\n\n☐ x,y\n\nhttps://tasks.example/lists/home/tasks/task-1'
		);
	});

	it('drop control characters that RFC 5545 does not allow', () => {
		const ics = calendarOf(task({ planned, title: 'Bell\u0007 and\ttab\u007f' }));

		expect(events(ics)[0].getFirstPropertyValue('summary')).toBe('Bell and\ttab');
	});
});

describe('long lines', () => {
	/** The physical lines as UTF-8 bytes. */
	function physicalLines(ics: string): Uint8Array[] {
		const bytes = new TextEncoder().encode(ics);
		const result: Uint8Array[] = [];
		let start = 0;
		for (let i = 0; i < bytes.length - 1; i++) {
			if (bytes[i] === 0x0d && bytes[i + 1] === 0x0a) {
				result.push(bytes.slice(start, i));
				start = i + 2;
			}
		}
		return result;
	}

	const title = 'Grüße an Jürgen 🌱🪴 schicken und Blumenerde für die Übertöpfe kaufen 🛒 '.repeat(
		4
	);
	const ics = calendarOf(
		task({ planned: dateOnly('2026-11-04'), title, description: 'Ä'.repeat(200) })
	);

	it('are folded to at most 75 octets without splitting a UTF-8 character', () => {
		const decoder = new TextDecoder('utf-8', { fatal: true });
		const physical = physicalLines(ics);

		expect(physical.length).toBeGreaterThan(lines(ics).length);
		for (const line of physical) {
			expect(line.length).toBeLessThanOrEqual(75);
			expect(() => decoder.decode(line)).not.toThrow();
		}
	});

	it('unfold to the original text', () => {
		const [event] = events(ics);

		expect(event.getFirstPropertyValue('summary')).toBe(title);
		expect(event.getFirstPropertyValue('description')).toContain('Ä'.repeat(200));
	});
});

describe('time zones', () => {
	function timezones(ics: string): string[] {
		return parse(ics)
			.getAllSubcomponents('vtimezone')
			.map((zone) => zone.getFirstPropertyValue('tzid') as string);
	}

	it('are defined once for every zone used, and not for all-day events', () => {
		const ics = calendarOf(
			task({ id: 'a', planned: timedPlannedDate('2026-11-04T09:00', 'Europe/Berlin') }),
			task({ id: 'b', due: timedDueDate('2026-11-05T09:00', 'America/New_York') }),
			task({
				id: 'c',
				planned: timedPlannedDate('2027-06-01T09:00', 'Europe/Berlin'),
				due: dateOnly('2027-06-02')
			}),
			task({ id: 'd', planned: dateOnly('2026-11-04') })
		);

		expect(timezones(ics).sort()).toEqual(['America/New_York', 'Europe/Berlin']);
		const all = lines(ics);
		expect(all.indexOf('BEGIN:VTIMEZONE')).toBeLessThan(all.indexOf('BEGIN:VEVENT'));
	});

	it('let a parser resolve timed events to the right instants in winter and summer', () => {
		const ics = calendarOf(
			task({ id: 'a', planned: timedPlannedDate('2026-11-04T09:00', 'Europe/Berlin', 30) }),
			task({ id: 'b', due: timedDueDate('2027-07-01T09:00', 'Europe/Berlin') })
		);

		const [winter, summer] = events(ics).map((component) => new ICAL.Event(component));
		expect(winter.startDate.toUnixTime()).toBe(
			Temporal.Instant.from('2026-11-04T08:00Z').epochMilliseconds / 1000
		);
		expect(winter.endDate.toUnixTime()).toBe(
			Temporal.Instant.from('2026-11-04T08:30Z').epochMilliseconds / 1000
		);
		expect(summer.startDate.toUnixTime()).toBe(
			Temporal.Instant.from('2027-07-01T07:00Z').epochMilliseconds / 1000
		);
	});
});

describe('time zone definitions', () => {
	/** The VTIMEZONE published for an event at `dateTime` in `zone`, as ical.js reads it. */
	function publishedZone(zone: string, dateTime = '2026-11-04T09:00'): ICAL.Timezone {
		const ics = calendarOf(task({ planned: timedPlannedDate(dateTime, zone) }));
		const [component] = parse(ics).getAllSubcomponents('vtimezone');
		return new ICAL.Timezone({ component, tzid: zone });
	}

	/**
	 * Instants every 53 hours (so every hour of the day comes up) from `fromYear` up to `toYear`, plus instants just either side of each
	 * transition (`transitions` is the tz database's list). ical.js converts UTC to local time
	 * through wall-clock lookups, which misplace instants less than the size of the offset change
	 * away from a transition (even with a canonical RRULE VTIMEZONE), so those are left out.
	 */
	function samples(
		zone: string,
		fromYear: number,
		toYear: number,
		transitions: Temporal.ZonedDateTime[]
	): Temporal.Instant[] {
		const start = Temporal.ZonedDateTime.from({ year: fromYear, month: 1, day: 1, timeZone: zone });
		const end = Temporal.ZonedDateTime.from({ year: toYear, month: 1, day: 1, timeZone: zone });
		const margin = (t: Temporal.ZonedDateTime) =>
			Math.abs(t.offsetNanoseconds - t.subtract({ nanoseconds: 1 }).offsetNanoseconds) + 60e9;
		const result: Temporal.ZonedDateTime[] = [];
		for (let t = start; Temporal.ZonedDateTime.compare(t, end) < 0; t = t.add({ hours: 53 })) {
			result.push(t);
		}
		for (const t of transitions) {
			result.push(t.subtract({ nanoseconds: margin(t) }), t.add({ nanoseconds: margin(t) }));
		}
		const farFromTransitions = (sample: Temporal.ZonedDateTime) =>
			transitions.every(
				(t) => Math.abs(Number(sample.epochNanoseconds - t.epochNanoseconds)) >= margin(t)
			);
		return result.filter(farFromTransitions).map((t) => t.toInstant());
	}

	/** The tz database's transitions in `zone` between the given years. */
	function tzTransitions(zone: string, fromYear: number, toYear: number) {
		const start = Temporal.ZonedDateTime.from({ year: fromYear, month: 1, day: 1, timeZone: zone });
		const end = Temporal.ZonedDateTime.from({ year: toYear, month: 1, day: 1, timeZone: zone });
		const result: Temporal.ZonedDateTime[] = [];
		// temporal-polyfill looks only ~3 years ahead, so probe from every year.
		for (
			let year = start;
			Temporal.ZonedDateTime.compare(year, end) < 0;
			year = year.add({ years: 1 })
		) {
			const yearEnd = year.add({ years: 1 });
			for (
				let t = year.getTimeZoneTransition('next');
				t && Temporal.ZonedDateTime.compare(t, yearEnd) < 0;
				t = t.getTimeZoneTransition('next')
			) {
				result.push(t);
			}
		}
		return result;
	}

	function zoneSamples(zone: string, fromYear: number, toYear: number) {
		return samples(zone, fromYear, toYear, tzTransitions(zone, fromYear, toYear));
	}

	/** Instants where ical.js reads a different UTC offset from the zone than the tz database has. */
	function mismatches(timezone: ICAL.Timezone, zone: string, instants: Temporal.Instant[]) {
		return instants.flatMap((instant) => {
			const utc = ICAL.Time.fromJSDate(new Date(instant.epochMilliseconds), true);
			const published = utc.convertToZone(timezone).utcOffset();
			const actual = instant.toZonedDateTimeISO(zone).offsetNanoseconds / 1e9;
			return published === actual ? [] : [`${instant.toString()}: ${published} ≠ ${actual}`];
		});
	}

	it.each([
		'Europe/Berlin',
		'America/New_York',
		'Australia/Sydney',
		'America/Sao_Paulo',
		'Africa/Casablanca',
		'Asia/Jerusalem',
		'Asia/Kolkata',
		'UTC'
	])('match the tz database in %s from the year before the event to ten years after', (zone) => {
		const timezone = publishedZone(zone);

		expect(mismatches(timezone, zone, zoneSamples(zone, 2025, 2037))).toEqual([]);
	});

	it.each(['Europe/Berlin', 'America/New_York', 'Australia/Sydney'])(
		'keep following the DST rules of %s for decades beyond that',
		(zone) => {
			const timezone = publishedZone(zone);

			expect(mismatches(timezone, zone, zoneSamples(zone, 2037, 2070))).toEqual([]);
		},
		// Samples three decades of instants through ical.js; takes several seconds on slow CI runners.
		30_000
	);

	it.each(['UTC', 'Asia/Kolkata', 'America/Sao_Paulo'])(
		'have a single STANDARD component for %s, which has no transitions',
		(zone) => {
			const ics = calendarOf(task({ planned: timedPlannedDate('2026-11-04T09:00', zone) }));
			const [component] = parse(ics).getAllSubcomponents('vtimezone');

			expect(component.getAllSubcomponents().map((c) => c.name)).toEqual(['standard']);
		}
	);
});

function rule(json: Record<string, unknown>): RecurrenceRule {
	return parseRecurrence({ interval: 1, end: { kind: 'never' }, anchor: 'schedule', ...json });
}

/** Start of a date as a comparable string: the date, or the UTC instant of a timed value. */
function startOf(date: TaskDate): string {
	if (date.kind === 'unset') throw new Error('unset date');
	return date.kind === 'date' ? date.date.toString() : toZonedDateTime(date).toInstant().toString();
}

/**
 * The Occurrences the app would create from `current` on, each completed on time (at its
 * scheduled driving date), up to `limit`.
 */
function appSeries(
	current: OccurrenceDates,
	recurrence: RecurrenceRule,
	occurrencesSoFar: number,
	limit: number
): OccurrenceDates[] {
	const series = [current];
	for (let n = occurrencesSoFar; series.length < limit; n++) {
		const dates = series[series.length - 1];
		const driver = dates[stepDriver(dates)];
		const completedAt =
			driver.kind === 'timed'
				? toZonedDateTime(driver)
				: driver.kind === 'date'
					? driver.date.toZonedDateTime('UTC')
					: undefined;
		const next = nextOccurrence({ ...dates, rule: recurrence, occurrencesSoFar: n, completedAt });
		if (!next) break;
		series.push(next);
	}
	return series;
}

/** Starts of the event's occurrences as ical.js expands them, up to `limit`. */
function expand(component: ICAL.Component, limit: number): string[] {
	const iterator = new ICAL.Event(component).iterator();
	const starts: string[] = [];
	for (let next = iterator.next(); next && starts.length < limit; next = iterator.next()) {
		starts.push(
			next.isDate
				? next.toString()
				: Temporal.Instant.fromEpochMilliseconds(next.toUnixTime() * 1000).toString()
		);
	}
	return starts;
}

function eventByUid(ics: string, uid: string): ICAL.Component {
	const found = events(ics).filter((event) => event.getFirstPropertyValue('uid') === uid);
	expect(found).toHaveLength(1);
	return found[0];
}

describe('a recurring Task', () => {
	const weekly = rule({ frequency: 'weekly', weekdays: [2] });
	const current: OccurrenceDates = {
		planned: timedPlannedDate('2026-10-20T09:00', 'Europe/Berlin', 60),
		due: timedDueDate('2026-10-23T17:00', 'Europe/Berlin')
	};
	const recurring = task({
		id: 'occurrence-3',
		...current,
		recurrence: { seriesId: 'series-1', rule: weekly, occurrencesSoFar: 3 }
	});

	it('publishes its Planned and Due events as series named after the Recurrence', () => {
		const ics = calendarOf(recurring);

		const planned = eventByUid(ics, 'series-1-planned@tasks');
		const due = eventByUid(ics, 'series-1-due@tasks');
		expect(planned.getFirstPropertyValue('rrule')?.toString()).toBe('FREQ=WEEKLY;BYDAY=TU');
		expect(due.getFirstPropertyValue('rrule')?.toString()).toBe('FREQ=WEEKLY;BYDAY=FR');
	});

	it('expands, across DST changes, to the dates the app steps to', () => {
		const ics = calendarOf(recurring);

		const app = appSeries(current, weekly, 3, 30);
		expect(expand(eventByUid(ics, 'series-1-planned@tasks'), 30)).toEqual(
			app.map((dates) => startOf(dates.planned))
		);
		expect(expand(eventByUid(ics, 'series-1-due@tasks'), 30)).toEqual(
			app.map((dates) => startOf(dates.due))
		);
	});

	it('keeps its UIDs when an Occurrence is completed and the next one takes its place', () => {
		const [next] = appSeries(current, weekly, 3, 2).slice(1);
		const before = calendarOf(recurring);
		const after = calendarOf(
			task({
				id: 'occurrence-4',
				...next,
				recurrence: { seriesId: 'series-1', rule: weekly, occurrencesSoFar: 4 }
			})
		);

		const uids = (ics: string) => events(ics).map((event) => event.getFirstPropertyValue('uid'));
		expect(uids(after)).toEqual(uids(before));
		expect(
			eventByUid(after, 'series-1-planned@tasks').getFirstPropertyValue('dtstart')?.toString()
		).toBe('2026-10-27T09:00:00');
	});
});

describe('a recurring series matches the app', () => {
	function check(current: OccurrenceDates, recurrence: RecurrenceRule, occurrencesSoFar = 1) {
		const ics = calendarOf(
			task({ ...current, recurrence: { seriesId: 's', rule: recurrence, occurrencesSoFar } })
		);
		const app = appSeries(current, recurrence, occurrencesSoFar, 60);
		for (const kind of ['planned', 'due'] as const) {
			if (current[kind].kind === 'unset') continue;
			expect(expand(eventByUid(ics, `s-${kind}@tasks`), 60), kind).toEqual(
				app.map((dates) => startOf(dates[kind]))
			);
		}
		return app;
	}

	it('for "after N times", publishing only the remaining Occurrences', () => {
		const app = check(
			{ planned: dateOnly('2026-11-04'), due: unsetDate },
			rule({ frequency: 'daily', interval: 2, end: { kind: 'count', count: 5 } }),
			2
		);

		expect(app).toHaveLength(4);
	});

	it('for an end date, in a timed series', () => {
		const app = check(
			{
				planned: timedPlannedDate('2026-11-04T23:30', 'America/New_York'),
				due: timedDueDate('2026-11-05T08:00', 'Europe/Berlin')
			},
			rule({ frequency: 'weekly', weekdays: [3, 6], end: { kind: 'until', date: '2027-02-27' } })
		);

		expect(app.length).toBeGreaterThan(20);
		expect(app.length).toBeLessThan(60);
	});

	it('for a series counted from completion, assuming each Occurrence is completed on time', () => {
		check(
			{ planned: dateOnly('2027-01-31'), due: dateOnly('2027-02-02') },
			rule({ frequency: 'monthly', monthDay: 31, anchor: 'completion' })
		);
	});

	it('for a yearly series on Feb 29', () => {
		check(
			{ planned: unsetDate, due: dateOnly('2028-02-29') },
			rule({ frequency: 'yearly', monthDay: 29 })
		);
	});

	it('with a single Due series when both dates are the same', () => {
		const current = {
			planned: timedPlannedDate('2026-11-04T09:00', 'Europe/Berlin'),
			due: timedDueDate('2026-11-04T09:00', 'Europe/Berlin')
		};
		const ics = calendarOf(
			task({
				...current,
				recurrence: { seriesId: 's', rule: rule({ frequency: 'daily' }), occurrencesSoFar: 1 }
			})
		);

		expect(events(ics).map((event) => event.getFirstPropertyValue('uid'))).toEqual(['s-due@tasks']);
		expect(expand(events(ics)[0], 3)).toEqual([
			'2026-11-04T08:00:00Z',
			'2026-11-05T08:00:00Z',
			'2026-11-06T08:00:00Z'
		]);
	});
});

describe('an Occurrence moved off its Recurrence ("This Occurrence")', () => {
	const weekly = rule({ frequency: 'weekly', weekdays: [2] });
	// The rule says Tuesdays; this Occurrence was moved to Wednesday.
	const moved: OccurrenceDates = {
		planned: timedPlannedDate('2026-10-21T09:00', 'Europe/Berlin', 60),
		due: dateOnly('2026-10-23')
	};

	function detached(recurrence: RecurrenceRule, occurrencesSoFar: number, dates = moved) {
		return task({
			id: 'occurrence-3',
			...dates,
			recurrence: { seriesId: 'series-1', rule: recurrence, occurrencesSoFar, detached: true }
		});
	}

	it('is published on its own, under its Task id and without an RRULE', () => {
		const ics = calendarOf(detached(weekly, 3));

		const planned = eventByUid(ics, 'occurrence-3-planned@tasks');
		const due = eventByUid(ics, 'occurrence-3-due@tasks');
		expect(planned.getFirstPropertyValue('dtstart')?.toString()).toBe('2026-10-21T09:00:00');
		expect(due.getFirstPropertyValue('dtstart')?.toString()).toBe('2026-10-23');
		expect(planned.hasProperty('rrule')).toBe(false);
		expect(due.hasProperty('rrule')).toBe(false);
	});

	it('is followed by the series, starting at the next Occurrence', () => {
		const ics = calendarOf(detached(weekly, 3));

		const next = nextOccurrence({ ...moved, rule: weekly, occurrencesSoFar: 3 })!;
		const app = appSeries(next, weekly, 4, 20);
		expect(startOf(app[0].planned)).toBe('2026-10-27T08:00:00Z');
		expect(expand(eventByUid(ics, 'series-1-planned@tasks'), 20)).toEqual(
			app.map((dates) => startOf(dates.planned))
		);
		expect(expand(eventByUid(ics, 'series-1-due@tasks'), 20)).toEqual(
			app.map((dates) => startOf(dates.due))
		);
	});

	it('is published alone when it is the last Occurrence', () => {
		const ics = calendarOf(detached(rule({ ...weekly, end: { kind: 'count', count: 3 } }), 3));

		expect(events(ics).map((event) => event.getFirstPropertyValue('uid'))).toEqual([
			'occurrence-3-planned@tasks',
			'occurrence-3-due@tasks'
		]);
	});

	it('counts a series from completion as if this Occurrence is completed on time', () => {
		const everyThreeDays = rule({ frequency: 'daily', interval: 3, anchor: 'completion' });
		const ics = calendarOf(
			detached(everyThreeDays, 1, { planned: dateOnly('2026-11-05'), due: unsetDate })
		);

		expect(expand(eventByUid(ics, 'series-1-planned@tasks'), 3)).toEqual([
			'2026-11-08',
			'2026-11-11',
			'2026-11-14'
		]);
	});
});

describe('a detached Occurrence with a series template', () => {
	// Weekly on Mondays at 09:00; this week's Occurrence moved to Tuesday 14:00 and renamed.
	const weekly = rule({ frequency: 'weekly', weekdays: [1] });
	const detached = task({
		id: 'occurrence-2',
		title: 'Water the ferns',
		planned: timedPlannedDate('2026-11-03T14:00', 'Europe/Berlin'),
		recurrence: {
			seriesId: 'series-1',
			rule: weekly,
			occurrencesSoFar: 2,
			detached: true,
			template: {
				title: 'Water the plants',
				description: 'All of them',
				planned: timedPlannedDate('2026-11-02T09:00', 'Europe/Berlin'),
				due: unsetDate
			}
		}
	});

	it('publishes the Occurrence as it is, on its own', () => {
		const event = eventByUid(calendarOf(detached), 'occurrence-2-planned@tasks');

		expect(event.getFirstPropertyValue('dtstart')?.toString()).toBe('2026-11-03T14:00:00');
		expect(event.getFirstPropertyValue('summary')).toBe('Water the ferns');
		expect(event.hasProperty('rrule')).toBe(false);
	});

	it('steps the series from the template’s dates, with its Title and Description', () => {
		const series = eventByUid(calendarOf(detached), 'series-1-planned@tasks');

		expect(expand(series, 2)).toEqual(['2026-11-09T08:00:00Z', '2026-11-16T08:00:00Z']);
		expect(series.getFirstPropertyValue('summary')).toBe('Water the plants');
		expect(series.getFirstPropertyValue('description')).toContain('All of them');
	});
});

describe('a monthly series on the 29th or 30th', () => {
	const monthly30 = task({
		planned: dateOnly('2027-01-30'),
		recurrence: {
			seriesId: 's',
			rule: rule({ frequency: 'monthly', monthDay: 30 }),
			occurrencesSoFar: 1
		}
	});

	it('uses a single BYMONTHDAY by default, the widely supported form, skipping February', () => {
		const ics = calendarOf(monthly30);

		expect(eventLines(ics)).toContain('RRULE:FREQ=MONTHLY;BYMONTHDAY=30');
		expect(expand(events(ics)[0], 3)).toEqual(['2027-01-30', '2027-03-30', '2027-04-30']);
	});

	it('can use the exact rule, which clamps to the end of February like the app', () => {
		const ics = buildCalendar({
			calendarName: 'Home',
			tasks: [monthly30],
			now,
			exactMonthEnd: true
		});

		const event = eventLines(ics);
		expect(event).toContain('RRULE:FREQ=MONTHLY;BYMONTHDAY=28,29,30;BYSETPOS=-1');
		// ical.js (as used by Thunderbird) wrongly expands this to the 28th of every month after
		// the first, so check it with the rrule reference implementation instead (which doesn't
		// read VALUE=DATE).
		const expanded = rrulestr(
			event
				.filter((line) => /^(DTSTART|RRULE)/.test(line))
				.map((line) => line.replace(';VALUE=DATE', ''))
				.join('\n')
		).all((_, i) => i < 3);
		expect(expanded.map((date) => date.toISOString().slice(0, 10))).toEqual([
			'2027-01-30',
			'2027-02-28',
			'2027-03-30'
		]);
	});
});
