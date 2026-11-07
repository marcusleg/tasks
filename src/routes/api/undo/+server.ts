import { error, json } from '@sveltejs/kit';
import { readJson, requiredString, withInputErrors } from '#lib/server/http.js';
import { userScope } from '#lib/server/scope.js';
import { serializeChanges } from '#lib/server/tasks.js';
import { UndoConflictError, undoLatest } from '#lib/server/undo.js';
import type { RequestHandler } from './$types';

/**
 * Undoes the User's latest action (ADR 0004): `{ undoId }`, the `undo` field of that action's
 * answer → `TaskChanges`. 404 if it isn't the User's latest action any more, or was never theirs.
 * 409 if the state has moved on (see `#lib/server/undo`); nothing is overwritten.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const scope = userScope(locals);
	const undoId = requiredString(await readJson(request), 'undoId');

	const changes = withInputErrors(() => {
		try {
			return undoLatest(scope, undoId);
		} catch (cause) {
			if (cause instanceof UndoConflictError) error(409, cause.message);
			throw cause;
		}
	});
	if (!changes) error(404, 'That action can’t be undone any more');
	return json(serializeChanges(changes));
};
