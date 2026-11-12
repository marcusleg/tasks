import { TASKS_DEPENDENCY } from '#lib/dependencies.js';
import { loadColumns } from '#lib/server/columns.js';
import { userScope } from '#lib/server/scope.js';
import type { PageServerLoad } from './$types';

/** The visible Lists as columns (side by side, or stacked on narrow screens). */
export const load: PageServerLoad = async ({ locals, depends, parent }) => {
	depends(TASKS_DEPENDENCY);
	// The layout sets a new User up; wait for it so their first List is there.
	await parent();

	return loadColumns(userScope(locals));
};
