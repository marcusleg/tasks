import ICAL from 'ical.js';
import { Temporal } from 'temporal-polyfill';
import { describe, expect, it } from 'vitest';
import { dateOnly, timedDueDate, timedPlannedDate, unsetDate } from './dates';
import { buildCalendar, type CalendarTask } from './ics';

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
		}
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
