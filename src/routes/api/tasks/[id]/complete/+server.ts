import { json } from '@sveltejs/kit';
import { notFound, readJson } from '#lib/server/http.js';
import { userScope } from '#lib/server/scope.js';
import { completeTask, serializeChanges } from '#lib/server/tasks.js';
import type { RequestHandler } from './$types';

/**
 * Marks a Task Completed → `TaskChanges`. The body is `{}` for now; #16 adds the browser's time
 * zone for completion-anchored Recurrences.
 */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const scope = userScope(locals);
	await readJson(request);

	const changes = completeTask(scope, params.id);
	if (!changes) notFound('Task');
	return json(serializeChanges(changes));
};
