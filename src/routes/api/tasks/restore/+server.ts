import { error, json } from '@sveltejs/kit';
import { notFound, optionalString, readJson, withInputErrors } from '#lib/server/http.js';
import { isId } from '#lib/domain/validation.js';
import { userScope } from '#lib/server/scope.js';
import {
	parseRestoredTasks,
	RestoreConflictError,
	restoreTasks
} from '#lib/server/task-restore.js';
import { serializeChanges } from '#lib/server/tasks.js';
import type { RequestHandler } from './$types';

/**
 * Undo for deleting a Task: `{ tasks: SerializedTask[] }` → `TaskChanges` (status 201), where
 * `tasks` is the `removed` field of a `DELETE /api/tasks/[id]` answer. The Tasks come back as they
 * were: ids, positions, dates, Priority, completion and Recurrence fields.
 *
 * Undo of skipping an Occurrence also sends `replaces`: the `next` of the DELETE answer, the
 * Occurrence that took the skipped one's place. It is deleted in the same transaction (listed in
 * `deleted`); 409 if it is gone, changed meanwhile, or not the next Occurrence of that series.
 *
 * 400 for malformed Tasks or a batch that breaks the Subtask rules, 404 if the List isn't the
 * User's (e.g. deleted meanwhile), 409 if an id is taken or a parent outside the batch is gone or
 * no longer fits.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	const scope = userScope(locals);
	const body = await readJson(request);
	const replaces = optionalString(body, 'replaces');
	if (replaces !== undefined && !isId(replaces)) error(400, 'replaces must be an id');

	const changes = withInputErrors(() => {
		try {
			return restoreTasks(scope, parseRestoredTasks(body.tasks), replaces);
		} catch (cause) {
			if (cause instanceof RestoreConflictError) error(409, cause.message);
			throw cause;
		}
	});
	if (!changes) notFound('List');
	return json(serializeChanges(changes), { status: 201 });
};
