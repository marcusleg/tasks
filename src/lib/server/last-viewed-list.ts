/**
 * The List a device last showed, which `/` opens on. It's a setting of the device, not of the User,
 * so it lives in a cookie: what one device has open never moves another. The server has to read it
 * to render `/`, which rules out browser storage.
 */
import type { Cookies } from '@sveltejs/kit';
import type { AuthConfig } from './auth/config.js';

const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

type Config = Pick<AuthConfig, 'secureCookies'>;

/** `__Host-` over https, like the session cookie (see `auth/cookies.ts`). */
const cookieName = (config: Config) =>
	config.secureCookies ? '__Host-tasks_last_viewed_list' : 'tasks_last_viewed_list';

export function rememberLastViewedList(cookies: Cookies, config: Config, listId: string): void {
	cookies.set(cookieName(config), listId, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: config.secureCookies,
		maxAge: MAX_AGE_SECONDS
	});
}

export function lastViewedList(cookies: Cookies, config: Config): string | undefined {
	return cookies.get(cookieName(config));
}
