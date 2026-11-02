import Database from 'better-sqlite3';
import { expect, test } from './fixtures';
import { loginAs, logout, sessionCookie, setMockUser } from './auth';
import { appOrigin } from './env';

test.describe('signing in', () => {
	test('an anonymous visitor is sent to the login page and comes back after signing in', async ({
		page
	}) => {
		await setMockUser(page.context());

		await page.goto('/?from=e2e');
		await expect(page).toHaveURL('/auth/login?returnTo=%2F%3Ffrom%3De2e');

		await page.getByRole('button', { name: 'Sign in' }).click();

		await expect(page).toHaveURL('/?from=e2e');
		expect(await sessionCookie(page.context())).toBeTruthy();

		// The session carries over to later requests.
		await page.reload();
		await expect(page).toHaveURL('/?from=e2e');
	});

	test('the session cookie is HttpOnly and SameSite=Lax', async ({ page }) => {
		await loginAs(page);

		const cookie = (await page.context().cookies(appOrigin)).find(
			(c) => c.name === 'tasks_session'
		);

		expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
		// About 30 days from now.
		const days = (cookie!.expires * 1000 - Date.now()) / (24 * 60 * 60 * 1000);
		expect(days).toBeGreaterThan(29.9);
		expect(days).toBeLessThanOrEqual(30);
	});

	test('a protected API-style request without a session gets 401', async ({ request }) => {
		const response = await request.post('/', {
			headers: { origin: appOrigin, 'content-type': 'application/json' },
			data: {}
		});

		expect(response.status()).toBe(401);
	});

	for (const returnTo of [
		'https://evil.example/',
		'//evil.example/',
		'/\\evil.example/',
		'javascript:alert(1)'
	]) {
		test(`ignores returnTo=${returnTo}`, async ({ page }) => {
			await setMockUser(page.context());

			await page.goto(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
			await page.getByRole('button', { name: 'Sign in' }).click();

			await expect(page).toHaveURL(`${appOrigin}/`);

			// Also when already signed in.
			await page.goto(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
			await expect(page).toHaveURL(`${appOrigin}/`);
		});
	}
});

test.describe('allowed group', () => {
	test('a User outside OIDC_ALLOWED_GROUP gets the not-allowed page and no account', async ({
		page
	}) => {
		const user = await setMockUser(page.context(), { groups: ['other-group'] });

		await page.goto('/auth/login');
		await page.getByRole('button', { name: 'Sign in' }).click();

		await expect(page).toHaveURL('/auth/not-allowed');
		await expect(page.getByRole('heading', { name: 'Not allowed' })).toBeVisible();
		expect(await sessionCookie(page.context())).toBeUndefined();

		const db = new Database(process.env.E2E_DATABASE_PATH!, { readonly: true });
		try {
			const row = db.prepare('select id from users where subject = ?').get(user.sub);
			expect(row).toBeUndefined();
		} finally {
			db.close();
		}

		await page.goto('/');
		await expect(page).toHaveURL('/auth/login');
	});
});

test.describe('signing out', () => {
	test('logout clears the session, and the old token stops working', async ({ page }) => {
		await loginAs(page);
		const token = await sessionCookie(page.context());

		await logout(page);

		expect(await sessionCookie(page.context())).toBeUndefined();
		await expect(page.getByRole('status')).toHaveText('You have been signed out.');
		await page.goto('/');
		await expect(page).toHaveURL('/auth/login');

		// Replaying the old cookie doesn't bring the session back.
		await page.context().addCookies([{ name: 'tasks_session', value: token!, url: appOrigin }]);
		await page.goto('/');
		await expect(page).toHaveURL('/auth/login');
	});

	test('a cross-site logout post is rejected by the CSRF origin check', async ({ page }) => {
		await loginAs(page);

		const response = await page.request.post('/auth/logout', {
			headers: { origin: 'https://evil.example' },
			form: {}
		});

		expect(response.status()).toBe(403);
		await page.goto('/');
		await expect(page).toHaveURL('/');
	});

	test('an expired session redirects to login', async ({ page }) => {
		const user = await loginAs(page);

		const db = new Database(process.env.E2E_DATABASE_PATH!);
		try {
			db.prepare(
				'update sessions set expires_at = 0 where user_id = (select id from users where subject = ?)'
			).run(user.sub);
		} finally {
			db.close();
		}

		await page.goto('/');
		await expect(page).toHaveURL('/auth/login');
		expect(await sessionCookie(page.context())).toBeUndefined();
	});
});
