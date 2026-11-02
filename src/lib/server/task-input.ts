/**
 * Reads the Planned Date, Due Date and Priority fields of a Task POST/PATCH body (see
 * `/api/tasks`). Dates come in the serialized shapes of `#lib/domain/dates` (`null` = unset) and
 * are validated by its parsers; anything malformed is a 400 naming the field.
 */
import { error } from '@sveltejs/kit';
import {
	InvalidDateError,
	parseDueDate,
	parsePlannedDate,
	type DueDate,
	type PlannedDate
} from '#lib/domain/dates.js';
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
