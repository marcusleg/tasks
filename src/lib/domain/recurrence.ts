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
	occurrencesSoFar: number;
	completedAt?: Temporal.ZonedDateTime;
};

/** Moves a date by whole calendar days, keeping its wall-clock time, zone and Duration. */
function shiftByDays<T extends TaskDate>(value: T, days: number): T {
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
 * The date whose rule steps drive the Occurrence: the one with the earlier calendar date (each
 * timed value read in its own zone), or the Planned Date on a tie.
 */
function stepDriverDate({ planned, due }: OccurrenceDates): DateOnly | TimedDate {
	if (planned.kind === 'unset') {
		if (due.kind === 'unset') {
			throw new InvalidRecurrenceError('A recurring Task needs at least one date');
		}
		return due;
	}
	if (due.kind === 'unset') return planned;
	return Temporal.PlainDate.compare(localDate(due), localDate(planned)) < 0 ? due : planned;
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
