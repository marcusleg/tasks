import { serializeList } from '#lib/domain/lists.js';
import { serializeTask } from '#lib/domain/tasks.js';
import { TASKS_DEPENDENCY } from '#lib/dependencies.js';
import { getStartList } from '#lib/server/lists.js';
import { userScope } from '#lib/server/scope.js';
import { getListTasks } from '#lib/server/tasks.js';
import type { PageServerLoad } from './$types';

/** The last-viewed List, or the first one; `list` is `null` when the User has no Lists. */
export const load: PageServerLoad = async ({ locals, depends, parent }) => {
	depends(TASKS_DEPENDENCY);
	// The layout sets a new User up; wait for it so their "My Tasks" List is there.
	await parent();

	const scope = userScope(locals);
	const list = getStartList(scope);
	return {
		list: list ? serializeList(list) : null,
		tasks: list ? getListTasks(scope, list.id).map(serializeTask) : []
	};
};
