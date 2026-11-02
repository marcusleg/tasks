import { json } from '@sveltejs/kit';
import {
	notFound,
	optionalString,
	readJson,
	requiredString,
	withInputErrors
} from '#lib/server/http.js';
import { userScope } from '#lib/server/scope.js';
import { createTask, serializeChanges } from '#lib/server/tasks.js';
import type { RequestHandler } from './$types';

/**
 * Adds a Task at the top of a List, or with `parentId` a Subtask at the bottom of its parent's:
 * `{ id?, listId, title, description?, parentId? }` → `TaskChanges`. 400 if the parent is a
 * Subtask itself or Completed.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const scope = userScope(locals);
	const body = await readJson(request);
	const input = {
		id: optionalString(body, 'id'),
		listId: requiredString(body, 'listId'),
		title: requiredString(body, 'title'),
		description: optionalString(body, 'description'),
		parentId: body.parentId === null ? null : optionalString(body, 'parentId')
	};

	const changes = withInputErrors(() => createTask(scope, input));
	if (!changes) notFound('List');
	return json(serializeChanges(changes), { status: 201 });
};
