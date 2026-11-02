import { Temporal } from 'temporal-polyfill';
import { describe, expect, it } from 'vitest';
import { dateOnly, timedDueDate, timedPlannedDate, unsetDate, type TaskDate } from './dates';
import {
	compareTaskDates,
	describeTaskDate,
	formatTaskDate,
	isOverdue,
	isPlannedAfterDue,
	isToday,
	isTomorrow,
	viewerDateTime,
	type Viewer
} from './date-display';

const at = (iso: string, timeZone: string): Viewer => ({
	now: Temporal.Instant.from(iso),
	timeZone
});

describe('isToday', () => {
	it('is true for a date-only value on the viewer’s current date', () => {
		expect(isToday(dateOnly('2026-11-04'), at('2026-11-04T12:00Z', 'Europe/Berlin'))).toBe(true);
		expect(isToday(dateOnly('2026-11-05'), at('2026-11-04T12:00Z', 'Europe/Berlin'))).toBe(false);
	});

	it('takes a date-only value’s date as is, in whatever zone the viewer is', () => {
		// 2026-11-04 23:30 in New York is already 2026-11-05 in Berlin.
		const now = '2026-11-05T04:30Z';

		expect(isToday(dateOnly('2026-11-04'), at(now, 'America/New_York'))).toBe(true);
		expect(isToday(dateOnly('2026-11-04'), at(now, 'Europe/Berlin'))).toBe(false);
	});

	it('converts a timed value into the viewer’s zone first', () => {
		// 23:30 in Berlin is 17:30 the same day in New York and 07:30 the next day in Tokyo.
		const late = timedDueDate('2026-11-04T23:30', 'Europe/Berlin');

		expect(isToday(late, at('2026-11-04T10:00Z', 'America/New_York'))).toBe(true);
		expect(isToday(late, at('2026-11-04T10:00Z', 'Asia/Tokyo'))).toBe(false);
		expect(isToday(late, at('2026-11-05T01:00Z', 'Asia/Tokyo'))).toBe(true);
	});

	it('is false for an unset date', () => {
		expect(isToday({ kind: 'unset' }, at('2026-11-04T12:00Z', 'Europe/Berlin'))).toBe(false);
	});
});

describe('isOverdue', () => {
	it('is overdue once a date-only Due Date’s day has passed for the viewer', () => {
		const due = dateOnly('2026-11-04');

		expect(isOverdue(due, at('2026-11-04T22:59Z', 'Europe/Berlin'))).toBe(false);
		expect(isOverdue(due, at('2026-11-04T23:00Z', 'Europe/Berlin'))).toBe(true);
		// Still the 4th in New York.
		expect(isOverdue(due, at('2026-11-04T23:00Z', 'America/New_York'))).toBe(false);
	});

	it('is overdue once the instant of a timed Due Date has passed, wherever the viewer is', () => {
		const due = timedDueDate('2026-11-04T09:00', 'Europe/Berlin');

		for (const zone of ['Europe/Berlin', 'America/New_York', 'Asia/Tokyo']) {
			expect(isOverdue(due, at('2026-11-04T07:59Z', zone))).toBe(false);
			expect(isOverdue(due, at('2026-11-04T08:01Z', zone))).toBe(true);
		}
	});

	it('uses the offset in force on that day when DST has just ended', () => {
		// New York leaves DST at 02:00 on 2026-11-01. 04:30Z on the 2nd is 23:30 on the 1st there
		// (UTC−5); with the summer offset (UTC−4) it would wrongly be the 2nd already.
		const due = dateOnly('2026-11-01');

		expect(isOverdue(due, at('2026-11-02T04:30Z', 'America/New_York'))).toBe(false);
		expect(isToday(due, at('2026-11-02T04:30Z', 'America/New_York'))).toBe(true);
		expect(isOverdue(due, at('2026-11-02T05:00Z', 'America/New_York'))).toBe(true);
	});

	it('resolves a timed Due Date in the DST overlap to the earlier instant', () => {
		// 02:30 happens twice in Berlin on 2026-10-25: first at 00:30Z (CEST), then 01:30Z (CET).
		const due = timedDueDate('2026-10-25T02:30', 'Europe/Berlin');

		expect(isOverdue(due, at('2026-10-25T00:29Z', 'Europe/Berlin'))).toBe(false);
		expect(isOverdue(due, at('2026-10-25T00:45Z', 'Europe/Berlin'))).toBe(true);
	});

	it('resolves a timed Due Date in the DST gap forward', () => {
		// 02:30 doesn't exist in Berlin on 2026-03-29; it means 03:30 CEST (01:30Z).
		const due = timedDueDate('2026-03-29T02:30', 'Europe/Berlin');

		expect(isOverdue(due, at('2026-03-29T01:29Z', 'Europe/Berlin'))).toBe(false);
		expect(isOverdue(due, at('2026-03-29T01:31Z', 'Europe/Berlin'))).toBe(true);
	});

	it('is never overdue when unset', () => {
		expect(isOverdue({ kind: 'unset' }, at('2026-11-04T12:00Z', 'Europe/Berlin'))).toBe(false);
	});
});

