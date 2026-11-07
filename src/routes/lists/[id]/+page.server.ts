import { error } from '@sveltejs/kit';
import { TASKS_DEPENDENCY } from '#lib/dependencies.js';
import { getAuthConfig } from '#lib/server/auth/config.js';
import { loadColumns } from '#lib/server/columns.js';
import { rememberLastViewedList } from '#lib/server/last-viewed-list.js';
import { getList } from '#lib/server/lists.js';
import { userScope } from '#lib/server/scope.js';
import type { PageServerLoad } from './$types';

/**
 * A deep link to one List: the same columns view as `/`, focused on this List (even if it is
 * hidden). 404 for Lists that don't exist or belong to another User.
 */
export const load: PageServerLoad = ({ locals, params, depends, cookies }) => {
	depends(TASKS_DEPENDENCY);
	const scope = userScope(locals);
	const list = getList(scope, params.id);
	if (!list) error(404, 'List not found');

	rememberLastViewedList(cookies, getAuthConfig(), list.id);
	return loadColumns(scope, list.id);
};
