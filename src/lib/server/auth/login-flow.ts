import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';
import type { AuthConfig } from './config.js';

/**
 * The transient state of one login attempt, kept between `/auth/login` and
 * `/auth/callback` in a short-lived, HttpOnly, encrypted cookie.
 */
export interface LoginFlow {
	state: string;
	nonce: string;
	codeVerifier: string;
	/** Validated same-origin path to return to after login. */
	returnTo: string;
}

/** A login attempt has to be finished within this time. */
export const LOGIN_FLOW_TTL_SECONDS = 10 * 60;

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const AAD = Buffer.from('tasks/login-flow/v1');

/**
 * Derives the cookie encryption key from the client secret, which only this
 * server (and the provider) knows, so no extra secret has to be configured.
 * Rotating the client secret just invalidates logins that are in progress.
 */
function deriveKey(clientSecret: string): Buffer {
	return Buffer.from(hkdfSync('sha256', clientSecret, '', 'tasks login-flow cookie key', 32));
}

/** Encrypts and authenticates `flow` (AES-256-GCM), stamping it with an expiry. */
export function sealLoginFlow(flow: LoginFlow, clientSecret: string, now = Date.now()): string {
	const iv = randomBytes(IV_BYTES);
	const cipher = createCipheriv(ALGORITHM, deriveKey(clientSecret), iv);
	cipher.setAAD(AAD);
	const plaintext = JSON.stringify({ ...flow, exp: now + LOGIN_FLOW_TTL_SECONDS * 1000 });
	const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64url');
}

/**
 * Decrypts a sealed login flow. Returns `null` if it was tampered with, sealed
 * with a different secret, malformed or expired. GCM verifies the tag in
 * constant time.
 */
export function unsealLoginFlow(
	sealed: string,
	clientSecret: string,
	now = Date.now()
): LoginFlow | null {
	try {
		const data = Buffer.from(sealed, 'base64url');
		if (data.length <= IV_BYTES + TAG_BYTES) return null;

		const decipher = createDecipheriv(
			ALGORITHM,
			deriveKey(clientSecret),
			data.subarray(0, IV_BYTES)
		);
		decipher.setAAD(AAD);
		decipher.setAuthTag(data.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
		const plaintext = Buffer.concat([
			decipher.update(data.subarray(IV_BYTES + TAG_BYTES)),
			decipher.final()
		]).toString('utf8');

		const parsed: unknown = JSON.parse(plaintext);
		if (!isSealedFlow(parsed) || parsed.exp <= now) return null;

		const { state, nonce, codeVerifier, returnTo } = parsed;
		return { state, nonce, codeVerifier, returnTo };
	} catch {
		return null;
	}
}

function isSealedFlow(value: unknown): value is LoginFlow & { exp: number } {
	if (typeof value !== 'object' || value === null) return false;
	const v = value as Record<string, unknown>;
	return (
		typeof v.state === 'string' &&
		typeof v.nonce === 'string' &&
		typeof v.codeVerifier === 'string' &&
		typeof v.returnTo === 'string' &&
		typeof v.exp === 'number'
	);
}

/** `__Secure-` needs https; the cookie is scoped to `/auth/` so other routes never see it. */
function loginFlowCookieName(config: Pick<AuthConfig, 'secureCookies'>): string {
	return config.secureCookies ? '__Secure-tasks_login' : 'tasks_login';
}

const cookieOptions = (config: Pick<AuthConfig, 'secureCookies'>) => ({
	path: '/auth/',
	httpOnly: true,
	// Lax (not Strict) so the cookie comes along on the top-level redirect back from the provider.
	sameSite: 'lax' as const,
	secure: config.secureCookies
});

export function setLoginFlowCookie(
	cookies: Cookies,
	config: Pick<AuthConfig, 'secureCookies' | 'clientSecret'>,
	flow: LoginFlow
): void {
	cookies.set(loginFlowCookieName(config), sealLoginFlow(flow, config.clientSecret), {
		...cookieOptions(config),
		maxAge: LOGIN_FLOW_TTL_SECONDS
	});
}

/** Reads and clears the login flow cookie. Each login attempt can be completed once. */
export function takeLoginFlowCookie(
	cookies: Cookies,
	config: Pick<AuthConfig, 'secureCookies' | 'clientSecret'>
): LoginFlow | null {
	const name = loginFlowCookieName(config);
	const sealed = cookies.get(name);
	if (sealed === undefined) return null;

	cookies.delete(name, cookieOptions(config));
	return unsealLoginFlow(sealed, config.clientSecret);
}