describe('isTomorrow', () => {
	it('is true for the viewer’s next calendar day', () => {
		const viewer = at('2026-11-04T12:00Z', 'Europe/Berlin');

		expect(isTomorrow(dateOnly('2026-11-05'), viewer)).toBe(true);
		expect(isTomorrow(dateOnly('2026-11-04'), viewer)).toBe(false);
		expect(isTomorrow(dateOnly('2026-11-06'), viewer)).toBe(false);
		expect(isTomorrow({ kind: 'unset' }, viewer)).toBe(false);
	});

	it('converts a timed value into the viewer’s zone first', () => {
		// 01:00 on the 5th in Berlin is still the 4th (19:00) in New York.
		const early = timedDueDate('2026-11-05T01:00', 'Europe/Berlin');

		expect(isTomorrow(early, at('2026-11-04T12:00Z', 'Europe/Berlin'))).toBe(true);
		expect(isTomorrow(early, at('2026-11-04T12:00Z', 'America/New_York'))).toBe(false);
	});
});

describe('compareTaskDates', () => {
	const sorted = (values: TaskDate[], timeZone: string) =>
		[...values].sort((a, b) => compareTaskDates(a, b, timeZone));

	it('orders date-only values by date and puts unset values last', () => {
		const values = [
			dateOnly('2026-11-06'),
			unsetDate,
			dateOnly('2026-11-04'),
			dateOnly('2027-01-01')
		];

		expect(sorted(values, 'Europe/Berlin')).toEqual([
			dateOnly('2026-11-04'),
			dateOnly('2026-11-06'),
			dateOnly('2027-01-01'),
			unsetDate
		]);
	});

	it('orders timed values by the instant they happen, not their wall-clock time', () => {
		const berlin = timedDueDate('2026-11-04T09:00', 'Europe/Berlin'); // 08:00Z
		const newYork = timedDueDate('2026-11-04T04:00', 'America/New_York'); // 09:00Z
		const planned = timedPlannedDate('2026-11-04T08:30', 'Europe/London', 60); // 08:30Z

		expect(sorted([newYork, planned, berlin], 'Europe/Berlin')).toEqual([berlin, planned, newYork]);
	});

	it('puts a date-only value before timed values on the same day', () => {
		const morning = timedDueDate('2026-11-04T00:00', 'Europe/Berlin');
		const allDay = dateOnly('2026-11-04');

		expect(sorted([morning, allDay], 'Europe/Berlin')).toEqual([allDay, morning]);
		expect(sorted([dateOnly('2026-11-05'), morning], 'Europe/Berlin')).toEqual([
			morning,
			dateOnly('2026-11-05')
		]);
	});

	it('decides the day of a timed value in the viewer’s zone', () => {
		// 01:00 on the 5th in Berlin is 19:00 on the 4th in New York.
		const early = timedDueDate('2026-11-05T01:00', 'Europe/Berlin');
		const allDay = dateOnly('2026-11-05');

		expect(sorted([early, allDay], 'Europe/Berlin')).toEqual([allDay, early]);
		expect(sorted([allDay, early], 'America/New_York')).toEqual([early, allDay]);
	});

	it('treats equal values as equal', () => {
		expect(compareTaskDates(unsetDate, unsetDate, 'Europe/Berlin')).toBe(0);
		expect(compareTaskDates(dateOnly('2026-11-04'), dateOnly('2026-11-04'), 'UTC')).toBe(0);
		// The same instant written in two zones.
		expect(
			compareTaskDates(
				timedDueDate('2026-11-04T09:00', 'Europe/Berlin'),
				timedDueDate('2026-11-04T08:00', 'Europe/London'),
				'UTC'
			)
		).toBe(0);
	});
});

