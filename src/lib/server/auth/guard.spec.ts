import { isRedirect, type RequestEvent } from '@sveltejs/kit';
import { describe, expect, it, vi } from 'vitest';
import { createTestDb, fakeCookies, insertUser } from '#lib/server/testing/index.js';
import type { Db } from '#lib/server/db/client.js';
import { parseAuthConfig } from './config';
import { createAuthHandle, isPublicPath } from './guard';
import { createSession } from './session';

const config = parseAuthConfig({
	ORIGIN: 'http://localhost:5173',
	OIDC_ISSUER: 'http://localhost:4185',
	OIDC_CLIENT_ID: 'tasks',
	OIDC_CLIENT_SECRET: 'secret'
});

interface RequestOptions {
	method?: string;
	accept?: string;
	cookies?: Record<string, string>;
	isDataRequest?: boolean;
}

/** Runs the auth `handle` for one request; returns what happened. */
async function request(db: Db, path: string, options: RequestOptions = {}) {
	const url = new URL(path, config.origin);
	const { cookies, set, deleted } = fakeCookies(options.cookies);
	const event = {
		url,
		request: new Request(url, {
			method: options.method ?? 'GET',
			headers: { accept: options.accept ?? 'text/html,application/xhtml+xml' }
		}),
		cookies,
		locals: {} as App.Locals,
		isDataRequest: options.isDataRequest ?? false,
		isRemoteRequest: false
	} as RequestEvent;
	const resolve = vi.fn(async () => new Response('page'));
	const handle = createAuthHandle({ db: () => db, config: () => config });

	try {
		const response = await handle({ event, resolve });
		return {
			response,
			resolved: resolve.mock.calls.length > 0,
			locals: event.locals,
			set,
			deleted
		};
	} catch (error) {
		if (isRedirect(error)) {
			return { redirect: error, resolved: false, locals: event.locals, set, deleted };
		}
		throw error;
	}
}

describe('auth handle', () => {
	describe('without a session', () => {
		it('redirects page requests to the login page, remembering where they were going', async () => {
			const db = createTestDb();

			const result = await request(db, '/lists/123?sort=due');

			expect(result.resolved).toBe(false);
			expect(result.redirect?.status).toBe(303);
			expect(result.redirect?.location).toBe('/auth/login?returnTo=%2Flists%2F123%3Fsort%3Ddue');
		});

		it('redirects client-side data requests too', async () => {
			const db = createTestDb();

			const result = await request(db, '/lists/123', { isDataRequest: true, accept: '*/*' });

			expect(result.redirect?.location).toBe('/auth/login?returnTo=%2Flists%2F123');
		});

		it('rejects form posts and other non-GET requests with 401', async () => {
			const db = createTestDb();

			const result = await request(db, '/lists/123', { method: 'POST' });

			expect(result.resolved).toBe(false);
			expect(result.response?.status).toBe(401);
		});

		it('rejects API-style requests with 401', async () => {
			const db = createTestDb();

			expect(
				(await request(db, '/lists.json', { accept: 'application/json' })).response?.status
			).toBe(401);
			expect((await request(db, '/api/lists')).response?.status).toBe(401);
		});

		it('rejects an unknown session token and clears the cookie', async () => {
			const db = createTestDb();

			const result = await request(db, '/', {
				method: 'POST',
				cookies: { tasks_session: 'x'.repeat(43) }
			});

			expect(result.response?.status).toBe(401);
			expect(result.deleted).toContain('tasks_session');
		});

		it.each(['/auth/login', '/auth/callback', '/auth/not-allowed', '/healthz', '/cal/abc.ics'])(
			'lets %s through',
			async (path) => {
				const db = createTestDb();

				const result = await request(db, path);

				expect(result.resolved).toBe(true);
				expect(result.locals.user).toBeNull();
			}
		);
	});

	describe('with a session', () => {
		it('resolves the session to the right User', async () => {
			const db = createTestDb();
			const alice = insertUser(db, 'alice');
			const bob = insertUser(db, 'bob');
			const { token: aliceToken } = createSession(db, alice.id);
			const { token: bobToken } = createSession(db, bob.id);

			const asAlice = await request(db, '/', { cookies: { tasks_session: aliceToken } });
			const asBob = await request(db, '/', { cookies: { tasks_session: bobToken } });

			expect(asAlice.resolved).toBe(true);
			expect(asAlice.locals.user?.id).toBe(alice.id);
			expect(asAlice.locals.session?.userId).toBe(alice.id);
			expect(asBob.locals.user?.id).toBe(bob.id);
		});

		it('does not re-send the cookie on every request', async () => {
			const db = createTestDb();
			const { token } = createSession(db, insertUser(db, 'alice').id);

			const result = await request(db, '/', { cookies: { tasks_session: token } });

			expect(result.set).toHaveLength(0);
		});

		it('re-sends the cookie with the new expiry when the session slides forward', async () => {
			const db = createTestDb();
			const user = insertUser(db, 'alice');
			const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
			const { token } = createSession(db, user.id, twentyDaysAgo);

			const result = await request(db, '/', { cookies: { tasks_session: token } });

			expect(result.set).toHaveLength(1);
			expect(result.set[0]).toMatchObject({
				name: 'tasks_session',
				value: token,
				options: { path: '/', httpOnly: true, sameSite: 'lax', secure: false }
			});
		});
	});
});

describe('isPublicPath', () => {
	it('does not treat look-alike prefixes as public', () => {
		expect(isPublicPath('/authors')).toBe(false);
		expect(isPublicPath('/calendar')).toBe(false);
		expect(isPublicPath('/healthz/x')).toBe(false);
	});
});
