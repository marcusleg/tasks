import { randomUUID } from 'node:crypto';
import { expect, type BrowserContext, type Page } from '@playwright/test';
import { allowedGroup, appOrigin, oidcIssuer } from './env';

export interface TestUser {
	sub: string;
	name: string;
	email: string;
	groups: string[];
}

/**
 * Tells the mock OIDC provider which User to sign in as for the rest of this
 * browser context. Unless given, `sub` is random (a new User each time), and
 * `groups` contains the group the e2e server requires.
 */
export async function setMockUser(
	context: BrowserContext,
	user: Partial<TestUser> = {}
): Promise<TestUser> {
	const sub = user.sub ?? `user-${randomUUID()}`;
	const full: TestUser = {
		sub,
		name: user.name ?? `Test User ${sub.slice(-6)}`,
		email: user.email ?? `${sub}@example.com`,
		groups: user.groups ?? [allowedGroup]
	};

	await context.addCookies([
		{
			name: 'mock_oidc_user',
			value: Buffer.from(JSON.stringify(full)).toString('base64url'),
			url: oidcIssuer
		}
	]);
	return full;
}

/**
 * Signs `page` in as the given User through the real login flow against the
 * mock provider, and waits until the app has redirected to `returnTo`.
 */
export async function loginAs(
	page: Page,
	user: Partial<TestUser> = {},
	{ returnTo = '/' }: { returnTo?: string } = {}
): Promise<TestUser> {
	const full = await setMockUser(page.context(), user);

	await page.goto(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
	await page.getByRole('button', { name: 'Sign in' }).click();
	await page.waitForURL(
		(url) =>
			url.origin === appOrigin &&
			(!url.pathname.startsWith('/auth/') || url.pathname === '/auth/not-allowed')
	);
	if (new URL(page.url()).pathname === '/auth/not-allowed') {
		throw new Error(`loginAs: ${full.sub} was not allowed to sign in (groups: ${full.groups})`);
	}

	return full;
}

/** Submits the logout form the way a logout button in the app would. */
export async function logout(page: Page): Promise<void> {
	await page.evaluate(() => {
		const form = document.createElement('form');
		form.method = 'POST';
		form.action = '/auth/logout';
		document.body.append(form);
		form.submit();
	});
	await expect(page).toHaveURL(/\/auth\/login\?signedOut=1$/);
}

/** The session cookie's value in this context, if any. */
export async function sessionCookie(context: BrowserContext): Promise<string | undefined> {
	const cookies = await context.cookies(appOrigin);
	return cookies.find((cookie) => cookie.name === 'tasks_session')?.value;
}
