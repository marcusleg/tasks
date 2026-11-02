import { Temporal } from 'temporal-polyfill';
import rrule from 'rrule';
import { describe, expect, it } from 'vitest';
import {
	parseDueDate,
	parsePlannedDate,
	serializeDueDate,
	serializePlannedDate,
	timedPlannedDate,
	toZonedDateTime,
	unsetDate,
	type TimedDueDate
} from './dates';
import {
	InvalidRecurrenceError,
	nextOccurrence,
	parseRecurrence,
	serializeRecurrence,
	stepDriver,
	toRRules
} from './recurrence';

const { rrulestr } = rrule;

describe('Recurrence serialization', () => {
	it.each([
		{ frequency: 'daily', interval: 1, end: { kind: 'never' }, anchor: 'schedule' },
		{
			frequency: 'weekly',
			interval: 2,
			weekdays: [1, 3, 5],
			end: { kind: 'count', count: 10 },
			anchor: 'schedule'
		},
		{
			frequency: 'monthly',
			interval: 1,
			monthDay: 31,
			end: { kind: 'until', date: '2027-06-30' },
			anchor: 'schedule'
		},
		{ frequency: 'monthly', interval: 3, end: { kind: 'never' }, anchor: 'completion' },
		{ frequency: 'yearly', interval: 1, monthDay: 29, end: { kind: 'never' }, anchor: 'schedule' }
	])('round-trips $frequency every $interval', (json) => {
		expect(serializeRecurrence(parseRecurrence(json))).toEqual(json);
	});

	const daily = { frequency: 'daily', interval: 1, end: { kind: 'never' }, anchor: 'schedule' };
	const weekly = { ...daily, frequency: 'weekly' };
	const monthly = { ...daily, frequency: 'monthly' };

	it.each([
		['a non-object', 'FREQ=DAILY'],
		['null', null],
		['an unknown frequency', { ...daily, frequency: 'hourly' }],
		['a zero interval', { ...daily, interval: 0 }],
		['a fractional interval', { ...daily, interval: 1.5 }],
		['a missing interval', { ...daily, interval: undefined }],
		['weekdays on a daily rule', { ...daily, weekdays: [1] }],
		['empty weekdays', { ...weekly, weekdays: [] }],
		['an out-of-range weekday', { ...weekly, weekdays: [0] }],
		['a weekday name', { ...weekly, weekdays: ['MO'] }],
		['duplicate weekdays', { ...weekly, weekdays: [2, 2] }],
		['a month day on a weekly rule', { ...weekly, monthDay: 3 }],
		['month day 0', { ...monthly, monthDay: 0 }],
		['month day 32', { ...monthly, monthDay: 32 }],
		['a missing end', { ...daily, end: undefined }],
		['an unknown end', { ...daily, end: { kind: 'eventually' } }],
		['an invalid until date', { ...daily, end: { kind: 'until', date: '2027-02-29' } }],
		['a zero count', { ...daily, end: { kind: 'count', count: 0 } }],
		['a fractional count', { ...daily, end: { kind: 'count', count: 2.5 } }],
		['an unknown anchor', { ...daily, anchor: 'due' }]
	])('rejects %s', (_, json) => {
		expect(() => parseRecurrence(json)).toThrow(InvalidRecurrenceError);
	});

	it('sorts weekdays', () => {
		const rule = parseRecurrence({ ...weekly, weekdays: [5, 1, 3] });

		expect(serializeRecurrence(rule)).toEqual({ ...weekly, weekdays: [1, 3, 5] });
	});
});

type SerializedOccurrence = { planned: unknown; due: unknown };

/** Steps once from the given (serialized) Occurrence and returns the next one, serialized. */
function stepOnce(
	current: SerializedOccurrence,
	rule: Record<string, unknown>,
	options: { occurrencesSoFar?: number; completedAt?: string } = {}
) {
	const next = nextOccurrence({
		planned: parsePlannedDate(current.planned),
		due: parseDueDate(current.due),
		rule: parseRecurrence({ interval: 1, end: { kind: 'never' }, anchor: 'schedule', ...rule }),
		occurrencesSoFar: options.occurrencesSoFar ?? 1,
		completedAt:
			options.completedAt === undefined
				? undefined
				: Temporal.ZonedDateTime.from(options.completedAt)
	});
	return next && { planned: serializePlannedDate(next.planned), due: serializeDueDate(next.due) };
}

