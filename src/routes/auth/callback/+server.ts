import { redirect } from '@sveltejs/kit';
import { getAuthConfig } from '#lib/server/auth/config.js';
import { setSessionCookie } from '#lib/server/auth/cookies.js';
import { takeLoginFlowCookie } from '#lib/server/auth/login-flow.js';
import {
	describeError,
	finishLogin,
	isAllowedToSignIn,
	type OidcIdentity
} from '#lib/server/auth/oidc.js';
import { createSession, invalidateSession } from '#lib/server/auth/session.js';
import { upsertUser } from '#lib/server/auth/users.js';
import { getDb } from '#lib/server/db.js';
import type { RequestHandler } from './$types';

/** Where the provider sends the browser back to after sign-in. */
export const GET: RequestHandler = async ({ url, cookies, locals }) => {
	const config = getAuthConfig();

	const flow = takeLoginFlowCookie(cookies, config);
	if (!flow) redirect(303, '/auth/login?error=expired');

	const backToLogin = (error: string) => {
		const params = new URLSearchParams({ error });
		if (flow.returnTo !== '/') params.set('returnTo', flow.returnTo);
		return `/auth/login?${params}`;
	};

	const providerError = url.searchParams.get('error');
	if (providerError) {
		console.warn(`OIDC provider returned error: ${providerError.slice(0, 100)}`);
		redirect(303, backToLogin(providerError === 'access_denied' ? 'denied' : 'provider'));
	}

	let identity: OidcIdentity;
	try {
		identity = await finishLogin(config, flow, url.search);
	} catch (error) {
		console.error('OIDC login failed:', describeError(error));
		redirect(303, backToLogin('failed'));
	}

	// No account is created for someone outside the allowed group.
	if (!isAllowedToSignIn(identity.groups, config.allowedGroup)) {
		redirect(303, '/auth/not-allowed');
	}

	const db = getDb();
	// A fresh session for every login, never one that existed before it.
	if (locals.session) invalidateSession(db, locals.session.id);

	const user = upsertUser(db, identity);
	const { token, session } = createSession(db, user.id);
	setSessionCookie(cookies, config, token, session.expiresAt);

	redirect(303, flow.returnTo);
};
