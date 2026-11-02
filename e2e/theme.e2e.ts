import { expect, test } from './fixtures';
import { loginAs } from './auth';

test.beforeEach(async ({ page }) => {
	await loginAs(page);
});

/** The theme radios live in the user menu. */
const openUserMenu = async (page: import('@playwright/test').Page) => {
	const button = page.getByRole('button', { name: 'User menu' });
	if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
};

const theme = (page: import('@playwright/test').Page) =>
	page.evaluate(() => document.documentElement.dataset.theme);

test('default theme follows the emulated colour scheme, live', async ({ page }) => {
	await page.emulateMedia({ colorScheme: 'dark' });
	await page.goto('/');
	expect(await theme(page)).toBe('dark');
	await openUserMenu(page);
	await expect(page.getByRole('radio', { name: 'System' })).toBeChecked();

	await page.emulateMedia({ colorScheme: 'light' });
	await expect.poll(() => theme(page)).toBe('light');
});

test('choosing Light persists across reload', async ({ page }) => {
	await page.emulateMedia({ colorScheme: 'dark' });
	await page.goto('/');

	await openUserMenu(page);
	await page.getByRole('radio', { name: 'Light' }).check();
	expect(await theme(page)).toBe('light');

	await page.reload();
	expect(await theme(page)).toBe('light');
	await openUserMenu(page);
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

	const menu = page.getByRole('button', { name: 'Menu', exact: true });
	await expect(page.getByRole('link', { name: 'Settings' })).toBeHidden();
	await menu.click();
	await expect(menu).toHaveAttribute('aria-expanded', 'true');
	await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(menu).toHaveAttribute('aria-expanded', 'false');
	await expect(menu).toBeFocused();
});

test('the user menu fits at 360px, shows the name and closes with Esc', async ({ page }) => {
	await page.setViewportSize({ width: 360, height: 740 });
	await page.goto('/');

	const button = page.getByRole('button', { name: 'User menu' });
	const popover = page.getByRole('group', { name: 'User' });
	await expect(popover).toBeHidden();
	await expect(button).toHaveText('T');
	await button.click();
	await expect(button).toHaveAttribute('aria-expanded', 'true');
	await expect(popover.getByText(/^Test User /)).toBeVisible();
	await expect(popover.getByRole('radio', { name: 'System' })).toBeFocused();
	await expect(popover.getByRole('button', { name: 'Sign out' })).toBeVisible();

	const box = await popover.boundingBox();
	expect(box!.x).toBeGreaterThanOrEqual(0);
	expect(box!.x + box!.width).toBeLessThanOrEqual(360);
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow).toBeLessThanOrEqual(0);

	await page.keyboard.press('Escape');
	await expect(button).toHaveAttribute('aria-expanded', 'false');
	await expect(button).toBeFocused();
});
