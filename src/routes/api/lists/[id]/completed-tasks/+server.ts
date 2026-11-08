import { json } from '@sveltejs/kit';
import { notFound } from '#lib/server/http.js';
import { userScope } from '#lib/server/scope.js';
import { deleteCompletedTasks, serializeChanges } from '#lib/server/tasks.js';
import type { RequestHandler } from './$types';

/** "Delete all completed": removes the List's Completed Tasks → `TaskChanges`. */
export const DELETE: RequestHandler = ({ locals, params }) => {
	const changes = deleteCompletedTasks(userScope(locals), params.id);
	if (!changes) notFound('List', 'list_not_found');
	return json(serializeChanges(changes));
};
