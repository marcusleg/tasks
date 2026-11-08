import { json } from '@sveltejs/kit';
import { notFound, optionalString, readJson, withInputErrors } from '#lib/server/http.js';
import { userScope } from '#lib/server/scope.js';
import {
	readApplyTo,
	readDatesAndPriority,
	readRecurrence,
	readTimeZone
} from '#lib/server/task-input.js';
import { deleteTask, serializeChanges, updateTask } from '#lib/server/tasks.js';
import { undoable } from '#lib/server/undo.js';
import type { RequestHandler } from './$types';

/**
 * Edits a Task: `{ title?, description?, planned?, due?, priority?, recurrence? }` →
 * `TaskChanges`. Dates use the serialized shapes from `#lib/domain/dates` (`null` = unset) and are
 * stored with the zone they carry; Priority is `high`, `medium`, `low` or `null`; Recurrence is a
 * `SerializedRecurrence` (`#lib/domain/recurrence`) or `null` to stop repeating. 400 for a
 * recurring Task without any date, or a Recurrence that a Task and its Subtasks would share.
 *
 * `applyTo` (`occurrence` or `future`, the default) says whether a field change to a recurring
 * Task, or to a Subtask of one, reaches This Occurrence only or this and all future ones.
 */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const scope = userScope(locals);
	const body = await readJson(request);
	const patch = {
		title: optionalString(body, 'title'),
		description: optionalString(body, 'description'),
		...readDatesAndPriority(body),
		recurrence: readRecurrence(body)
	};

	const applyTo = readApplyTo(body.applyTo);

	const changes = withInputErrors(() => updateTask(scope, params.id, patch, applyTo));
	if (!changes) notFound('Task', 'task_not_found');
	return json(serializeChanges(changes));
};

/**
 * Deletes a Task and its Subtasks → `TaskChanges & { undo }`.
 * `undo` is what `POST /api/undo` takes to undo this, skipping an Occurrence included.
 * For a recurring Task, `?applyTo=occurrence` skips to the next Occurrence (counted in the
 * browser's `?timeZone` for completion-anchored rules), and `future` (the default) ends the
 * Recurrence; for a Subtask of one, it says whether future Occurrences keep it.
 */
export const DELETE: RequestHandler = ({ locals, params, url }) => {
	const applyTo = readApplyTo(url.searchParams.get('applyTo'));
	const timeZone = readTimeZone({ timeZone: url.searchParams.get('timeZone') ?? undefined });
	const scope = userScope(locals);
	const changes = undoable(scope, () =>
		deleteTask(scope, params.id, applyTo, new Date(), timeZone)
	);
	if (!changes) notFound('Task', 'task_not_found');
	return json({
		...serializeChanges(changes),
		undo: changes.undoId
	});
};
