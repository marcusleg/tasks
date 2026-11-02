/**
 * How Planned Dates and Due Dates look to the person viewing them: ordering, relative days
 * (Today, Tomorrow, Overdue), the Planned-after-Due warning, and formatting.
 *
 * Everything is relative to a {@link Viewer}: the current instant and the viewer's IANA time zone
 * (in the browser, `Intl.DateTimeFormat().resolvedOptions().timeZone`). A timed value is converted
 * into the viewer's zone before its day or time is looked at; a date-only value is zone-less and
 * means the same calendar day everywhere. The value model itself lives in `./dates`.
 */
import { Temporal } from 'temporal-polyfill';
import {
	toZonedDateTime,
	type DateOnly,
	type DueDate,
	type PlannedDate,
	type TaskDate,
	type TimedDate
} from './dates';

export interface Viewer {
	now: Temporal.Instant;
	/** IANA time zone the viewer is in. */
	timeZone: string;
	/** Locale(s) for formatting; `undefined` uses the runtime's default (the browser locale). */
	locale?: string | string[];
}

/** The calendar date a set value falls on for a viewer in `timeZone`. */
export function viewerDate(value: DateOnly | TimedDate, timeZone: string): Temporal.PlainDate {
	if (value.kind === 'date') return value.date;
	return toZonedDateTime(value).withTimeZone(timeZone).toPlainDate();
}

/** The wall-clock date-time of a timed value in `timeZone`, e.g. to fill date and time inputs. */
export function viewerDateTime(value: TimedDate, timeZone: string): Temporal.PlainDateTime {
	return toZonedDateTime(value).withTimeZone(timeZone).toPlainDateTime();
}

function instant(value: TimedDate): Temporal.Instant {
	return toZonedDateTime(value).toInstant();
}

/**
 * Orders Planned Dates or Due Dates (e.g. for the "by Planned Date" / "by Due Date" Sort Modes):
 * earliest first, unset last. Each set value is placed on the calendar day it falls on in
 * `timeZone` (the viewer's zone); on the same day a date-only (all-day) value comes before timed
 * ones, and timed values are ordered by the instant they happen, whatever zone they were set in.
 * Returns 0 for values that coincide, so callers can chain a tiebreaker.
 */
export function compareTaskDates(a: TaskDate, b: TaskDate, timeZone: string): number {
	if (a.kind === 'unset' || b.kind === 'unset') {
		return Number(a.kind === 'unset') - Number(b.kind === 'unset');
	}
	const byDay = Temporal.PlainDate.compare(viewerDate(a, timeZone), viewerDate(b, timeZone));
	if (byDay !== 0) return byDay;
	if (a.kind === 'date' || b.kind === 'date') {
		return Number(a.kind === 'timed') - Number(b.kind === 'timed');
	}
	return Temporal.Instant.compare(instant(a), instant(b));
}

/**
 * Whether the Planned Date falls after the Due Date (CONTEXT.md: it normally falls on or before),
 * for a non-blocking warning. Two timed values compare by instant (a Planned start equal to the
 * Due instant is fine); otherwise by calendar day in `timeZone`, since a date-only value covers
 * its whole day.
 */
export function isPlannedAfterDue(planned: PlannedDate, due: DueDate, timeZone: string): boolean {
	if (planned.kind === 'unset' || due.kind === 'unset') return false;
	if (planned.kind === 'timed' && due.kind === 'timed') {
		return Temporal.Instant.compare(instant(planned), instant(due)) > 0;
	}
	return Temporal.PlainDate.compare(viewerDate(planned, timeZone), viewerDate(due, timeZone)) > 0;
}

function today(viewer: Viewer): Temporal.PlainDate {
	return viewer.now.toZonedDateTimeISO(viewer.timeZone).toPlainDate();
}

/**
 * Whether a Due Date has passed: a date-only one once its day is over for the viewer, a timed one
 * once its instant is in the past.
 */
export function isOverdue(due: DueDate, viewer: Viewer): boolean {
	switch (due.kind) {
		case 'unset':
			return false;
		case 'date':
			return Temporal.PlainDate.compare(due.date, today(viewer)) < 0;
		case 'timed':
			return Temporal.Instant.compare(instant(due), viewer.now) < 0;
	}
}

/** How many calendar days from the viewer's today the value falls on (0 = today, −1 = yesterday). */
function daysFromToday(value: DateOnly | TimedDate, viewer: Viewer): number {
	return today(viewer).until(viewerDate(value, viewer.timeZone), { largestUnit: 'day' }).days;
}

export function isToday(value: TaskDate, viewer: Viewer): boolean {
	return value.kind !== 'unset' && daysFromToday(value, viewer) === 0;
}

export function isTomorrow(value: TaskDate, viewer: Viewer): boolean {
	return value.kind !== 'unset' && daysFromToday(value, viewer) === 1;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Cached, since every Task row formats its dates again whenever the clock ticks. */
function formatter(
	locale: string | string[] | undefined,
	options: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat {
	const key = JSON.stringify([locale, options]);
	let cached = formatters.get(key);
	if (!cached) {
		cached = new Intl.DateTimeFormat(locale, options);
		formatters.set(key, cached);
	}
	return cached;
}

/** A calendar date as a `Date` at midnight UTC, to be formatted with `timeZone: 'UTC'`. */
function utcMidnight(date: Temporal.PlainDate): Date {
	return new Date(Date.UTC(date.year, date.month - 1, date.day));
}

function epochDate(value: TimedDate): Date {
	return new Date(instant(value).epochMilliseconds);
}

const RELATIVE_DAYS: Record<number, string> = { [-1]: 'Yesterday', 0: 'Today', 1: 'Tomorrow' };

function compactDay(value: DateOnly | TimedDate, viewer: Viewer): string {
	const days = daysFromToday(value, viewer);
	if (days in RELATIVE_DAYS) return RELATIVE_DAYS[days];
	const date = viewerDate(value, viewer.timeZone);
	const options: Intl.DateTimeFormatOptions =
		days > 1 && days < 7
			? { weekday: 'short' }
			: date.year === today(viewer).year
				? { day: 'numeric', month: 'short' }
				: { day: 'numeric', month: 'short', year: 'numeric' };
	return formatter(viewer.locale, { ...options, timeZone: 'UTC' }).format(utcMidnight(date));
}

/**
 * A short label for a Task row: "Today", "Tomorrow", "Yesterday", the weekday within the coming
 * week ("Fri"), otherwise day and month (plus the year when it isn't this year). Timed values add
 * their time in the viewer's zone ("Today 09:00"). Empty for an unset date.
 */
export function formatTaskDate(value: TaskDate, viewer: Viewer): string {
	if (value.kind === 'unset') return '';
	const day = compactDay(value, viewer);
	if (value.kind === 'date') return day;
	const time = formatter(viewer.locale, { timeStyle: 'short', timeZone: viewer.timeZone });
	return `${day} ${time.format(epochDate(value))}`;
}

/** The full date (and time, in the viewer's zone), e.g. for a tooltip or an accessible name. */
export function describeTaskDate(value: TaskDate, viewer: Viewer): string {
	switch (value.kind) {
		case 'unset':
			return '';
		case 'date':
			return formatter(viewer.locale, { dateStyle: 'full', timeZone: 'UTC' }).format(
				utcMidnight(value.date)
			);
		case 'timed':
			return formatter(viewer.locale, {
				dateStyle: 'full',
				timeStyle: 'short',
				timeZone: viewer.timeZone
			}).format(epochDate(value));
	}
}
