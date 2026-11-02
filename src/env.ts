import { defineEnvVars } from '@sveltejs/kit/env';

/** Treats unset and blank values alike, so `FOO=` in a compose file means "not set". */
const optional = (value: string | undefined) => value?.trim() || undefined;

/** An absolute http(s) URL, or `undefined` when unset. */
const optionalUrl = (name: string) => (value: string | undefined) => {
	const trimmed = optional(value);
	if (trimmed === undefined) return undefined;

	let url: URL;
	try {
		url = new URL(trimmed);
	} catch {
		throw new Error(`${name} must be an absolute URL, got ${JSON.stringify(trimmed)}`);
	}
	if (url.protocol !== 'https:' && url.protocol !== 'http:') {
		throw new Error(`${name} must be an http(s) URL, got ${JSON.stringify(trimmed)}`);
	}
	return url;
};

// The OIDC variables and ORIGIN are required to run the server, but they are
// declared optional here on purpose: SvelteKit validates these schemas during
// `vite build` and in unit tests too, where they aren't set. The server checks
// for them in its `init` hook instead (see `#lib/server/auth/config.ts`) and
// refuses to start without them.
export const variables = defineEnvVars({
	DATABASE_PATH: {
		description:
			'Path to the SQLite database file. Defaults to ./data/tasks.db in dev and /data/tasks.db otherwise.',
		schema: optional
	},
	ORIGIN: {
		description:
			'Public URL of the app, e.g. https://tasks.example.com. Used to build the OIDC redirect URL and to decide whether cookies are Secure. Required.',
		schema: (value) => {
			const url = optionalUrl('ORIGIN')(value);
			if (url === undefined) return undefined;
			if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
				throw new Error(
					`ORIGIN must be just scheme, host and optional port (e.g. https://tasks.example.com), got ${JSON.stringify(value)}`
				);
			}
			return url.origin;
		}
	},
	OIDC_ISSUER: {
		description:
			'Issuer URL of the OIDC provider, e.g. https://id.example.com for Pocket ID. The discovery document is read from <issuer>/.well-known/openid-configuration. Required.',
		// Kept verbatim: it must match the `issuer` the provider advertises.
		schema: (value) => (optionalUrl('OIDC_ISSUER')(value) ? optional(value) : undefined)
	},
	OIDC_CLIENT_ID: {
		description: 'Client ID of this app at the OIDC provider. Required.',
		schema: optional
	},
	OIDC_CLIENT_SECRET: {
		description: 'Client secret of this app at the OIDC provider. Required.',
		schema: optional
	},
	OIDC_ALLOWED_GROUP: {
		description:
			'If set, only Users whose `groups` claim contains this exact value may sign in. Optional.',
		schema: optional
	}
});
