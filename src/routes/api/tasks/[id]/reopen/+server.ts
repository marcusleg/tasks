import { json } from '@sveltejs/kit';
import { notFound, readJson } from '#lib/server/http.js';
import { userScope } from '#lib/server/scope.js';
import { reopenTask, serializeChanges } from '#lib/server/tasks.js';
import type { RequestHandler } from './$types';

/** Reopens a Completed Task (body `{}`) → `TaskChanges`. */
export const POST: RequestHandler = async ({ locals, params, request }) => {
	const scope = userScope(locals);
	await readJson(request);

	const changes = reopenTask(scope, params.id);
	if (!changes) notFound('Task');
	return json(serializeChanges(changes));
};
