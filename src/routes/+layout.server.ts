import type { LayoutServerLoad } from './$types';

/**
 * Exposes the signed-in User to every page as `data.user` (`null` on the
 * public auth pages). Only what the UI needs; issuer and subject stay on the server.
 */
export const load: LayoutServerLoad = ({ locals }) => ({
	user: locals.user
		? { id: locals.user.id, name: locals.user.name, email: locals.user.email }
		: null
});
