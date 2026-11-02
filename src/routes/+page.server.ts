import { TASKS_DEPENDENCY } from '#lib/dependencies.js';
import { loadColumns } from '#lib/server/columns.js';
import { getStartList } from '#lib/server/lists.js';
import { userScope } from '#lib/server/scope.js';
import type { PageServerLoad } from './$types';

/**
 * The visible Lists as columns; on narrow screens the last-viewed List (or the first). `list` is
 * `null` when the User has no Lists.
 */
export const load: PageServerLoad = async ({ locals, depends, parent }) => {
	depends(TASKS_DEPENDENCY);
	// The layout sets a new User up; wait for it so their "My Tasks" List is there.
	await parent();

	const scope = userScope(locals);
	return loadColumns(scope, getStartList(scope)?.id);
};
