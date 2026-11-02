import { json } from '@sveltejs/kit';
import { notFound, optionalString, readJson, withInputErrors } from '#lib/server/http.js';
import { userScope } from '#lib/server/scope.js';
import { readDatesAndPriority } from '#lib/server/task-input.js';
import { deleteTask, serializeChanges, updateTask } from '#lib/server/tasks.js';
import type { RequestHandler } from './$types';

/**
 * Edits a Task: `{ title?, description?, planned?, due?, priority? }` → `TaskChanges`. Dates use
 * the serialized shapes from `#lib/domain/dates` (`null` = unset) and are stored with the zone
 * they carry; Priority is `high`, `medium`, `low` or `null`.
 */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const scope = userScope(locals);
	const body = await readJson(request);
	const patch = {
		title: optionalString(body, 'title'),
		description: optionalString(body, 'description'),
		...readDatesAndPriority(body)
	};

	const changes = withInputErrors(() => updateTask(scope, params.id, patch));
	if (!changes) notFound('Task');
	return json(serializeChanges(changes));
};

/** Deletes a Task and its Subtasks → `TaskChanges`. */
export const DELETE: RequestHandler = ({ locals, params }) => {
	const changes = deleteTask(userScope(locals), params.id);
	if (!changes) notFound('Task');
	return json(serializeChanges(changes));
};
