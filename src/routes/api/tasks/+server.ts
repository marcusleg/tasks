import { json } from '@sveltejs/kit';
import {
	notFound,
	optionalString,
	readJson,
	requiredString,
	withInputErrors
} from '#lib/server/http.js';
import { userScope } from '#lib/server/scope.js';
import { readApplyTo, readDatesAndPriority } from '#lib/server/task-input.js';
import { createTask, serializeChanges } from '#lib/server/tasks.js';
import type { RequestHandler } from './$types';

/**
 * Adds a Task at the top of a List, or with `parentId` a Subtask at the bottom of its parent's:
 * `{ id?, listId, title, description?, parentId?, planned?, due?, priority? }` → `TaskChanges`.
 * Dates use the serialized shapes from `#lib/domain/dates` (`null` = unset). 400 if the parent is
 * a Subtask itself or Completed. For a Subtask of a recurring Task, `applyTo` (`occurrence` or
 * `future`, the default) says whether future Occurrences get it too.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const scope = userScope(locals);
	const body = await readJson(request);
	const input = {
		id: optionalString(body, 'id'),
		listId: requiredString(body, 'listId'),
		title: requiredString(body, 'title'),
		description: optionalString(body, 'description'),
		parentId: body.parentId === null ? null : optionalString(body, 'parentId'),
		...readDatesAndPriority(body)
	};

	const applyTo = readApplyTo(body.applyTo);

	const changes = withInputErrors(() => createTask(scope, input, applyTo));
	if (!changes) notFound('List', 'list_not_found');
	return json(serializeChanges(changes), { status: 201 });
};