const dailyRule = { frequency: 'daily', interval: 1, end: { kind: 'never' }, anchor: 'schedule' };
/** The next `count` date-only Planned Dates after `from`. */
function plannedSeries(from: string, rule: Record<string, unknown>, count: number): string[] {
	const dates: string[] = [];
	let current: SerializedOccurrence = { planned: day(from), due: null };
	for (let i = 1; i <= count; i++) {
		const next = stepOnce(current, rule, { occurrencesSoFar: i });
		if (!next) break;
		dates.push((next.planned as { date: string }).date);
		current = next;
	}
	return dates;
}

const day = (date: string) => ({ kind: 'date', date });
const timed = (dateTime: string, timeZone: string, durationMinutes = 30) => ({
	kind: 'timed',
	dateTime,
	timeZone,
	durationMinutes
});
const timedDue = (dateTime: string, timeZone: string) => ({ kind: 'timed', dateTime, timeZone });

describe('next Occurrence', () => {
	describe('daily', () => {
		it('moves a date-only Planned Date to the next day', () => {
			const next = stepOnce({ planned: day('2026-11-04'), due: null }, { frequency: 'daily' });

			expect(next).toEqual({ planned: day('2026-11-05'), due: null });
		});

		it('moves Planned and Due Date together by the interval, keeping their offset', () => {
			const next = stepOnce(
				{ planned: day('2026-11-04'), due: day('2026-11-06') },
				{ frequency: 'daily', interval: 3 }
			);

			expect(next).toEqual({ planned: day('2026-11-07'), due: day('2026-11-09') });
		});

		it('moves a Due Date when it is the only date', () => {
			const next = stepOnce({ planned: null, due: day('2026-12-31') }, { frequency: 'daily' });

			expect(next).toEqual({ planned: null, due: day('2027-01-01') });
		});

		it('keeps the time of day, zone and Duration of timed dates', () => {
			const next = stepOnce(
				{
					planned: timed('2026-11-04T09:00', 'Europe/Berlin', 90),
					due: timedDue('2026-11-04T17:00', 'America/New_York')
				},
				{ frequency: 'daily', interval: 2 }
			);

			expect(next).toEqual({
				planned: timed('2026-11-06T09:00', 'Europe/Berlin', 90),
				due: timedDue('2026-11-06T17:00', 'America/New_York')
			});
		});

		it('moves a date-only Due Date along with a timed Planned Date', () => {
			const next = stepOnce(
				{ planned: timed('2026-11-04T22:00', 'America/New_York'), due: day('2026-11-05') },
				{ frequency: 'daily' }
			);

			expect(next).toEqual({
				planned: timed('2026-11-05T22:00', 'America/New_York'),
				due: day('2026-11-06')
			});
		});
	});
	describe('weekly', () => {
		// 2026-11-02 is a Monday.
		it.each([
			['every week on its own weekday', { interval: 1 }, '2026-11-04', '2026-11-11'],
			['every 2 weeks on its own weekday', { interval: 2 }, '2026-11-04', '2026-11-18'],
			['Mon/Wed/Fri from Monday', { weekdays: [1, 3, 5] }, '2026-11-02', '2026-11-04'],
			['Mon/Wed/Fri from Wednesday', { weekdays: [1, 3, 5] }, '2026-11-04', '2026-11-06'],
			['Mon/Wed/Fri from Friday', { weekdays: [1, 3, 5] }, '2026-11-06', '2026-11-09'],
			[
				'every 2 weeks Mon/Thu from Monday',
				{ interval: 2, weekdays: [1, 4] },
				'2026-11-02',
				'2026-11-05'
			],
			[
				'every 2 weeks Mon/Thu from Thursday',
				{ interval: 2, weekdays: [1, 4] },
				'2026-11-05',
				'2026-11-16'
			],
			[
				'every 3 weeks Mon/Sun from Sunday',
				{ interval: 3, weekdays: [1, 7] },
				'2026-11-08',
				'2026-11-23'
			],
			['Mon/Fri from an off-rule Tuesday', { weekdays: [1, 5] }, '2026-11-03', '2026-11-06']
		])('%s', (_, rule, from, to) => {
			const next = stepOnce({ planned: day(from), due: null }, { frequency: 'weekly', ...rule });

			expect(next).toEqual({ planned: day(to), due: null });
		});

		it('moves the Due Date by the same number of days as the Planned Date', () => {
			const next = stepOnce(
				{ planned: day('2026-11-02'), due: day('2026-11-04') },
				{ frequency: 'weekly', weekdays: [1, 3] }
			);

			expect(next).toEqual({ planned: day('2026-11-04'), due: day('2026-11-06') });
		});

		it('is driven by the Due Date when it is earlier than the Planned Date', () => {
			const next = stepOnce(
				{ planned: day('2026-11-04'), due: day('2026-11-02') },
				{ frequency: 'weekly', weekdays: [1, 5] }
			);

			expect(next).toEqual({ planned: day('2026-11-08'), due: day('2026-11-06') });
		});

		it('compares the local dates of timed values to pick the driver', () => {
			const next = stepOnce(
				{
					planned: timed('2026-11-03T23:30', 'America/Los_Angeles'),
					due: timedDue('2026-11-04T07:00', 'Europe/Berlin')
				},
				{ frequency: 'weekly', weekdays: [2, 4] }
			);

			expect(next).toEqual({
				planned: timed('2026-11-05T23:30', 'America/Los_Angeles'),
				due: timedDue('2026-11-06T07:00', 'Europe/Berlin')
			});
		});
	});

	describe('monthly', () => {
		it.each([
			['on its own day', { interval: 1 }, '2026-11-04', ['2026-12-04', '2027-01-04']],
			['every 3 months', { interval: 3 }, '2026-11-04', ['2027-02-04', '2027-05-04']],
			[
				'on the 31st, clamped in shorter months and back to the 31st after',
				{ monthDay: 31 },
				'2027-01-31',
				['2027-02-28', '2027-03-31', '2027-04-30', '2027-05-31']
			],
			['on the 31st in a leap year', { monthDay: 31 }, '2028-01-31', ['2028-02-29', '2028-03-31']],
			['on the 30th', { monthDay: 30 }, '2027-01-30', ['2027-02-28', '2027-03-30']],
			['on the 29th in a leap year', { monthDay: 29 }, '2028-01-29', ['2028-02-29', '2028-03-29']],
			['over the year boundary', { monthDay: 31 }, '2026-12-31', ['2027-01-31', '2027-02-28']],
			['back onto the rule from an off-rule date', { monthDay: 15 }, '2026-11-17', ['2026-12-15']],
			[
				'every 2 months on the 31st',
				{ interval: 2, monthDay: 31 },
				'2026-12-31',
				['2027-02-28', '2027-04-30', '2027-06-30', '2027-08-31']
			]
		])('%s', (_, rule, from, expected) => {
			expect(plannedSeries(from, { frequency: 'monthly', ...rule }, expected.length)).toEqual(
				expected
			);
		});

		it('uses the current day when the rule has no month day', () => {
			expect(plannedSeries('2027-02-28', { frequency: 'monthly' }, 1)).toEqual(['2027-03-28']);
		});
	});

	describe('yearly', () => {
		it.each([
			['on its own date', { interval: 1 }, '2026-11-04', ['2027-11-04', '2028-11-04']],
			['every 2 years', { interval: 2 }, '2026-11-04', ['2028-11-04', '2030-11-04']],
			[
				'on Feb 29, clamped to Feb 28 and back in leap years',
				{ monthDay: 29 },
				'2028-02-29',
				['2029-02-28', '2030-02-28', '2031-02-28', '2032-02-29']
			],
			['every 4 years on Feb 29', { interval: 4, monthDay: 29 }, '2028-02-29', ['2032-02-29']]
		])('%s', (_, rule, from, expected) => {
			expect(plannedSeries(from, { frequency: 'yearly', ...rule }, expected.length)).toEqual(
				expected
			);
		});

		it('stays on Feb 28 when the rule has no month day', () => {
			expect(plannedSeries('2028-02-29', { frequency: 'yearly' }, 5)).toEqual([
				'2029-02-28',
				'2030-02-28',
				'2031-02-28',
				'2032-02-28',
				'2033-02-28'
			]);
		});
	});

	describe('counted from completion', () => {
		const afterCompletion = { anchor: 'completion' };

		it('steps from the completion date instead of the scheduled date', () => {
			const next = stepOnce(
				{ planned: day('2026-11-04'), due: null },
				{ ...afterCompletion, frequency: 'daily', interval: 3 },
				{ completedAt: '2026-11-10T18:00:00+01:00[Europe/Berlin]' }
			);

			expect(next).toEqual({ planned: day('2026-11-13'), due: null });
		});

		it('steps from an early completion, even to before the current date', () => {
			const next = stepOnce(
				{ planned: day('2026-11-20'), due: null },
				{ ...afterCompletion, frequency: 'weekly' },
				{ completedAt: '2026-11-04T12:00:00+01:00[Europe/Berlin]' }
			);

			expect(next).toEqual({ planned: day('2026-11-11'), due: null });
		});

		it('reads the completion instant in the zone of a timed date and keeps its time', () => {
			const next = stepOnce(
				{ planned: timed('2026-11-04T09:00', 'America/New_York'), due: null },
				{ ...afterCompletion, frequency: 'daily' },
				{ completedAt: '2026-11-06T03:00:00+01:00[Europe/Berlin]' }
			);

			expect(next).toEqual({ planned: timed('2026-11-06T09:00', 'America/New_York'), due: null });
		});

		it('reads the completion date in the zone it was completed in for date-only values', () => {
			const next = stepOnce(
				{ planned: day('2026-11-04'), due: null },
				{ ...afterCompletion, frequency: 'weekly' },
				{ completedAt: '2026-11-06T00:30:00+01:00[Europe/Berlin]' }
			);

			expect(next).toEqual({ planned: day('2026-11-13'), due: null });
		});

		it('takes the month day from the completion date when the rule has none', () => {
			const next = stepOnce(
				{ planned: day('2026-11-04'), due: null },
				{ ...afterCompletion, frequency: 'monthly' },
				{ completedAt: '2026-11-20T08:00:00-05:00[America/New_York]' }
			);

			expect(next).toEqual({ planned: day('2026-12-20'), due: null });
		});

		it('moves the Due Date along, keeping its offset', () => {
			const next = stepOnce(
				{ planned: day('2026-11-04'), due: timedDue('2026-11-06T17:00', 'Europe/Berlin') },
				{ ...afterCompletion, frequency: 'weekly' },
				{ completedAt: '2026-11-10T09:00:00+01:00[Europe/Berlin]' }
			);

			expect(next).toEqual({
				planned: day('2026-11-17'),
				due: timedDue('2026-11-19T17:00', 'Europe/Berlin')
			});
		});

		it('ends when the step from completion passes the until date', () => {
			const next = stepOnce(
				{ planned: day('2026-11-04'), due: null },
				{ ...afterCompletion, frequency: 'weekly', end: { kind: 'until', date: '2026-11-30' } },
				{ completedAt: '2026-11-24T09:00:00+01:00[Europe/Berlin]' }
			);

			expect(next).toBeNull();
		});

		it('needs the completion instant', () => {
			expect(() =>
				stepOnce(
					{ planned: day('2026-11-04'), due: null },
					{ ...afterCompletion, frequency: 'daily' }
				)
			).toThrow(InvalidRecurrenceError);
		});
	});

	describe('end conditions', () => {
		it('never ends with an open end', () => {
			const next = stepOnce(
				{ planned: day('2026-11-04'), due: null },
				{ frequency: 'daily' },
				{
					occurrencesSoFar: 10_000
				}
			);

			expect(next).toEqual({ planned: day('2026-11-05'), due: null });
		});

		it('ends after the given number of Occurrences, counting the first', () => {
			const rule = { frequency: 'weekly', end: { kind: 'count', count: 3 } };

			expect(plannedSeries('2026-11-04', rule, 10)).toEqual(['2026-11-11', '2026-11-18']);
		});

		it('includes an Occurrence on the until date and nothing after it', () => {
			const rule = { frequency: 'daily', end: { kind: 'until', date: '2026-11-06' } };

			expect(plannedSeries('2026-11-04', rule, 10)).toEqual(['2026-11-05', '2026-11-06']);
		});

		it('checks the until date against the driving date only', () => {
			const next = stepOnce(
				{ planned: timed('2026-11-05T23:30', 'America/New_York'), due: day('2026-11-08') },
				{ frequency: 'daily', end: { kind: 'until', date: '2026-11-06' } }
			);

			expect(next).toEqual({
				planned: timed('2026-11-06T23:30', 'America/New_York'),
				due: day('2026-11-09')
			});
		});
	});

	describe('invalid input', () => {
		it('rejects an Occurrence without any date', () => {
			expect(() => stepOnce({ planned: null, due: null }, { frequency: 'daily' })).toThrow(
				InvalidRecurrenceError
			);
		});

		it.each([0, -1, 1.5])('rejects %s Occurrences so far', (occurrencesSoFar) => {
			expect(() =>
				stepOnce(
					{ planned: day('2026-11-04'), due: null },
					{ frequency: 'daily' },
					{
						occurrencesSoFar
					}
				)
			).toThrow(InvalidRecurrenceError);
		});
	});

	describe('across DST changes', () => {
		it.each([
			[
				'Europe/Berlin spring-forward',
				'Europe/Berlin',
				'2026-03-28T09:00',
				'2026-03-29T09:00',
				'+02:00'
			],
			[
				'Europe/Berlin fall-back',
				'Europe/Berlin',
				'2026-10-24T09:00',
				'2026-10-25T09:00',
				'+01:00'
			],
			[
				'America/New_York spring-forward',
				'America/New_York',
				'2026-03-07T09:00',
				'2026-03-08T09:00',
				'-04:00'
			],
			[
				'America/New_York fall-back',
				'America/New_York',
				'2026-10-31T09:00',
				'2026-11-01T09:00',
				'-05:00'
			]
		])('keeps the wall-clock time fixed over the %s', (_, zone, from, to, offsetAfter) => {
			const next = nextOccurrence({
				planned: timedPlannedDate(from, zone),
				due: unsetDate,
				rule: parseRecurrence({ ...dailyRule }),
				occurrencesSoFar: 1
			});

			expect(next?.planned.kind === 'timed' && serializePlannedDate(next.planned)).toEqual(
				timed(to, zone)
			);
			expect(next?.planned.kind === 'timed' && toZonedDateTime(next.planned).offset).toBe(
				offsetAfter
			);
		});

		it('keeps a time that falls into the DST gap and resolves it forward', () => {
			const rule = parseRecurrence({ ...dailyRule });
			const first = nextOccurrence({
				planned: timedPlannedDate('2026-03-28T02:30', 'Europe/Berlin'),
				due: unsetDate,
				rule,
				occurrencesSoFar: 1
			});
			const second = first && nextOccurrence({ ...first, rule, occurrencesSoFar: 2 });

			expect(first?.planned.kind === 'timed' && toZonedDateTime(first.planned).toString()).toBe(
				'2026-03-29T03:30:00+02:00[Europe/Berlin]'
			);
			expect(second && serializePlannedDate(second.planned)).toEqual(
				timed('2026-03-30T02:30', 'Europe/Berlin')
			);
		});

		it('keeps an ambiguous fall-back time on its first instance', () => {
			const next = stepOnce(
				{ planned: null, due: timedDue('2026-10-31T01:30', 'America/New_York') },
				{ frequency: 'daily' }
			);
			const zoned = toZonedDateTime(parseDueDate(next?.due) as TimedDueDate);

			expect(zoned.toString()).toBe('2026-11-01T01:30:00-04:00[America/New_York]');
		});
	});
});

