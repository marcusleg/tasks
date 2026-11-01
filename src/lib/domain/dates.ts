/**
 * The value model for a Task's Planned Date and Due Date (see CONTEXT.md).
 *
 * Each date is unset, date-only (all day, no zone) or timed: a wall-clock date-time plus the IANA
 * time zone it was set in. A timed Planned Date also has a Duration; a timed Due Date is a single
 * point in time. Timed values keep their wall-clock time even when it falls into a DST gap or
 * overlap; it is resolved to an instant only on conversion ({@link toZonedDateTime}).
 *
 * Display formatting and relative labels (Today, Overdue) live elsewhere.
 */
import { Temporal } from 'temporal-polyfill';

export const DEFAULT_DURATION_MINUTES = 30;

export type UnsetDate = { kind: 'unset' };
export type DateOnly = { kind: 'date'; date: Temporal.PlainDate };
export type TimedDueDate = {
	kind: 'timed';
	/** Wall-clock date and time, with minute precision. */
	dateTime: Temporal.PlainDateTime;
	/** IANA time zone name, e.g. `Europe/Berlin`. */
	timeZone: string;
};
export type TimedPlannedDate = TimedDueDate & { durationMinutes: number };

export type PlannedDate = UnsetDate | DateOnly | TimedPlannedDate;
export type DueDate = UnsetDate | DateOnly | TimedDueDate;
/** A Planned Date or a Due Date. */
export type TaskDate = PlannedDate | DueDate;
export type TimedDate = TimedPlannedDate | TimedDueDate;

type SerializedDateOnly = { kind: 'date'; date: string };
type SerializedTimedDueDate = { kind: 'timed'; dateTime: string; timeZone: string };
/** JSON/DB shape: `null` when unset, dates as `YYYY-MM-DD`, date-times as `YYYY-MM-DDTHH:mm`. */
export type SerializedPlannedDate =
	null | SerializedDateOnly | (SerializedTimedDueDate & { durationMinutes: number });
export type SerializedDueDate = null | SerializedDateOnly | SerializedTimedDueDate;

/** Thrown when a date value (or its serialized form) is malformed or out of range. */
export class InvalidDateError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'InvalidDateError';
	}
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

function toPlainDate(value: unknown): Temporal.PlainDate {
	if (value instanceof Temporal.PlainDate) return value;
	if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
		throw new InvalidDateError(`Expected a date like 2026-11-04, got ${JSON.stringify(value)}`);
	}
	try {
		return Temporal.PlainDate.from(value);
	} catch {
		throw new InvalidDateError(`Not a valid date: ${value}`);
	}
}

function toPlainDateTime(value: unknown): Temporal.PlainDateTime {
	if (value instanceof Temporal.PlainDateTime) {
		if (!value.equals(value.round({ smallestUnit: 'minute', roundingMode: 'trunc' }))) {
			throw new InvalidDateError(`Timed dates have minute precision, got ${value.toString()}`);
		}
		return value;
	}
	if (typeof value !== 'string' || !DATE_TIME_PATTERN.test(value)) {
		throw new InvalidDateError(
			`Expected a date-time like 2026-11-04T09:00, got ${JSON.stringify(value)}`
		);
	}
	try {
		return Temporal.PlainDateTime.from(value);
	} catch {
		throw new InvalidDateError(`Not a valid date-time: ${value}`);
	}
}

/** Validates an IANA time zone name and returns it in canonical case. */
function toTimeZone(value: unknown): string {
	if (typeof value !== 'string' || /^[+-]/.test(value)) {
		throw new InvalidDateError(`Expected an IANA time zone, got ${JSON.stringify(value)}`);
	}
	try {
		return new Temporal.ZonedDateTime(0n, value).timeZoneId;
	} catch {
		throw new InvalidDateError(`Unknown time zone: ${value}`);
	}
}

function toDurationMinutes(value: unknown): number {
	if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
		throw new InvalidDateError(
			`Duration must be a positive whole number of minutes, got ${JSON.stringify(value)}`
		);
	}
	return value;
}

