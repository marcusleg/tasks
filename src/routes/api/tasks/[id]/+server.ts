import { json } from '@sveltejs/kit';
import { notFound, optionalString, readJson, withInputErrors } from '#lib/server/http.js';
import { userScope } from '#lib/server/scope.js';
import { deleteTask, serializeChanges, updateTask } from '#lib/server/tasks.js';
import type { RequestHandler } from './$types';

/** Edits a Task: `{ title?, description? }` → `TaskChanges`. */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const scope = userScope(locals);
	const body = await readJson(request);
	const patch = {
		title: optionalString(body, 'title'),
		description: optionalString(body, 'description')
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