/** RRULE values for the Planned and Due series of the given (serialized) Occurrence. */
function rrules(
	current: SerializedOccurrence,
	rule: Record<string, unknown>,
	occurrencesSoFar = 1
) {
	return toRRules(
		parseRecurrence({ interval: 1, end: { kind: 'never' }, anchor: 'schedule', ...rule }),
		{ planned: parsePlannedDate(current.planned), due: parseDueDate(current.due), occurrencesSoFar }
	);
}

describe('RRULE export', () => {
	it.each([
		['every day', { frequency: 'daily' }, 'FREQ=DAILY'],
		['every 3 days', { frequency: 'daily', interval: 3 }, 'FREQ=DAILY;INTERVAL=3'],
		['every week on its own weekday', { frequency: 'weekly' }, 'FREQ=WEEKLY;BYDAY=WE'],
		[
			'every week on several weekdays',
			{ frequency: 'weekly', weekdays: [1, 3, 7] },
			'FREQ=WEEKLY;BYDAY=MO,WE,SU'
		],
		[
			'every 2 weeks on several weekdays, with ISO weeks',
			{ frequency: 'weekly', interval: 2, weekdays: [1, 3] },
			'FREQ=WEEKLY;INTERVAL=2;WKST=MO;BYDAY=MO,WE'
		],
		['every month on its own day', { frequency: 'monthly' }, 'FREQ=MONTHLY;BYMONTHDAY=4'],
		[
			'every month on the 28th',
			{ frequency: 'monthly', monthDay: 28 },
			'FREQ=MONTHLY;BYMONTHDAY=28'
		],
		[
			'every month on the 29th, or the last day if shorter',
			{ frequency: 'monthly', monthDay: 29 },
			'FREQ=MONTHLY;BYMONTHDAY=28,29;BYSETPOS=-1'
		],
		[
			'every month on the 30th, or the last day if shorter',
			{ frequency: 'monthly', monthDay: 30 },
			'FREQ=MONTHLY;BYMONTHDAY=28,29,30;BYSETPOS=-1'
		],
		[
			'every month on the 31st, i.e. the last day',
			{ frequency: 'monthly', monthDay: 31 },
			'FREQ=MONTHLY;BYMONTHDAY=-1'
		],
		['every year on its own date', { frequency: 'yearly' }, 'FREQ=YEARLY;BYMONTH=11;BYMONTHDAY=4'],
		[
			'every 2 years',
			{ frequency: 'yearly', interval: 2 },
			'FREQ=YEARLY;INTERVAL=2;BYMONTH=11;BYMONTHDAY=4'
		]
	])('%s', (_, rule, expected) => {
		expect(rrules({ planned: day('2026-11-04'), due: null }, rule)).toEqual({
			planned: expected,
			due: null
		});
	});
});

