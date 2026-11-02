/**
 * Reads the Planned Date, Due Date, Priority and Recurrence fields of a Task POST/PATCH body (see
 * `/api/tasks`), the browser's zone sent along with a completion, and which Occurrences a change
 * applies to. Dates and Recurrence come in
 * the serialized shapes of `#lib/domain/dates` and `#lib/domain/recurrence` (`null` = unset) and
 * are validated by their parsers; anything malformed is a 400 naming the field.
 */
import { error } from '@sveltejs/kit';
import {
	InvalidDateError,
	parseDueDate,
	parsePlannedDate,
	parseTimeZone,
	type DueDate,
	type PlannedDate
} from '#lib/domain/dates.js';
import {
	InvalidRecurrenceError,
	parseRecurrence,
	type RecurrenceRule
} from '#lib/domain/recurrence.js';
import { APPLY_TO, type ApplyTo } from '#lib/domain/recurring-tasks.js';
import { isPriority, PRIORITIES, type Priority } from '#lib/domain/tasks.js';
import type { JsonBody } from './http.js';

export interface DatesAndPriority {
	planned?: PlannedDate;
	due?: DueDate;
	priority?: Priority | null;
}

function readDate<T>(body: JsonBody, key: string, parse: (value: unknown) => T): T | undefined {
	if (body[key] === undefined) return undefined;
	try {
		return parse(body[key]);
	} catch (cause) {
		if (cause instanceof InvalidDateError) error(400, `${key}: ${cause.message}`);
		throw cause;
	}
}

/** The fields present in `body`; absent ones stay `undefined` (unchanged on PATCH). */
export function readDatesAndPriority(body: JsonBody): DatesAndPriority {
	const fields: DatesAndPriority = {};
	const planned = readDate(body, 'planned', parsePlannedDate);
	if (planned) fields.planned = planned;
	const due = readDate(body, 'due', parseDueDate);
	if (due) fields.due = due;
	if (body.priority !== undefined) {
		if (body.priority !== null && !isPriority(body.priority)) {
			error(400, `priority must be one of ${PRIORITIES.join(', ')} or null`);
		}
		fields.priority = body.priority;
	}
	return fields;
}

/** The `recurrence` field: a rule, `null` to stop repeating, or `undefined` when absent. */
export function readRecurrence(body: JsonBody): RecurrenceRule | null | undefined {
	if (body.recurrence === undefined || body.recurrence === null) return body.recurrence;
	try {
		return parseRecurrence(body.recurrence);
	} catch (cause) {
		if (cause instanceof InvalidRecurrenceError) error(400, `recurrence: ${cause.message}`);
		throw cause;
	}
}

/** The `timeZone` field (an IANA zone such as the browser's), or `undefined` when absent. */
export function readTimeZone(body: JsonBody): string | undefined {
	return readDate(body, 'timeZone', parseTimeZone);
}

/**
 * Which Occurrences of a recurring Task a change applies to (`applyTo` in a body, or a query
 * parameter for DELETE): `occurrence` or `future`; `undefined` when absent (the default applies).
 */
export function readApplyTo(value: unknown): ApplyTo | undefined {
	if (value === undefined || value === null) return undefined;
	if (!APPLY_TO.includes(value as ApplyTo)) error(400, `applyTo must be ${APPLY_TO.join(' or ')}`);
	return value as ApplyTo;
}
