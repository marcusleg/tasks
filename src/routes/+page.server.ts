import { TASKS_DEPENDENCY } from '#lib/dependencies.js';
import { getAuthConfig } from '#lib/server/auth/config.js';
import { loadColumns } from '#lib/server/columns.js';
import { lastViewedList } from '#lib/server/last-viewed-list.js';
import { getStartList } from '#lib/server/lists.js';
import { userScope } from '#lib/server/scope.js';
import type { PageServerLoad } from './$types';

/**
 * The visible Lists as columns; on narrow screens the List last viewed on this device (or the
 * first). `list` is `null` when the User has no Lists.
 */
export const load: PageServerLoad = async ({ locals, depends, parent, cookies }) => {
	depends(TASKS_DEPENDENCY);
	// The layout sets a new User up; wait for it so their first List is there.
	await parent();

	const scope = userScope(locals);
	return loadColumns(scope, getStartList(scope, lastViewedList(cookies, getAuthConfig()))?.id);
};
