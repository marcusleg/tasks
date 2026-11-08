import type { RequestEvent } from '@sveltejs/kit';
import { describe, expect, it, vi } from 'vitest';
import { parseAuthConfig } from '#lib/server/auth/config.js';
import { withLanguage } from '#lib/server/language.js';
import { fakeCookies } from '#lib/server/testing/index.js';
import { loginErrorMessage, type LoginError } from './login-error';

const config = parseAuthConfig({
	ORIGIN: 'http://localhost:5173',
	OIDC_ISSUER: 'http://localhost:4185',
	OIDC_CLIENT_ID: 'tasks',
	OIDC_CLIENT_SECRET: 'secret'
});
vi.mock('#lib/server/auth/config.js', async (original) => ({
	...(await original<typeof import('#lib/server/auth/config.js')>()),
	getAuthConfig: () => config
}));
vi.mock('#lib/server/auth/oidc.js', async (original) => ({
	...(await original<typeof import('#lib/server/auth/oidc.js')>()),
	startLogin: async () => {
		throw new TypeError('fetch failed');
	}
}));

const { actions, load } = await import('./+page.server');

function event(path: string) {
	const url = new URL(path, config.origin);
	return {
		url,
		locals: { user: null, session: null },
		cookies: fakeCookies().cookies,
		request: new Request(url, { method: 'POST' })
	} as unknown as RequestEvent;
}

describe('login page', () => {
	it.each([
		['/auth/login?error=expired', 'expired'],
		['/auth/login?error=denied', 'denied'],
		// An unknown code from a stale or hand-made link is a plain failure.
		['/auth/login?error=nonsense', 'failed'],
		['/auth/login', null]
	])('%s shows the error %s', async (path, error) => {
		const data = await (load as (event: RequestEvent) => unknown)(event(path));
		expect(data).toMatchObject({ error });
	});

	it('reports an unreachable provider from the sign-in action', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const result = await actions.default(event('/auth/login') as never);
		expect(result).toMatchObject({ status: 502, data: { error: 'unreachable' } });
	});

	it.each<[LoginError, string, string]>([
		[
			'expired',
			'Your sign-in attempt expired. Please try again.',
			'Der Anmeldeversuch ist abgelaufen. Bitte noch einmal versuchen.'
		],
		[
			'failed',
			'Signing in failed. Please try again.',
			'Die Anmeldung ist fehlgeschlagen. Bitte noch einmal versuchen.'
		],
		[
			'unreachable',
			'The identity provider could not be reached. Please try again in a moment.',
			'Der Identitätsanbieter ist nicht erreichbar. Bitte gleich noch einmal versuchen.'
		]
	])('words %s in English and German', (error, english, german) => {
		expect(withLanguage('en', () => loginErrorMessage(error))).toBe(english);
		expect(withLanguage('de', () => loginErrorMessage(error))).toBe(german);
	});
});