describe('RRULE export of month-end dates', () => {
	it('exports Feb 29 every year as the last day of February', () => {
		const rule = { frequency: 'yearly', monthDay: 29 };

		expect(rrules({ planned: day('2028-02-29'), due: null }, rule).planned).toBe(
			'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=-1'
		);
		expect(rrules({ planned: day('2029-02-28'), due: null }, rule).planned).toBe(
			'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=-1'
		);
	});

	it('exports the 31st from a clamped Occurrence as the last day of the month', () => {
		const rule = { frequency: 'monthly', monthDay: 31 };

		expect(rrules({ planned: day('2027-02-28'), due: null }, rule).planned).toBe(
			'FREQ=MONTHLY;BYMONTHDAY=-1'
		);
	});
});

describe('RRULE export of the later date', () => {
	it('gives both series the same rule when the dates fall on the same day', () => {
		const current = {
			planned: timed('2026-11-04T09:00', 'Europe/Berlin'),
			due: timedDue('2026-11-04T17:00', 'Europe/Berlin')
		};

		expect(rrules(current, { frequency: 'monthly', monthDay: 31 })).toEqual({
			planned: 'FREQ=MONTHLY;BYMONTHDAY=-1',
			due: 'FREQ=MONTHLY;BYMONTHDAY=-1'
		});
	});

	it('shifts the weekdays and week start of the later series by the offset', () => {
		// Planned on Monday, due three days later on Thursday.
		const current = { planned: day('2026-11-02'), due: day('2026-11-05') };

		expect(rrules(current, { frequency: 'weekly', interval: 2, weekdays: [1, 3, 5] })).toEqual({
			planned: 'FREQ=WEEKLY;INTERVAL=2;WKST=MO;BYDAY=MO,WE,FR',
			due: 'FREQ=WEEKLY;INTERVAL=2;WKST=TH;BYDAY=MO,TH,SA'
		});
	});

	it('shifts the weekdays of the Planned series when the Due Date drives', () => {
		const current = { planned: day('2026-11-03'), due: day('2026-11-01') };

		expect(rrules(current, { frequency: 'weekly' })).toEqual({
			planned: 'FREQ=WEEKLY;BYDAY=TU',
			due: 'FREQ=WEEKLY;BYDAY=SU'
		});
	});

	it.each([
		['the 10th, due 5 days later', 10, '2026-11-10', '2026-11-15', 'FREQ=MONTHLY;BYMONTHDAY=15'],
		['the 31st, due the next day', 31, '2026-11-30', '2026-12-01', 'FREQ=MONTHLY;BYMONTHDAY=1']
	])('expresses a monthly Due series exactly: %s', (_, monthDay, planned, due, expected) => {
		expect(
			rrules({ planned: day(planned), due: day(due) }, { frequency: 'monthly', monthDay }).due
		).toBe(expected);
	});

	it('approximates a monthly Due series RRULE cannot express with its own day', () => {
		// Planned on the 25th, due 11 days later: the 5th to the 8th, depending on the month.
		const current = { planned: day('2026-11-25'), due: day('2026-12-06') };

		expect(rrules(current, { frequency: 'monthly' }).due).toBe('FREQ=MONTHLY;BYMONTHDAY=6');
	});
});

