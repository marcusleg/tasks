import { error } from '@sveltejs/kit';
import { TASKS_DEPENDENCY } from '#lib/dependencies.js';
import { loadColumns } from '#lib/server/columns.js';
import { getList } from '#lib/server/lists.js';
import { userScope } from '#lib/server/scope.js';
import type { PageServerLoad } from './$types';

/**
 * A deep link to one List: the same columns as `/`, focused on this List (even if it is a Hidden
 * List). 404 for Lists that don't exist or belong to another User.
 */
export const load: PageServerLoad = ({ locals, params, depends }) => {
	depends(TASKS_DEPENDENCY);
	const scope = userScope(locals);
	const list = getList(scope, params.id);
	if (!list) error(404, 'List not found');

	return loadColumns(scope, list.id);
};
