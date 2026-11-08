import { fail, redirect } from '@sveltejs/kit';
import { getAuthConfig } from '#lib/server/auth/config.js';
import { setLoginFlowCookie } from '#lib/server/auth/login-flow.js';
import { describeError, startLogin } from '#lib/server/auth/oidc.js';
import { sanitizeReturnTo } from '#lib/server/auth/return-to.js';
import { parseLoginError, type LoginError } from './login-error';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, url }) => {
	if (locals.user) redirect(303, sanitizeReturnTo(url.searchParams.get('returnTo')));

	return {
		error: parseLoginError(url.searchParams.get('error')),
		signedOut: url.searchParams.has('signedOut')
	};
};

export const actions: Actions = {
	default: async ({ url, cookies }) => {
		const config = getAuthConfig();
		const returnTo = sanitizeReturnTo(url.searchParams.get('returnTo'));

		let login: Awaited<ReturnType<typeof startLogin>>;
		try {
			login = await startLogin(config, returnTo);
		} catch (cause) {
			console.error('Could not start OIDC login:', describeError(cause));
			const error: LoginError = 'unreachable';
			return fail(502, { error });
		}

		setLoginFlowCookie(cookies, config, login.flow);
		// SvelteKit 3 refuses external redirects unless their origin is allowed explicitly.
		redirect(303, login.url.href, { external: [login.url.origin] });
	}
};