describe('RRULE export of the end', () => {
	const count = (n: number) => ({ frequency: 'daily', end: { kind: 'count', count: n } });
	const until = (date: string) => ({ frequency: 'daily', end: { kind: 'until', date } });

	it('counts the remaining Occurrences, including the current one', () => {
		const current = { planned: day('2026-11-04'), due: day('2026-11-05') };

		expect(rrules(current, count(10), 4)).toEqual({
			planned: 'FREQ=DAILY;COUNT=7',
			due: 'FREQ=DAILY;COUNT=7'
		});
		expect(rrules(current, count(3), 3).planned).toBe('FREQ=DAILY;COUNT=1');
	});

	it('rejects more Occurrences so far than the count allows', () => {
		expect(() => rrules({ planned: day('2026-11-04'), due: null }, count(3), 4)).toThrow(
			InvalidRecurrenceError
		);
	});

	it('ends date-only series on the until date, shifted for the later date', () => {
		const current = { planned: day('2026-11-04'), due: day('2026-11-06') };

		expect(rrules(current, until('2026-12-31'))).toEqual({
			planned: 'FREQ=DAILY;UNTIL=20261231',
			due: 'FREQ=DAILY;UNTIL=20270102'
		});
	});

	it.each([
		['Europe/Berlin in winter', 'Europe/Berlin', '2026-12-31', 'UNTIL=20261231T225959Z'],
		['America/New_York in summer', 'America/New_York', '2027-07-04', 'UNTIL=20270705T035959Z'],
		['Asia/Tokyo', 'Asia/Tokyo', '2027-01-15', 'UNTIL=20270115T145959Z']
	])('ends timed series at the end of the until day in UTC: %s', (_, zone, date, expected) => {
		const current = { planned: timed('2026-11-04T09:00', zone), due: null };

		expect(rrules(current, until(date)).planned).toBe(`FREQ=DAILY;${expected}`);
	});

	it('formats UNTIL per series when one date is timed and the other is not', () => {
		const current = {
			planned: day('2026-11-04'),
			due: timedDue('2026-11-05T12:00', 'America/New_York')
		};

		expect(rrules(current, until('2026-12-31'))).toEqual({
			planned: 'FREQ=DAILY;UNTIL=20261231',
			due: 'FREQ=DAILY;UNTIL=20270102T045959Z'
		});
	});
});

