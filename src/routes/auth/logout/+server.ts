import { redirect } from '@sveltejs/kit';
import { getAuthConfig } from '#lib/server/auth/config.js';
import { deleteSessionCookie } from '#lib/server/auth/cookies.js';
import { invalidateSession } from '#lib/server/auth/session.js';
import { getDb } from '#lib/server/db.js';
import type { RequestHandler } from './$types';

/**
 * Ends the current session only; the User stays signed in at the provider and
 * in their other browsers. POST-only, so SvelteKit's origin check protects it
 * from cross-site requests: use `<form method="POST" action="/auth/logout">`.
 */
export const POST: RequestHandler = ({ locals, cookies }) => {
	if (locals.session) invalidateSession(getDb(), locals.session.id);
	deleteSessionCookie(cookies, getAuthConfig());

	redirect(303, '/auth/login?signedOut=1');
};
