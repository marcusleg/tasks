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
