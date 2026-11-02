import { expect, test } from '@playwright/test';
import { loginAs } from './auth';

test.beforeEach(async ({ page }) => {
	await loginAs(page);
});

const theme = (page: import('@playwright/test').Page) =>
	page.evaluate(() => document.documentElement.dataset.theme);

test('default theme follows the emulated colour scheme, live', async ({ page }) => {
	await page.emulateMedia({ colorScheme: 'dark' });
	await page.goto('/');
	expect(await theme(page)).toBe('dark');
	await expect(page.getByRole('radio', { name: 'System' })).toBeChecked();

	await page.emulateMedia({ colorScheme: 'light' });
	await expect.poll(() => theme(page)).toBe('light');
});

test('choosing Light persists across reload', async ({ page }) => {
	await page.emulateMedia({ colorScheme: 'dark' });
	await page.goto('/');

	await page.getByRole('radio', { name: 'Light' }).check();
	expect(await theme(page)).toBe('light');

	await page.reload();
	expect(await theme(page)).toBe('light');
	await expect(page.getByRole('radio', { name: 'Light' })).toBeChecked();
	expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('light');
});

test('no horizontal scroll at 360px and the sidebar opens from the menu', async ({ page }) => {
	await page.setViewportSize({ width: 360, height: 740 });
	await page.goto('/');

	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow).toBeLessThanOrEqual(0);

	const menu = page.getByRole('button', { name: 'Menu' });
	await expect(page.getByRole('link', { name: 'Settings' })).toBeHidden();
	await menu.click();
	await expect(menu).toHaveAttribute('aria-expanded', 'true');
	await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(menu).toHaveAttribute('aria-expanded', 'false');
	await expect(menu).toBeFocused();
});
