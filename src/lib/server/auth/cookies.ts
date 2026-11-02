import type { Cookies } from '@sveltejs/kit';
import type { AuthConfig } from './config.js';

/**
 * Over https the session cookie uses the `__Host-` prefix, which makes the
 * browser insist on `Secure`, `Path=/` and no `Domain`, so a sibling subdomain
 * can't plant or overwrite it. Plain http (local development, e2e) can't use
 * the prefix.
 */
export function sessionCookieName(config: Pick<AuthConfig, 'secureCookies'>): string {
	return config.secureCookies ? '__Host-tasks_session' : 'tasks_session';
}

export function setSessionCookie(
	cookies: Cookies,
	config: Pick<AuthConfig, 'secureCookies'>,
	token: string,
	expiresAt: Date
): void {
	cookies.set(sessionCookieName(config), token, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: config.secureCookies,
		expires: expiresAt
	});
}

export function deleteSessionCookie(
	cookies: Cookies,
	config: Pick<AuthConfig, 'secureCookies'>
): void {
	cookies.delete(sessionCookieName(config), {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: config.secureCookies
	});
}
