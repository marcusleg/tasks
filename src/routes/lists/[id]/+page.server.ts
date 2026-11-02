import { error } from '@sveltejs/kit';
import { serializeList } from '#lib/domain/lists.js';
import { serializeTask } from '#lib/domain/tasks.js';
import { TASKS_DEPENDENCY } from '#lib/dependencies.js';
import { getList, setLastViewedList } from '#lib/server/lists.js';
import { userScope } from '#lib/server/scope.js';
import { getListTasks } from '#lib/server/tasks.js';
import type { PageServerLoad } from './$types';

/** One List with its Tasks. 404 for Lists that don't exist or belong to another User. */
export const load: PageServerLoad = ({ locals, params, depends }) => {
	depends(TASKS_DEPENDENCY);
	const scope = userScope(locals);
	const list = getList(scope, params.id);
	if (!list) error(404, 'List not found');

	setLastViewedList(scope, list.id);
	return { list: serializeList(list), tasks: getListTasks(scope, list.id).map(serializeTask) };
};
