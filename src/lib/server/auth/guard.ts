import { json, redirect, type RequestEvent } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import type { Db } from '#lib/server/db/client.js';
import type { AuthConfig } from './config.js';
import { deleteSessionCookie, sessionCookieName, setSessionCookie } from './cookies.js';
import { loginUrl } from './return-to.js';
import { validateSessionToken } from './session.js';

/**
 * Routes reachable without a session: the login flow itself, the health
 * check, and Calendar Links (`/cal/…`, authenticated by the secret in their URL).
 */
export function isPublicPath(pathname: string): boolean {
	return (
		pathname === '/healthz' ||
		pathname === '/auth' ||
		pathname.startsWith('/auth/') ||
		pathname === '/cal' ||
		pathname.startsWith('/cal/')
	);
}

type AuthEvent = Pick<
	RequestEvent,
	'url' | 'request' | 'cookies' | 'locals' | 'isDataRequest' | 'isRemoteRequest'
>;

/**
 * Resolves `locals.user` and `locals.session` from the session cookie,
 * sliding the session's expiry forward when it's due.
 */
export function authenticate(event: AuthEvent, db: Db, config: AuthConfig): void {
	event.locals.user = null;
	event.locals.session = null;
	event.locals.languagePreference = 'automatic';

	const token = event.cookies.get(sessionCookieName(config));
	if (!token) return;

	const result = validateSessionToken(db, token);
	if (!result) {
		deleteSessionCookie(event.cookies, config);
		return;
	}

	event.locals.user = result.user;
	event.locals.session = result.session;
	event.locals.languagePreference = result.languagePreference;
	if (result.extended) {
		setSessionCookie(event.cookies, config, token, result.session.expiresAt);
	}
}

/**
 * What an unauthenticated request to a protected route gets: page navigations
 * (including SvelteKit's client-side data requests) are sent to the login page
 * with a `returnTo`, everything else (form posts, API calls, remote functions)
 * gets a 401.
 */
export function rejectUnauthenticated(event: AuthEvent): Response {
	const method = event.request.method;
	const wantsPage =
		event.isDataRequest ||
		((method === 'GET' || method === 'HEAD') &&
			!event.isRemoteRequest &&
			!event.url.pathname.startsWith('/api/') &&
			(event.request.headers.get('accept') ?? '').includes('text/html'));

	if (wantsPage) {
		// `redirect()` rather than a plain 303 response, so SvelteKit turns it
		// into a client-side redirect for data requests.
		redirect(303, loginUrl(event.url.pathname + event.url.search));
	}

	return json({ message: 'Not signed in' }, { status: 401 });
}

/** The `handle` hook: authenticate every request, then guard everything that isn't public. */
export function createAuthHandle(deps: { db: () => Db; config: () => AuthConfig }): Handle {
	return async ({ event, resolve }) => {
		authenticate(event, deps.db(), deps.config());

		if (!event.locals.user && !isPublicPath(event.url.pathname)) {
			return rejectUnauthenticated(event);
		}

		return resolve(event);
	};
}
