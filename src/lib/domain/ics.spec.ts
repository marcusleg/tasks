import ICAL from 'ical.js';
import { Temporal } from 'temporal-polyfill';
import { describe, expect, it } from 'vitest';
import { dateOnly, unsetDate } from './dates';
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
