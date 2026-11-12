import { TASKS_DEPENDENCY } from '#lib/dependencies.js';
import { serializeTask } from '#lib/domain/tasks.js';
import { getLists } from '#lib/server/lists.js';
import { userScope } from '#lib/server/scope.js';
import { getTasksOfLists } from '#lib/server/tasks.js';
import type { PageServerLoad } from './$types';

/** The visible Lists as columns (side by side, or stacked on narrow screens). */
export const load: PageServerLoad = async ({ locals, depends, parent }) => {
	depends(TASKS_DEPENDENCY);
	// The layout sets a new User up; wait for it so their first List is there.
	await parent();

	const scope = userScope(locals);
	const ids = getLists(scope)
		.filter((list) => list.visible)
		.map((list) => list.id);
	return { tasks: getTasksOfLists(scope, ids).map(serializeTask) };
};