describe('isPlannedAfterDue', () => {
	const zone = 'Europe/Berlin';

	it('compares two date-only values by date', () => {
		expect(isPlannedAfterDue(dateOnly('2026-11-05'), dateOnly('2026-11-04'), zone)).toBe(true);
		expect(isPlannedAfterDue(dateOnly('2026-11-04'), dateOnly('2026-11-04'), zone)).toBe(false);
		expect(isPlannedAfterDue(dateOnly('2026-11-03'), dateOnly('2026-11-04'), zone)).toBe(false);
	});

	it('compares two timed values by instant, across zones', () => {
		const due = timedDueDate('2026-11-04T09:00', 'Europe/Berlin'); // 08:00Z

		expect(
			isPlannedAfterDue(timedPlannedDate('2026-11-04T03:30', 'America/New_York'), due, zone)
		).toBe(true); // 08:30Z
		expect(
			isPlannedAfterDue(timedPlannedDate('2026-11-04T08:00', 'Europe/London'), due, zone)
		).toBe(false); // same instant
	});

	it('lets a timed value fall anywhere on the day of a date-only one', () => {
		expect(
			isPlannedAfterDue(timedPlannedDate('2026-11-04T23:00', zone), dateOnly('2026-11-04'), zone)
		).toBe(false);
		expect(
			isPlannedAfterDue(timedPlannedDate('2026-11-05T00:00', zone), dateOnly('2026-11-04'), zone)
		).toBe(true);
		expect(
			isPlannedAfterDue(dateOnly('2026-11-04'), timedDueDate('2026-11-04T00:30', zone), zone)
		).toBe(false);
		expect(
			isPlannedAfterDue(dateOnly('2026-11-05'), timedDueDate('2026-11-04T23:30', zone), zone)
		).toBe(true);
	});

	it('never warns while either date is unset', () => {
		expect(isPlannedAfterDue(unsetDate, dateOnly('2026-11-04'), zone)).toBe(false);
		expect(isPlannedAfterDue(dateOnly('2026-11-05'), unsetDate, zone)).toBe(false);
	});
});

describe('formatTaskDate', () => {
	// Wednesday, 4 November 2026, midday in Berlin.
	const viewer: Viewer = { ...at('2026-11-04T11:00Z', 'Europe/Berlin'), locale: 'en-GB' };
	const format = (value: TaskDate, v: Viewer = viewer) => formatTaskDate(value, v);

	it('names today, tomorrow and yesterday', () => {
		expect(format(dateOnly('2026-11-04'))).toBe('Today');
		expect(format(dateOnly('2026-11-05'))).toBe('Tomorrow');
		expect(format(dateOnly('2026-11-03'))).toBe('Yesterday');
	});

	it('names the weekday for the rest of the coming week', () => {
		expect(format(dateOnly('2026-11-06'))).toBe('Fri');
		expect(format(dateOnly('2026-11-10'))).toBe('Tue');
	});

	it('shows day and month further out or further back, and the year when it differs', () => {
		expect(format(dateOnly('2026-11-11'))).toBe('11 Nov');
		expect(format(dateOnly('2026-10-30'))).toBe('30 Oct');
		expect(format(dateOnly('2027-01-03'))).toBe('3 Jan 2027');
		expect(format(dateOnly('2026-11-11'), { ...viewer, locale: 'en-US' })).toBe('Nov 11');
	});

	it('adds the time of a timed value in the viewer’s zone and locale', () => {
		expect(format(timedPlannedDate('2026-11-04T09:00', 'Europe/Berlin'))).toBe('Today 09:00');
		expect(format(timedDueDate('2026-11-06T17:30', 'Europe/Berlin'))).toBe('Fri 17:30');
		expect(
			format(timedDueDate('2026-11-04T09:00', 'Europe/Berlin'), { ...viewer, locale: 'en-US' })
		).toMatch(/^Today 9:00\sAM$/);
	});

	it('shows a summer 09:00 in Berlin as 03:00 to a viewer in New York', () => {
		const summer = timedDueDate('2026-07-15T09:00', 'Europe/Berlin');
		const newYork: Viewer = { ...at('2026-07-15T12:00Z', 'America/New_York'), locale: 'en-GB' };

		expect(format(summer, newYork)).toBe('Today 03:00');
	});

	it('uses the viewer’s day for a timed value set in another zone', () => {
		// 01:00 on Thursday in Berlin is still Wednesday evening in New York.
		const early = timedDueDate('2026-11-05T01:00', 'Europe/Berlin');
		const newYork: Viewer = { ...viewer, timeZone: 'America/New_York' };

		expect(format(early)).toBe('Tomorrow 01:00');
		expect(format(early, newYork)).toBe('Today 19:00');
	});

	it('is empty for an unset date', () => {
		expect(format(unsetDate)).toBe('');
	});
});

describe('describeTaskDate', () => {
	const viewer: Viewer = { ...at('2026-07-15T12:00Z', 'America/New_York'), locale: 'en-GB' };

	it('spells out the full date, and the time in the viewer’s zone', () => {
		expect(describeTaskDate(dateOnly('2026-07-17'), viewer)).toBe('Friday, 17 July 2026');
		expect(describeTaskDate(timedDueDate('2026-07-15T09:00', 'Europe/Berlin'), viewer)).toBe(
			'Wednesday, 15 July 2026 at 03:00'
		);
	});
});

describe('viewerDateTime', () => {
	it('is the wall-clock date-time of a timed value in the viewer’s zone', () => {
		const summer = timedPlannedDate('2026-07-15T09:00', 'Europe/Berlin');

		expect(viewerDateTime(summer, 'America/New_York').toString()).toBe('2026-07-15T03:00:00');
		expect(viewerDateTime(summer, 'Europe/Berlin').toString()).toBe('2026-07-15T09:00:00');
	});
});