describe('RRULE export matches the app (checked against the rrule reference implementation)', () => {
	const SERIES_LENGTH = 25;

	/** Wall-clock label of a serialized date: `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm`. */
	function label(value: unknown): string | null {
		if (value === null) return null;
		const date = value as { kind: string; date?: string; dateTime?: string };
		return date.kind === 'date' ? date.date! : date.dateTime!;
	}

	/** The current Occurrence followed by up to SERIES_LENGTH - 1 next ones, as wall-clock labels. */
	function appSeries(current: SerializedOccurrence, rule: Record<string, unknown>) {
		const series = [current];
		while (series.length < SERIES_LENGTH) {
			const last = series[series.length - 1];
			const completedAt = onTimeCompletion(last);
			const next = stepOnce(last, rule, { occurrencesSoFar: series.length, completedAt });
			if (!next) break;
			series.push(next);
		}
		return {
			planned: series.map((occurrence) => label(occurrence.planned)),
			due: series.map((occurrence) => label(occurrence.due))
		};
	}

	/** Completing on time: at the driving date (the earlier one; date-only values at noon UTC). */
	function onTimeCompletion(occurrence: SerializedOccurrence): string {
		const dates = [occurrence.planned, occurrence.due].filter((date) => date !== null) as {
			kind: string;
			date?: string;
			dateTime?: string;
			timeZone?: string;
		}[];
		const driver = dates.sort((a, b) =>
			(a.date ?? a.dateTime!).slice(0, 10).localeCompare((b.date ?? b.dateTime!).slice(0, 10))
		)[0];
		return driver.kind === 'date'
			? `${driver.date}T12:00:00+00:00[UTC]`
			: Temporal.PlainDateTime.from(driver.dateTime!).toZonedDateTime(driver.timeZone!).toString();
	}

	/**
	 * Expands an RRULE from the given date with the reference implementation, in floating wall-clock
	 * time (RFC 5545 expands a TZID'd DTSTART in local time, so this is equivalent). A UTC UNTIL is
	 * converted to the series' wall-clock time first.
	 */
	function referenceSeries(value: unknown, rruleValue: string): string[] {
		const date = value as { kind: string; date?: string; dateTime?: string; timeZone?: string };
		const start = date.kind === 'date' ? `${date.date}T00:00` : date.dateTime!;
		const compact = (wallClock: string) => wallClock.replace(/[-:]/g, '').padEnd(15, '0');
		const floatingRule = rruleValue.replace(/UNTIL=(\d{8}T\d{6})Z/, (_, until: string) => {
			const instant = Temporal.Instant.from(
				`${until.slice(0, 4)}-${until.slice(4, 6)}-${until.slice(6, 11)}:${until.slice(11, 13)}:${until.slice(13)}Z`
			);
			const wallClock = instant.toZonedDateTimeISO(date.timeZone!).toPlainDateTime();
			return `UNTIL=${compact(wallClock.toString())}`;
		});
		const expanded = rrulestr(`DTSTART:${compact(start)}\nRRULE:${floatingRule}`).all(
			(_, index) => index < SERIES_LENGTH
		);
		return expanded.map((occurrence) => {
			const iso = occurrence.toISOString();
			return date.kind === 'date' ? iso.slice(0, 10) : iso.slice(0, 16);
		});
	}

	it.each([
		[
			'daily every 3 days, due 2 days later',
			day('2026-11-04'),
			day('2026-11-06'),
			{ frequency: 'daily', interval: 3 }
		],
		[
			'weekly, timed across DST',
			timed('2026-10-21T09:00', 'Europe/Berlin'),
			null,
			{ frequency: 'weekly' }
		],
		[
			'every 2 weeks Mon/Wed/Fri, due 3 days later',
			day('2026-11-02'),
			day('2026-11-05'),
			{ frequency: 'weekly', interval: 2, weekdays: [1, 3, 5] }
		],
		[
			'every 3 weeks Tue/Sun, timed in New York',
			timed('2026-11-08T18:00', 'America/New_York'),
			timedDue('2026-11-09T09:00', 'America/New_York'),
			{ frequency: 'weekly', interval: 3, weekdays: [2, 7] }
		],
		[
			'weekly Mon/Fri driven by the Due Date',
			day('2026-11-04'),
			day('2026-11-02'),
			{ frequency: 'weekly', weekdays: [1, 5] }
		],
		['monthly on the 31st', day('2027-01-31'), null, { frequency: 'monthly', monthDay: 31 }],
		['monthly on the 30th', null, day('2027-01-30'), { frequency: 'monthly', monthDay: 30 }],
		['monthly on the 29th', day('2027-01-29'), null, { frequency: 'monthly', monthDay: 29 }],
		[
			'every 2 months on the 31st, timed',
			timed('2026-12-31T23:00', 'Europe/Berlin'),
			null,
			{ frequency: 'monthly', interval: 2, monthDay: 31 }
		],
		[
			'monthly on the 31st, due the next day',
			day('2026-12-31'),
			day('2027-01-01'),
			{ frequency: 'monthly', monthDay: 31 }
		],
		[
			'monthly on the 10th, due 5 days later',
			day('2026-11-10'),
			day('2026-11-15'),
			{ frequency: 'monthly' }
		],
		['yearly on Feb 29', day('2028-02-29'), null, { frequency: 'yearly', monthDay: 29 }],
		[
			'every 2 years, timed',
			timed('2026-11-04T09:00', 'Asia/Tokyo'),
			null,
			{ frequency: 'yearly', interval: 2 }
		],
		[
			'daily at a time in the DST gap',
			timed('2027-03-10T02:30', 'America/New_York'),
			null,
			{ frequency: 'daily' }
		],
		[
			'after 5 times, from the 2nd',
			day('2026-11-04'),
			day('2026-11-05'),
			{ frequency: 'weekly', end: { kind: 'count', count: 5 } }
		],
		[
			'until a date, timed with a later Due Date',
			timed('2026-11-02T09:00', 'America/New_York'),
			timedDue('2026-11-04T17:00', 'Europe/Berlin'),
			{ frequency: 'weekly', weekdays: [1, 4], end: { kind: 'until', date: '2026-12-31' } }
		],
		[
			'until a date, date-only',
			day('2026-11-30'),
			null,
			{ frequency: 'monthly', monthDay: 31, end: { kind: 'until', date: '2027-06-30' } }
		],
		[
			'counted from completion, projected with on-time completion',
			day('2027-01-31'),
			day('2027-02-02'),
			{ frequency: 'monthly', monthDay: 31, anchor: 'completion' }
		]
	])('%s', (_, planned, due, rule) => {
		const current = { planned, due };
		const app = appSeries(current, rule);
		const exported = rrules(current, rule);

		expect(app.planned.length).toBeGreaterThan(1);
		for (const kind of ['planned', 'due'] as const) {
			if (current[kind] === null) {
				expect(exported[kind]).toBeNull();
				continue;
			}
			expect(referenceSeries(current[kind], exported[kind]!), exported[kind]!).toEqual(app[kind]);
		}
	});
});

describe('step driver', () => {
	it.each([
		['the only date', day('2026-11-04'), null, 'planned'],
		['the only date', null, day('2026-11-04'), 'due'],
		['the earlier date', day('2026-11-04'), day('2026-11-02'), 'due'],
		['the Planned Date on a tie', timed('2026-11-04T18:00', 'UTC'), day('2026-11-04'), 'planned']
	])('is %s', (_, planned, due, expected) => {
		expect(stepDriver({ planned: parsePlannedDate(planned), due: parseDueDate(due) })).toBe(
			expected
		);
	});
});
