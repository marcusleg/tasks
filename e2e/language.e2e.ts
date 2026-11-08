import { expect, test } from './fixtures';
import { loginAs, setMockUser } from './auth';

test.describe('a German browser', () => {
	test.use({ locale: 'de-DE' });

	test('gets the app shell in German, already in the server-rendered HTML', async ({ page }) => {
		const login = await page.goto('/auth/login');
		const loginHtml = await login!.text();
		expect(loginHtml).toContain('<html lang="de">');
		expect(loginHtml).toContain('<title>Anmelden · Tasks</title>');
		await expect(page.getByRole('button', { name: 'Anmelden' })).toBeVisible();

		await loginAs(page);
		const home = await page.goto('/');
		const html = await home!.text();
		expect(html).toContain('<html lang="de">');
		for (const text of ['Listen', 'Neue Liste', 'Einstellungen', 'Abmelden', 'Benutzermenü']) {
			expect(html).toContain(text);
		}
		for (const text of ['>Lists<', 'New list', '>Settings<', 'Sign out', 'User menu']) {
			expect(html).not.toContain(text);
		}

		// Still German once hydrated, and the URL has no Language in it.
		expect(new URL(page.url()).pathname).toBe('/');
		await expect(page.locator('html')).toHaveAttribute('lang', 'de');
		await expect(page.getByRole('link', { name: 'Tasks', exact: true })).toBeVisible();
		const sidebar = page.getByRole('navigation', { name: 'Hauptnavigation' });
		await expect(sidebar.getByRole('heading', { name: 'Listen' })).toBeVisible();
		await expect(sidebar.getByRole('link', { name: 'Priorität' })).toBeVisible();
		// Rendered only in the browser, so the browser speaks German too.
		await sidebar.getByRole('button', { name: 'Neue Liste' }).click();
		await expect(sidebar.getByRole('textbox', { name: 'Name der neuen Liste' })).toHaveAttribute(
			'placeholder',
			'Listenname'
		);
		await page.keyboard.press('Escape');

		await page.getByRole('button', { name: 'Benutzermenü' }).click();
		const menu = page.getByRole('group', { name: 'Benutzer' });
		await expect(menu.getByRole('radiogroup', { name: 'Design' })).toBeVisible();
		await expect(menu.getByRole('radio', { name: 'Hell' })).toBeVisible();
		await expect(menu.getByRole('radio', { name: 'Dunkel' })).toBeVisible();
		await expect(menu.getByRole('button', { name: 'Abmelden' })).toBeVisible();

		await menu.getByRole('button', { name: 'Abmelden' }).click();
		await expect(page.getByRole('status')).toHaveText('Du wurdest abgemeldet.');
	});

	test('gets the error and not-allowed pages in German', async ({ page }) => {
		await loginAs(page);
		const missing = await page.goto('/lists/does-not-exist');
		expect(missing!.status()).toBe(404);
		await expect(page.getByRole('heading', { name: 'Nicht gefunden' })).toBeVisible();
		await expect(page).toHaveTitle('Nicht gefunden · Tasks');
		await expect(page.getByRole('link', { name: 'Zurück zu deinen Aufgaben' })).toBeVisible();

		await page.context().clearCookies();
		await setMockUser(page.context(), { groups: ['other-group'] });
		await page.goto('/auth/login');
		await page.getByRole('button', { name: 'Anmelden' }).click();
		await expect(page).toHaveURL('/auth/not-allowed');
		await expect(page.getByRole('heading', { name: 'Kein Zugriff' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Zurück zur Anmeldung' })).toBeVisible();
	});
});

test('a browser asking for a language the app does not speak gets English', async ({ request }) => {
	const response = await request.get('/auth/login', {
		headers: { 'accept-language': 'fr-FR,fr;q=0.9' }
	});
	const html = await response.text();

	expect(html).toContain('<html lang="en">');
	expect(html).toContain('<title>Sign in · Tasks</title>');
	expect(html).toContain('>Sign in</button>');
});
