import * as client from 'openid-client';
import type { AuthConfig } from './config.js';
import type { LoginFlow } from './login-flow.js';

/** What we keep from a successful login: who it is and how to show them. */
export interface OidcIdentity {
	issuer: string;
	subject: string;
	name: string;
	email: string | null;
	/** Group names from the `groups` claim; empty if the provider sent none. */
	groups: string[];
}

/**
 * Authenticates this confidential client at the token endpoint with whichever
 * secret-based method the provider's discovery document advertises, preferring
 * `client_secret_basic` (also the default when nothing is advertised, per
 * OpenID Connect Discovery). Pocket ID advertises both.
 */
export function chooseClientAuth(clientSecret: string): client.ClientAuth {
	const basic = client.ClientSecretBasic(clientSecret);
	const post = client.ClientSecretPost(clientSecret);

	return (as, metadata, body, headers) => {
		const methods = as.token_endpoint_auth_methods_supported;
		if (!methods || methods.includes('client_secret_basic')) {
			return basic(as, metadata, body, headers);
		}
		if (methods.includes('client_secret_post')) return post(as, metadata, body, headers);
		throw new Error(
			`The OIDC provider supports neither client_secret_basic nor client_secret_post (it advertises: ${methods.join(', ')})`
		);
	};
}

let discovered: { key: string; promise: Promise<client.Configuration> } | undefined;

/**
 * Fetches (once, then caches) the provider's discovery document. A failed
 * discovery isn't cached, so the next login retries it.
 */
export function getOidcConfiguration(config: AuthConfig): Promise<client.Configuration> {
	const key = `${config.issuer}\n${config.clientId}`;
	if (discovered?.key === key) return discovered.promise;

	const issuer = new URL(config.issuer);
	const promise = client
		.discovery(
			issuer,
			config.clientId,
			{ redirect_uris: [config.redirectUri], response_types: ['code'] },
			chooseClientAuth(config.clientSecret),
			// openid-client refuses plain http unless told otherwise. That's only
			// sensible for a provider on localhost or a trusted private network.
			issuer.protocol === 'http:' ? { execute: [client.allowInsecureRequests] } : undefined
		)
		.catch((error: unknown) => {
			if (discovered?.promise === promise) discovered = undefined;
			throw error;
		});

	discovered = { key, promise };
	return promise;
}

/** Scopes to request: `groups` only where the provider offers it or a group restriction needs it. */
function scopesFor(oidc: client.Configuration, config: AuthConfig): string {
	const supported = oidc.serverMetadata().scopes_supported;
	const wantGroups = supported ? supported.includes('groups') : config.allowedGroup !== undefined;
	return ['openid', 'profile', 'email', ...(wantGroups ? ['groups'] : [])].join(' ');
}

/** Creates a login attempt: the provider URL to send the browser to, and the state to keep. */
export async function startLogin(
	config: AuthConfig,
	returnTo: string
): Promise<{ url: URL; flow: LoginFlow }> {
	const oidc = await getOidcConfiguration(config);

	const flow: LoginFlow = {
		state: client.randomState(),
		nonce: client.randomNonce(),
		codeVerifier: client.randomPKCECodeVerifier(),
		returnTo
	};

	const url = client.buildAuthorizationUrl(oidc, {
		redirect_uri: config.redirectUri,
		response_type: 'code',
		scope: scopesFor(oidc, config),
		state: flow.state,
		nonce: flow.nonce,
		code_challenge: await client.calculatePKCECodeChallenge(flow.codeVerifier),
		code_challenge_method: 'S256'
	});

	return { url, flow };
}

/**
 * Completes a login: checks `state`, exchanges the code (with the PKCE
 * verifier and client secret), validates the ID token including `nonce`, and
 * returns the identity. Throws on any failure.
 *
 * `callbackSearch` is the query string the provider sent to `/auth/callback`.
 * The callback URL is rebuilt from `ORIGIN` rather than taken from the
 * request, since it has to equal the registered redirect URI exactly.
 */
export async function finishLogin(
	config: AuthConfig,
	flow: LoginFlow,
	callbackSearch: string
): Promise<OidcIdentity> {
	const oidc = await getOidcConfiguration(config);
	const currentUrl = new URL(config.redirectUri);
	currentUrl.search = callbackSearch;

	const tokens = await client.authorizationCodeGrant(oidc, currentUrl, {
		expectedState: flow.state,
		expectedNonce: flow.nonce,
		pkceCodeVerifier: flow.codeVerifier,
		idTokenExpected: true
	});

	const idClaims = tokens.claims();
	if (!idClaims) throw new Error('The provider returned no ID token');

	let claims: Record<string, unknown> = idClaims;

	// Pocket ID puts everything in the ID token. Other providers may only
	// return some claims from the userinfo endpoint, so ask it for what's missing.
	const missing =
		claimString(claims, 'name', 'display_name', 'preferred_username') === undefined ||
		claimString(claims, 'email') === undefined ||
		(config.allowedGroup !== undefined && claims.groups === undefined);
	if (missing && oidc.serverMetadata().userinfo_endpoint) {
		const userInfo = await client.fetchUserInfo(oidc, tokens.access_token, idClaims.sub);
		// ID token claims win where both have a value.
		claims = { ...userInfo, ...stripUndefined(idClaims) };
	}

	return identityFromClaims(idClaims.iss, idClaims.sub, claims);
}

/** Maps claims to an identity, picking the best available display name. */
export function identityFromClaims(
	issuer: string,
	subject: string,
	claims: Record<string, unknown>
): OidcIdentity {
	const email = claimString(claims, 'email') ?? null;
	const fullName = [claimString(claims, 'given_name'), claimString(claims, 'family_name')]
		.filter(Boolean)
		.join(' ');
	const name =
		claimString(claims, 'name', 'display_name', 'preferred_username') ||
		fullName ||
		email ||
		subject;

	return { issuer, subject, name, email, groups: groupsFromClaim(claims.groups) };
}

/** Pocket ID sends `groups` as an array of group names; tolerate a single string too. */
export function groupsFromClaim(value: unknown): string[] {
	if (typeof value === 'string') return [value];
	if (Array.isArray(value)) return value.filter((g): g is string => typeof g === 'string');
	return [];
}

/** Whether a User with these groups may sign in. No restriction configured means everyone may. */
export function isAllowedToSignIn(groups: string[], allowedGroup: string | undefined): boolean {
	return allowedGroup === undefined || groups.includes(allowedGroup);
}

function claimString(claims: Record<string, unknown>, ...names: string[]): string | undefined {
	for (const name of names) {
		const value = claims[name];
		if (typeof value === 'string' && value.trim()) return value.trim();
	}
	return undefined;
}

function stripUndefined(object: object): Record<string, unknown> {
	return Object.fromEntries(Object.entries(object).filter(([, v]) => v !== undefined));
}

/**
 * A one-line description of a login error for the server log. Deliberately
 * leaves out claims and response bodies, and callers never log URLs, so no
 * authorization code or token ends up in the log.
 */
export function describeError(error: unknown): string {
	if (!(error instanceof Error)) return String(error);
	const code = 'code' in error && typeof error.code === 'string' ? ` [${error.code}]` : '';
	// openid-client wraps the specific reason (e.g. which claim mismatched) in `cause`.
	const reason =
		error.cause instanceof Error && error.cause.message !== error.message
			? ` (${error.cause.message})`
			: '';
	return `${error.name}${code}: ${error.message}${reason}`;
}
