import { serializeList } from '#lib/domain/lists.js';
import { LISTS_DEPENDENCY } from '#lib/dependencies.js';
import { ensureUserSetUp, getLists } from '#lib/server/lists.js';
import { userScope } from '#lib/server/scope.js';
import type { LayoutServerLoad } from './$types';

/**
 * Exposes the signed-in User to every page as `data.user` (`null` on the
 * public auth pages). Only what the UI needs; issuer and subject stay on the server.
 * Also sets a new User up (their "My Tasks" List) and loads the Lists for the sidebar.
 */
export const load: LayoutServerLoad = ({ locals, depends }) => {
	depends(LISTS_DEPENDENCY);
	if (!locals.user) return { user: null, lists: [] };

	const scope = userScope(locals);
	ensureUserSetUp(scope);
	return {
		user: { id: locals.user.id, name: locals.user.name, email: locals.user.email },
		lists: getLists(scope).map(serializeList)
	};
};
