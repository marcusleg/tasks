// A mock OIDC provider for e2e tests and local development, built on
// oauth2-mock-server. Run with `node e2e/oidc-mock.ts` (Node strips the types).
//
// It signs in immediately, without a login screen. Which User it signs in as
// comes from the `mock_oidc_user` cookie on the provider's origin (base64url
// JSON with sub, name, email, groups), which `loginAs()` in e2e/auth.ts sets
// per browser context; without the cookie it signs in a default User.
//
// To resemble Pocket ID it advertises client_secret_basic/_post and the
// `groups` scope, puts the claims into both the ID token and userinfo, and
// rejects token requests with wrong client credentials.
import type { IncomingMessage } from 'node:http';
import { Events, OAuth2Server } from 'oauth2-mock-server';

interface MockUser {
	sub: string;
	name?: string;
	email?: string;
	groups?: string[];
}

const port = Number(process.env.E2E_OIDC_PORT ?? 4185);
const clientId = process.env.MOCK_OIDC_CLIENT_ID ?? 'tasks-e2e';
const clientSecret = process.env.MOCK_OIDC_CLIENT_SECRET ?? 'tasks-e2e-secret';
const USER_COOKIE = 'mock_oidc_user';
const DEFAULT_USER: MockUser = {
	sub: 'dev-user',
	name: 'Dev User',
	email: 'dev@example.com',
	groups: (process.env.MOCK_OIDC_DEFAULT_GROUPS ?? '').split(',').filter(Boolean)
};

const server = new OAuth2Server();
await server.issuer.keys.generate('RS256');
server.issuer.url = `http://localhost:${port}`;

/** Claims to issue, by authorization code and then by access token. */
const usersByCode = new Map<string, MockUser>();
const usersByAccessToken = new Map<string, MockUser>();

function userFromCookie(req: IncomingMessage): MockUser {
	const cookie = (req.headers.cookie ?? '')
		.split(';')
		.map((part) => part.trim().split('='))
		.find(([name]) => name === USER_COOKIE);
	if (!cookie?.[1]) return DEFAULT_USER;
	return JSON.parse(Buffer.from(cookie[1], 'base64url').toString('utf8')) as MockUser;
}

function claimsOf(user: MockUser) {
	return { sub: user.sub, name: user.name, email: user.email, groups: user.groups ?? [] };
}

function clientCredentials(req: IncomingMessage, body: Record<string, unknown>) {
	const header = req.headers.authorization ?? '';
	if (header.startsWith('Basic ')) {
		const [id, secret] = Buffer.from(header.slice(6), 'base64').toString('utf8').split(':');
		return { id: decodeURIComponent(id ?? ''), secret: decodeURIComponent(secret ?? '') };
	}
	return { id: body.client_id, secret: body.client_secret };
}

server.service.on(Events.BeforeWellKnownOpenIdConfiguration, (response) => {
	Object.assign(response.body, {
		token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
		scopes_supported: ['openid', 'profile', 'email', 'groups'],
		claims_supported: ['sub', 'name', 'email', 'groups']
	});
});

server.service.on(Events.BeforeAuthorizeRedirect, (redirect, req) => {
	const code = redirect.url.searchParams.get('code');
	if (code) usersByCode.set(code, userFromCookie(req));
});

server.service.on(Events.BeforeTokenSigning, (token, req) => {
	// oauth2-mock-server takes `aud` from the Basic auth header without
	// form-decoding it, and openid-client encodes `-` as `%2D` there.
	if (typeof token.payload.aud === 'string') {
		token.payload.aud = decodeURIComponent(token.payload.aud);
	}
	const user = usersByCode.get(String(req.body.code));
	if (user) Object.assign(token.payload, claimsOf(user));
});

server.service.on(Events.BeforeResponse, (response, req) => {
	const code = String(req.body.code);
	const user = usersByCode.get(code);
	usersByCode.delete(code);

	const { id, secret } = clientCredentials(req, req.body as Record<string, unknown>);
	if (id !== clientId || secret !== clientSecret) {
		response.statusCode = 401;
		response.body = { error: 'invalid_client' };
		return;
	}

	const accessToken = (response.body as { access_token?: string }).access_token;
	if (user && accessToken) usersByAccessToken.set(accessToken, user);
});

server.service.on(Events.BeforeUserinfo, (response, req) => {
	const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
	const user = usersByAccessToken.get(token);
	if (user) response.body = claimsOf(user);
});

await server.start(port, 'localhost');
console.log(`Mock OIDC provider listening at ${server.issuer.url}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
	process.on(signal, () => {
		void server.stop().then(() => process.exit(0));
	});
}
