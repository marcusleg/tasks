import { fail, redirect } from '@sveltejs/kit';
import { getAuthConfig } from '#lib/server/auth/config.js';
import { setLoginFlowCookie } from '#lib/server/auth/login-flow.js';
import { describeError, startLogin } from '#lib/server/auth/oidc.js';
import { sanitizeReturnTo } from '#lib/server/auth/return-to.js';
import type { Actions, PageServerLoad } from './$types';

const ERRORS: Record<string, string> = {
	expired: 'Your sign-in attempt expired. Please try again.',
	failed: 'Signing in failed. Please try again.',
	denied: 'The identity provider denied the sign-in.',
	provider: 'The identity provider reported an error. Please try again.'
};

export const load: PageServerLoad = ({ locals, url }) => {
	if (locals.user) redirect(303, sanitizeReturnTo(url.searchParams.get('returnTo')));

	const error = url.searchParams.get('error');
	return {
		error: error ? (ERRORS[error] ?? ERRORS.failed) : null,
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
		} catch (error) {
			console.error('Could not start OIDC login:', describeError(error));
			return fail(502, {
				error: 'The identity provider could not be reached. Please try again in a moment.'
			});
		}

		setLoginFlowCookie(cookies, config, login.flow);
		// SvelteKit 3 refuses external redirects unless their origin is allowed explicitly.
		redirect(303, login.url.href, { external: [login.url.origin] });
	}
};
