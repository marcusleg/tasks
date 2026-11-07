import { json } from '@sveltejs/kit';
import { notFound, readJson } from '#lib/server/http.js';
import { userScope } from '#lib/server/scope.js';
import { readTimeZone } from '#lib/server/task-input.js';
import { completeTask, serializeChanges } from '#lib/server/tasks.js';
import { undoable } from '#lib/server/undo.js';
import type { RequestHandler } from './$types';

/**
 * Marks a Task Completed: `{ timeZone? }` → `TaskChanges & { undo }`, including the next Occurrence
 * of a recurring Task. `undo` is what `POST /api/undo` takes to put back exactly the state before
 * (unlike Reopen, which follows its own rules); it is `null` if completing changed nothing.
 * `timeZone` is the browser's IANA zone; completion-anchored Recurrences of a
 * date-only Task count from the completion date there (see `completeTask`).
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const scope = userScope(locals);
	const timeZone = readTimeZone(await readJson(request));

	const changes = undoable(scope, () => completeTask(scope, params.id, new Date(), timeZone));
	if (!changes) notFound('Task');
	return json({ ...serializeChanges(changes), undo: changes.undoId });
};
