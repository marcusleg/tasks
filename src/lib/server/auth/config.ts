import {
	OIDC_ALLOWED_GROUP,
	OIDC_CLIENT_ID,
	OIDC_CLIENT_SECRET,
	OIDC_ISSUER,
	ORIGIN
} from '$app/env/private';

export interface AuthConfig {
	/** Public origin of the app, e.g. `https://tasks.example.com` (no trailing slash). */
	origin: string;
	/** `${origin}/auth/callback`, registered as the redirect URI at the provider. */
	redirectUri: string;
	/** Whether cookies get the `Secure` attribute, i.e. whether `origin` is https. */
	secureCookies: boolean;
	issuer: string;
	clientId: string;
	clientSecret: string;
	/** Only Users whose `groups` claim contains this may sign in, when set. */
	allowedGroup: string | undefined;
}

export interface AuthEnv {
	ORIGIN?: string;
	OIDC_ISSUER?: string;
	OIDC_CLIENT_ID?: string;
	OIDC_CLIENT_SECRET?: string;
	OIDC_ALLOWED_GROUP?: string;
}

const REQUIRED = ['ORIGIN', 'OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET'] as const;

/** Builds the auth config from (already validated) env values, or throws naming what's missing. */
export function parseAuthConfig(env: AuthEnv): AuthConfig {
	const missing = REQUIRED.filter((name) => !env[name]);
	if (missing.length > 0) {
		throw new Error(
			`Missing required environment variable${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. ` +
				'Login is OIDC only, so the server cannot start without them. See "Configuration" in the README.'
		);
	}

	const origin = env.ORIGIN!;
	return {
		origin,
		redirectUri: `${origin}/auth/callback`,
		secureCookies: origin.startsWith('https:'),
		issuer: env.OIDC_ISSUER!,
		clientId: env.OIDC_CLIENT_ID!,
		clientSecret: env.OIDC_CLIENT_SECRET!,
		allowedGroup: env.OIDC_ALLOWED_GROUP
	};
}

let config: AuthConfig | undefined;

/** The app's auth config. Throws a descriptive error if a required variable is missing. */
export function getAuthConfig(): AuthConfig {
	config ??= parseAuthConfig({
		ORIGIN,
		OIDC_ISSUER,
		OIDC_CLIENT_ID,
		OIDC_CLIENT_SECRET,
		OIDC_ALLOWED_GROUP
	});
	return config;
}
