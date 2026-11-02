/**
 * Recurrence (see CONTEXT.md): the rule model, stepping from one Occurrence to the next, and export
 * as iCalendar RRULE values for Calendar Links. Pure: no DB or UI.
 *
 * Decisions:
 * - Step driver: when both dates are set, the earlier one (by calendar date, each timed value read
 *   in its own zone; Planned Date on a tie) is stepped by the rule. Weekly weekdays and the monthly
 *   or yearly month day refer to that date. The other date then moves by the same number of
 *   calendar days, keeping its own time of day and zone, so the offset between them is preserved.
 * - Month end: each Occurrence is clamped to the month's length, but the intended day comes from the
 *   rule's `monthDay`, so Jan 31 → Feb 28 → Mar 31. Without a `monthDay` the current date's day is
 *   used, so callers should store it explicitly. Yearly rules use `monthDay` the same way for Feb 29.
 * - DST: timed dates keep their wall-clock time in their zone; a time in a DST gap is stored as is
 *   and resolves forward on conversion (`toZonedDateTime`), matching how calendars expand RRULEs.
 * - RRULE: see {@link toRRules}.
 */
import { Temporal } from 'temporal-polyfill';
import {
	dateOnly,
	localDate,
	type DateOnly,
	type DueDate,
	type PlannedDate,
	type TaskDate,
	type TimedDate
} from './dates';

/** ISO weekday: 1 = Monday … 7 = Sunday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type Frequency = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type RecurrenceAnchor = 'schedule' | 'completion';
export type RecurrenceEnd =
	| { kind: 'never' }
	| { kind: 'until'; date: Temporal.PlainDate }
	| { kind: 'count'; count: number };

type RuleBase = { interval: number; end: RecurrenceEnd; anchor: RecurrenceAnchor };
export type RecurrenceRule =
	| (RuleBase & { frequency: 'daily' })
	| (RuleBase & { frequency: 'weekly'; weekdays?: Weekday[] })
	| (RuleBase & { frequency: 'monthly' | 'yearly'; monthDay?: number });

type SerializedEnd =
	{ kind: 'never' } | { kind: 'until'; date: string } | { kind: 'count'; count: number };
/** JSON/DB shape of a {@link RecurrenceRule}: identical, with the until date as `YYYY-MM-DD`. */
export type SerializedRecurrence = WithSerializedEnd<RecurrenceRule>;
type WithSerializedEnd<R> = R extends RecurrenceRule
	? Omit<R, 'end'> & { end: SerializedEnd }
	: never;

/** Thrown when a Recurrence (or its serialized form) is malformed. */
export class InvalidRecurrenceError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'InvalidRecurrenceError';
	}
}

const FREQUENCIES: readonly string[] = ['daily', 'weekly', 'monthly', 'yearly'];
const ANCHORS: readonly string[] = ['schedule', 'completion'];

function fail(message: string): never {
	throw new InvalidRecurrenceError(message);
}

