import { expect, test } from './fixtures';
import { loginAs } from './auth';

const settingsHeading = (page: import('@playwright/test').Page, name: string) =>
	page.getByRole('heading', { name, exact: true, level: 1 });

test('choosing a Language in Settings applies everywhere, follows the User, and Automatic undoes it', async ({
	browser,
	page
}) => {
	const user = await loginAs(page);
	await page.goto('/settings');
	await expect(settingsHeading(page, 'Settings')).toBeVisible();
	const picker = page.getByRole('combobox', { name: 'Language' });
	await expect(picker).toHaveValue('automatic');
	// Each option in its own language.
	await expect(picker.getByRole('option')).toHaveText([
		'Automatic (from your browser)',
		'English',
		'Deutsch'
	]);

	await picker.selectOption('de');
	await expect(settingsHeading(page, 'Einstellungen')).toBeVisible();
	await expect(page.locator('html')).toHaveAttribute('lang', 'de');
	await expect(page.getByRole('heading', { name: 'Kalender-Links' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Neuer Kalender-Link' })).toBeVisible();
	await expect(page.getByText('Noch keine Kalender-Links.')).toBeVisible();
	await expect(page.getByRole('combobox', { name: 'Sprache' })).toHaveValue('de');

	// Server-rendered in German although the browser asks for English: no flicker.
	const html = await (await page.request.get('/')).text();
	expect(html).toContain('<html lang="de">');
	expect(html).toContain('Einstellungen');
	expect(html).not.toContain('>Settings<');

	// Another browser of the same User, also asking for English.
	const other = await browser.newContext({ locale: 'en-US' });
	const otherPage = await other.newPage();
	await loginAs(otherPage, user);
	const otherHtml = await (await otherPage.request.get('/settings')).text();
	expect(otherHtml).toContain('<html lang="de">');
	expect(otherHtml).toContain('Kalender-Links');
	await other.close();

	// Nobody signed in: still by Accept-Language.
	const anonymous = await browser.newContext({ locale: 'en-US' });
	const login = await anonymous.request.get('/auth/login');
	expect(await login.text()).toContain('<html lang="en">');
	await anonymous.close();

	await page.getByRole('combobox', { name: 'Sprache' }).selectOption('automatic');
	await expect(settingsHeading(page, 'Settings')).toBeVisible();
	await expect(page.locator('html')).toHaveAttribute('lang', 'en');
});

test('a German browser can choose English', async ({ browser }) => {
	const context = await browser.newContext({ locale: 'de-DE' });
	const page = await context.newPage();
	await loginAs(page);
	await page.goto('/settings');
	await expect(settingsHeading(page, 'Einstellungen')).toBeVisible();

	await page.getByRole('combobox', { name: 'Sprache' }).selectOption('en');
	await expect(settingsHeading(page, 'Settings')).toBeVisible();
	await expect(page.locator('html')).toHaveAttribute('lang', 'en');
	await context.close();
});

test('a Language the app does not speak is refused', async ({ page }) => {
	await loginAs(page);
	const status = await page.evaluate(async () => {
		const response = await fetch('/api/language-preference', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ languagePreference: 'fr' })
		});
		return response.status;
	});
	expect(status).toBe(400);
});
