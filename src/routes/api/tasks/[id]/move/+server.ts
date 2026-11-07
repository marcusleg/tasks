import { error, json } from '@sveltejs/kit';
import {
	notFound,
	optionalString,
	readJson,
	requiredString,
	withInputErrors
} from '#lib/server/http.js';
import { userScope } from '#lib/server/scope.js';
import { getTask, moveTask, serializeChanges } from '#lib/server/tasks.js';
import { undoable } from '#lib/server/undo.js';
import type { RequestHandler } from './$types';

/**
 * Moves a Task in Custom Order: `{ listId, parentId, before?, after? }` →
 * `TaskChanges` (plus `undo` for a move to another List). `parentId` is the new parent (`null` for
 * top level); `before` or `after` is the id of a new sibling to sit next to. Without either, a
 * top-level Task goes to the top of the List and a Subtask to the bottom of its parent's Subtasks.
 * Moving to another List takes the Subtasks along and offers Undo: `undo` is what `POST /api/undo`
 * takes. A move within a List shows no toast, so it isn't undoable and leaves the record alone
 * (`undo` is `null`).
 * 400 for a move the rules don't allow (see `moveError`), 404 if the Task or List isn't the User's.
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const scope = userScope(locals);
	const body = await readJson(request);
	if (body.parentId === undefined) error(400, 'parentId is required (null for a top-level Task)');
	const move = {
		listId: requiredString(body, 'listId'),
		parentId: body.parentId === null ? null : requiredString(body, 'parentId'),
		before: optionalString(body, 'before'),
		after: optionalString(body, 'after')
	};
	if (move.before !== undefined && move.after !== undefined) {
		error(400, 'Give before or after, not both');
	}

	// Only a move to another List shows a toast, so only that replaces the User's Undo record.
	const task = getTask(scope, params.id);
	const toAnotherList = task !== undefined && task.listId !== move.listId;
	const changes = withInputErrors(() =>
		toAnotherList
			? undoable(scope, () => moveTask(scope, params.id, move))
			: moveTask(scope, params.id, move)
	);
	if (!changes) notFound('Task or List');
	return json({
		...serializeChanges(changes),
		undo: 'undoId' in changes ? changes.undoId : null
	});
};