function got(value: unknown): string {
	return `, got ${JSON.stringify(value)}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function positiveInteger(value: unknown, what: string, max = Infinity): number {
	if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) {
		fail(`${what} must be a whole number from 1 to ${max}${got(value)}`);
	}
	return value;
}

function parseEnd(value: unknown): RecurrenceEnd {
	if (!isObject(value)) fail(`End must be an object${got(value)}`);
	switch (value.kind) {
		case 'never':
			return { kind: 'never' };
		case 'count':
			return { kind: 'count', count: positiveInteger(value.count, 'Count') };
		case 'until':
			try {
				return { kind: 'until', date: dateOnly(value.date as string).date };
			} catch {
				return fail(`Until must be a valid date like 2026-11-04${got(value.date)}`);
			}
		default:
			return fail(`Unknown end kind${got(value.kind)}`);
	}
}

function parseWeekdays(value: unknown): Weekday[] {
	if (!Array.isArray(value) || value.length === 0) {
		fail(`Weekdays must be a non-empty list${got(value)}`);
	}
	const weekdays = value.map((day) => positiveInteger(day, 'Weekday', 7) as Weekday);
	if (new Set(weekdays).size !== weekdays.length) fail(`Weekdays must be unique${got(value)}`);
	return weekdays.sort((a, b) => a - b);
}

/** Validates a serialized Recurrence. Throws {@link InvalidRecurrenceError}. */
export function parseRecurrence(value: unknown): RecurrenceRule {
	if (!isObject(value)) fail(`Recurrence must be an object${got(value)}`);
	const { frequency, weekdays, monthDay } = value;
	if (typeof frequency !== 'string' || !FREQUENCIES.includes(frequency)) {
		fail(`Unknown frequency${got(frequency)}`);
	}
	if (typeof value.anchor !== 'string' || !ANCHORS.includes(value.anchor)) {
		fail(`Unknown anchor${got(value.anchor)}`);
	}
	if (weekdays !== undefined && frequency !== 'weekly') {
		fail('Only weekly rules have weekdays');
	}
	if (monthDay !== undefined && frequency !== 'monthly' && frequency !== 'yearly') {
		fail('Only monthly and yearly rules have a month day');
	}
	const base: RuleBase = {
		interval: positiveInteger(value.interval, 'Interval'),
		end: parseEnd(value.end),
		anchor: value.anchor as RecurrenceAnchor
	};
	switch (frequency) {
		case 'weekly':
			return weekdays === undefined
				? { frequency, ...base }
				: { frequency, ...base, weekdays: parseWeekdays(weekdays) };
		case 'monthly':
		case 'yearly':
			return monthDay === undefined
				? { frequency, ...base }
				: { frequency, ...base, monthDay: positiveInteger(monthDay, 'Month day', 31) };
		default:
			return { frequency: 'daily', ...base };
	}
}

export function serializeRecurrence(rule: RecurrenceRule): SerializedRecurrence {
	const end: SerializedEnd =
		rule.end.kind === 'until' ? { kind: 'until', date: rule.end.date.toString() } : rule.end;
	return { ...rule, end };
}

export type OccurrenceDates = { planned: PlannedDate; due: DueDate };

export type NextOccurrenceInput = OccurrenceDates & {
	rule: RecurrenceRule;
	/** How many Occurrences the series has had, including the current one (the first is 1). */
	occurrencesSoFar: number;
	/** When the current Occurrence was completed, in the completing browser's zone. Required for completion-anchored rules. */
	completedAt?: Temporal.ZonedDateTime;
};

/** Moves a date by whole calendar days, keeping its wall-clock time, zone and Duration. */
export function shiftByDays<T extends TaskDate>(value: T, days: number): T {
	switch (value.kind) {
		case 'unset':
			return value;
		case 'date':
			return { ...value, date: value.date.add({ days }) };
		case 'timed':
			return { ...value, dateTime: value.dateTime.add({ days }) };
	}
}

/**
 * The next date on a weekly rule after `from`: the next listed weekday later in the same ISO week
 * (Monday to Sunday), or else the first listed weekday `interval` weeks later.
 */
function nextWeekly(from: Temporal.PlainDate, interval: number, weekdays: Weekday[]) {
	const laterThisWeek = weekdays.find((weekday) => weekday > from.dayOfWeek);
	if (laterThisWeek !== undefined) return from.add({ days: laterThisWeek - from.dayOfWeek });
	const monday = from.subtract({ days: from.dayOfWeek - 1 });
	return monday.add({ weeks: interval, days: weekdays[0] - 1 });
}

/**
 * `months` months after `from`, on `monthDay` clamped to the length of that month. Because the
 * intended day comes from the rule, a series on the 31st returns to the 31st after short months.
 */
function monthsLater(from: Temporal.PlainDate, months: number, monthDay: number) {
	const month = from.toPlainYearMonth().add({ months });
	return month.toPlainDate({ day: Math.min(monthDay, month.daysInMonth) });
}

function nextDriverDate(rule: RecurrenceRule, from: Temporal.PlainDate): Temporal.PlainDate {
	switch (rule.frequency) {
		case 'daily':
			return from.add({ days: rule.interval });
		case 'weekly':
			return nextWeekly(from, rule.interval, rule.weekdays ?? [from.dayOfWeek as Weekday]);
		case 'monthly':
			return monthsLater(from, rule.interval, rule.monthDay ?? from.day);
		case 'yearly':
			return monthsLater(from, 12 * rule.interval, rule.monthDay ?? from.day);
	}
}

/**
 * Which date the rule steps: the only one set, or the one with the earlier calendar date (each
 * timed value read in its own zone), or the Planned Date on a tie. Weekly weekdays and the month
 * day of a rule refer to this date. Throws when neither date is set.
 */
export function stepDriver({ planned, due }: OccurrenceDates): 'planned' | 'due' {
	if (planned.kind === 'unset') {
		if (due.kind === 'unset') fail('A recurring Task needs at least one date');
		return 'due';
	}
	if (due.kind === 'unset') return 'planned';
	return Temporal.PlainDate.compare(localDate(due), localDate(planned)) < 0 ? 'due' : 'planned';
}

function stepDriverDate(dates: OccurrenceDates): DateOnly | TimedDate {
	return dates[stepDriver(dates)] as DateOnly | TimedDate;
}

/**
 * The calendar date the next step counts from: the driving date itself, or for completion-anchored
 * rules the completion date — read in the driving date's zone, or for a date-only value in the zone
 * the Task was completed in.
 */
function stepBase(
	rule: RecurrenceRule,
	driver: DateOnly | TimedDate,
	completedAt: Temporal.ZonedDateTime | undefined
): Temporal.PlainDate {
	if (rule.anchor === 'schedule') return localDate(driver);
	if (!completedAt) {
		throw new InvalidRecurrenceError('Counting from completion needs the completion instant');
	}
	const inZone = driver.kind === 'timed' ? completedAt.withTimeZone(driver.timeZone) : completedAt;
	return inZone.toPlainDate();
}

/**
 * The Planned and Due Dates of the Occurrence after the current one, or `null` when the
 * Recurrence has ended (its count is used up, or the next driving date is after its until date).
 *
 * Schedule-anchored rules step from the current driving date. Completion-anchored rules step
 * from the completion date (`completedAt` read in the driving date's zone, or in its own zone for
 * a date-only value), keeping the original time of day; an early completion can therefore yield
 * a date before the current one.
 */
export function nextOccurrence(input: NextOccurrenceInput): OccurrenceDates | null {
	const { planned, due, rule } = input;
	const occurrencesSoFar = positiveInteger(input.occurrencesSoFar, 'Occurrences so far');
	if (rule.end.kind === 'count' && occurrencesSoFar >= rule.end.count) return null;
	const driver = stepDriverDate(input);
	const current = localDate(driver);
	const next = nextDriverDate(rule, stepBase(rule, driver, input.completedAt));
	if (rule.end.kind === 'until' && Temporal.PlainDate.compare(next, rule.end.date) > 0) {
		return null;
	}
	const days = current.until(next).days;
	return { planned: shiftByDays(planned, days), due: shiftByDays(due, days) };
}

export type RRules = { planned: string | null; due: string | null };

const WEEKDAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

/**
 * BYMONTHDAY (and BYSETPOS) parts that select exactly the days of the given dates, one per month,
 * or `null` when no single pattern does. RFC 5545 skips months without the given day, so the
 * app's clamping is expressed as "the last of the days 28…N" (`BYMONTHDAY=28,…,N;BYSETPOS=-1`),
 * or `BYMONTHDAY=-1` when the series always falls on the last day.
 */
function monthDayParts(dates: Temporal.PlainDate[]): string[] | null {
	if (dates.every((date) => date.day === dates[0].day)) return [`BYMONTHDAY=${dates[0].day}`];
	if (dates.every((date) => date.day === date.daysInMonth)) return ['BYMONTHDAY=-1'];
	for (const intended of [29, 30]) {
		if (dates.every((date) => date.day === Math.min(intended, date.daysInMonth))) {
			const days = Array.from({ length: intended - 27 }, (_, i) => 28 + i);
			return [`BYMONTHDAY=${days.join(',')}`, 'BYSETPOS=-1'];
		}
	}
	return null;
}

/** Enough future steps to cover every month length, including leap years twice. */
const PROBE_MONTHS = 96;

/**
 * BY-parts for the series of one date, `offsetDays` after the driving date. The pattern is read
 * off the dates the app itself would produce, so the calendar matches the app wherever RRULE can
 * express it at all.
 */
function byParts(rule: RecurrenceRule, driver: Temporal.PlainDate, offsetDays: number): string[] {
	const own = driver.add({ days: offsetDays });
	switch (rule.frequency) {
		case 'daily':
			return [];
		case 'weekly': {
			const weekdays = rule.weekdays ?? [driver.dayOfWeek as Weekday];
			const byDay = weekdays
				.map((weekday) => (weekday - 1 + offsetDays) % 7)
				.sort((a, b) => a - b)
				.map((index) => WEEKDAY_CODES[index]);
			const weekStart =
				rule.interval > 1 && weekdays.length > 1 ? [`WKST=${WEEKDAY_CODES[offsetDays % 7]}`] : [];
			return [...weekStart, `BYDAY=${byDay.join(',')}`];
		}
		case 'monthly': {
			const monthDay = rule.monthDay ?? driver.day;
			const dates = Array.from({ length: PROBE_MONTHS }, (_, i) =>
				monthsLater(driver, i, monthDay).add({ days: offsetDays })
			);
			return monthDayParts(dates) ?? [`BYMONTHDAY=${own.day}`];
		}
		case 'yearly': {
			const monthDay = rule.monthDay ?? driver.day;
			const dates = Array.from({ length: PROBE_MONTHS / 12 }, (_, i) =>
				monthsLater(driver, 12 * i, monthDay).add({ days: offsetDays })
			);
			const dayParts = dates.every((date) => date.month === dates[0].month)
				? monthDayParts(dates)
				: null;
			return dayParts
				? [`BYMONTH=${dates[0].month}`, ...dayParts]
				: [`BYMONTH=${own.month}`, `BYMONTHDAY=${own.day}`];
		}
	}
}

/**
 * UNTIL for a series ending on `lastDate`: a DATE for date-only series, or for timed series the
 * last second of that day in the series' zone, in UTC (RFC 5545 requires UTC when DTSTART has a
 * TZID).
 */
function formatUntil(lastDate: Temporal.PlainDate, value: DateOnly | TimedDate): string {
	if (value.kind === 'date') return lastDate.toString().replaceAll('-', '');
	const endOfDay = lastDate
		.add({ days: 1 })
		.toZonedDateTime(value.timeZone)
		.subtract({ seconds: 1 });
	return endOfDay.toInstant().toString().replace(/[-:]/g, '');
}

/**
 * RFC 5545 RRULE values (without the `RRULE:` prefix) for the Planned and Due series of the
 * current Occurrence; `null` for an unset date. Each series' DTSTART is that date of the current
 * Occurrence (`TZID` for timed values, `VALUE=DATE` for date-only ones).
 *
 * - Completion-anchored rules give the projected series, assuming each Occurrence is completed
 *   on time, which is the scheduled series from the current Occurrence.
 * - COUNT is the remaining number of Occurrences including the current one. UNTIL is shifted by
 *   the series' offset from the driving date; it is a DATE for date-only series and the last
 *   second of that day, in UTC, for timed ones.
 * - Month end: RFC 5545 skips months without the given day, while the app clamps. Clamped series
 *   are exported as `BYMONTHDAY=-1` (31st) or `BYMONTHDAY=28,…,N;BYSETPOS=-1` (29th/30th), and
 *   Feb 29 yearly as `BYMONTH=2;BYMONTHDAY=-1`, so calendars show the same dates as the app.
 *   Proton Calendar is known to reject multi-value BYMONTHDAY with BYSETPOS; `-1` is accepted.
 * - The later date's series is the driving series shifted by whole days: weekly BYDAY and WKST are
 *   shifted exactly. A monthly or yearly series that no single BYMONTHDAY pattern can express
 *   (e.g. due 11 days after the 25th: the 5th to the 8th) falls back to its own current day and
 *   may then differ from the app by a few days around short months.
 * - Assumes the current Occurrence lies on the rule; a detached one (moved by "This Occurrence")
 *   should be published on its own, with the series starting at the next Occurrence.
 */
export function toRRules(
	rule: RecurrenceRule,
	current: OccurrenceDates & { occurrencesSoFar: number }
): RRules {
	const occurrencesSoFar = positiveInteger(current.occurrencesSoFar, 'Occurrences so far');
	if (rule.end.kind === 'count' && occurrencesSoFar > rule.end.count) {
		fail(`Occurrences so far exceed the count of ${rule.end.count}`);
	}
	const driver = localDate(stepDriverDate(current));
	const series = (value: TaskDate) => {
		if (value.kind === 'unset') return null;
		const offsetDays = driver.until(localDate(value)).days;
		const parts = [`FREQ=${rule.frequency.toUpperCase()}`];
		if (rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
		parts.push(...byParts(rule, driver, offsetDays));
		if (rule.end.kind === 'count') parts.push(`COUNT=${rule.end.count - occurrencesSoFar + 1}`);
		if (rule.end.kind === 'until') {
			parts.push(`UNTIL=${formatUntil(rule.end.date.add({ days: offsetDays }), value)}`);
		}
		return parts.join(';');
	};
	return { planned: series(current.planned), due: series(current.due) };
}