export const unsetDate: UnsetDate = Object.freeze({ kind: 'unset' });

/** A date-only (all-day) Planned or Due Date. */
export function dateOnly(date: Temporal.PlainDate | string): DateOnly {
	return { kind: 'date', date: toPlainDate(date) };
}

/** A timed Due Date: a point in time given as wall-clock date-time in an IANA zone. */
export function timedDueDate(
	dateTime: Temporal.PlainDateTime | string,
	timeZone: string
): TimedDueDate {
	return { kind: 'timed', dateTime: toPlainDateTime(dateTime), timeZone: toTimeZone(timeZone) };
}

/** A timed Planned Date: wall-clock start in an IANA zone, lasting `durationMinutes`. */
export function timedPlannedDate(
	dateTime: Temporal.PlainDateTime | string,
	timeZone: string,
	durationMinutes: number = DEFAULT_DURATION_MINUTES
): TimedPlannedDate {
	return {
		...timedDueDate(dateTime, timeZone),
		durationMinutes: toDurationMinutes(durationMinutes)
	};
}

/** The calendar date of a set date: the date itself, or the wall-clock date in its own zone. */
export function localDate(value: DateOnly | TimedDate): Temporal.PlainDate {
	return value.kind === 'date' ? value.date : value.dateTime.toPlainDate();
}

/**
 * The instant of a timed date, in its zone. Wall-clock times inside a DST gap resolve forward and
 * ambiguous ones (DST overlap) to the earlier instant (Temporal's `compatible` disambiguation,
 * which matches RFC 5545).
 */
export function toZonedDateTime(value: TimedDate): Temporal.ZonedDateTime {
	return value.dateTime.toZonedDateTime(value.timeZone, { disambiguation: 'compatible' });
}

function asObject(value: unknown): Record<string, unknown> {
	if (typeof value !== 'object' || value === null) {
		throw new InvalidDateError(`Expected a date object or null, got ${JSON.stringify(value)}`);
	}
	return value as Record<string, unknown>;
}

function parseSet(json: Record<string, unknown>): DateOnly | TimedDueDate {
	switch (json.kind) {
		case 'date':
			return dateOnly(json.date as string);
		case 'timed':
			return timedDueDate(json.dateTime as string, json.timeZone as string);
		default:
			throw new InvalidDateError(`Unknown date kind: ${JSON.stringify(json.kind)}`);
	}
}

/** Parses and validates a serialized Planned Date. Throws {@link InvalidDateError}. */
export function parsePlannedDate(value: unknown): PlannedDate {
	if (value === null) return unsetDate;
	const json = asObject(value);
	const parsed = parseSet(json);
	if (parsed.kind === 'date') return parsed;
	return { ...parsed, durationMinutes: toDurationMinutes(json.durationMinutes) };
}

/** Parses and validates a serialized Due Date. Throws {@link InvalidDateError}. */
export function parseDueDate(value: unknown): DueDate {
	if (value === null) return unsetDate;
	const json = asObject(value);
	if (json.kind === 'timed' && 'durationMinutes' in json) {
		throw new InvalidDateError('A Due Date is a point in time and has no Duration');
	}
	return parseSet(json);
}

function serializeDateOnly(value: DateOnly): SerializedDateOnly {
	return { kind: 'date', date: value.date.toString() };
}

function serializeTimed(value: TimedDate): SerializedTimedDueDate {
	return {
		kind: 'timed',
		dateTime: value.dateTime.toString({ smallestUnit: 'minute' }),
		timeZone: value.timeZone
	};
}

export function serializePlannedDate(planned: PlannedDate): SerializedPlannedDate {
	switch (planned.kind) {
		case 'unset':
			return null;
		case 'date':
			return serializeDateOnly(planned);
		case 'timed':
			return { ...serializeTimed(planned), durationMinutes: planned.durationMinutes };
	}
}

export function serializeDueDate(due: DueDate): SerializedDueDate {
	switch (due.kind) {
		case 'unset':
			return null;
		case 'date':
			return serializeDateOnly(due);
		case 'timed':
			return serializeTimed(due);
	}
}
