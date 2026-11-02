import { expect, test, type Page } from '@playwright/test';
import { loginAs } from './auth';
import { addSubtask, addTask, createList, detailPanel, saved } from './lists-tasks';

test.use({ timezoneId: 'Europe/Berlin', locale: 'en-GB' });

test.beforeEach(async ({ page }) => {
	await loginAs(page);
});

const SHOTS =
	'/tmp/claude-1000/-home-marcus-git-github-com-marcusleg-tasks/4cdbec18-0587-4ea1-a88f-487307ae1923/scratchpad/shots';

const group = (page: Page, name: 'High' | 'Medium' | 'Low') =>
	page.getByRole('region', { name, exact: true });
const rows = (page: Page, name: 'High' | 'Medium' | 'Low') =>
	group(page, name).locator('li[data-task-id]');
const row = (page: Page, title: string) =>
	page.locator('li[data-task-id]', {
		has: page.getByRole('button', { name: title, exact: true })
	});

async function setPriority(page: Page, title: string, from: string, to: string) {
	const task = row(page, title);
	await task.getByRole('button', { name: `Priority: ${from}` }).click();
	await saved(page, () => task.getByRole('button', { name: to, exact: true }).click());
}

test('shows open Tasks by Priority with their List names and breadcrumbs', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await page.goto('/');
	await addTask(page, 'Plain');
	await addTask(page, 'Beta');
	await addTask(page, 'Alpha');
	await createList(page, 'Work');
	await addTask(page, 'Gamma');
	await page.getByRole('button', { name: 'Gamma', exact: true }).click();
	await addSubtask(page, 'Delta');
	await page.keyboard.press('Escape');
	await expect(detailPanel(page)).toBeHidden();
	// Both Lists are shown as columns; set Priorities from the rows.
	await setPriority(page, 'Gamma', 'None', 'High');
	await setPriority(page, 'Alpha', 'None', 'High');
	await setPriority(page, 'Beta', 'None', 'Low');
	await setPriority(page, 'Delta', 'None', 'Medium');

	await page
		.getByRole('navigation', { name: 'Main' })
		.getByRole('link', { name: 'Priority' })
		.click();
	await expect(page).toHaveURL(/\/priority$/);
	await expect(
		page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Priority' })
	).toHaveAttribute('aria-current', 'page');

	await expect(rows(page, 'High').locator('.open')).toHaveText(['Alpha', 'Gamma']);
	await expect(rows(page, 'Medium').locator('.open')).toHaveText(['Delta']);
	await expect(rows(page, 'Low').locator('.open')).toHaveText(['Beta']);
	await expect(row(page, 'Alpha')).toContainText('My Tasks');
	await expect(row(page, 'Gamma')).toContainText('Work');
	await expect(row(page, 'Delta')).toContainText('Work');
	await expect(row(page, 'Delta')).toContainText('Gamma ›');
	await expect(page.getByRole('button', { name: 'Plain', exact: true })).toHaveCount(0);

	for (const theme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme: theme });
		await page.screenshot({ path: `${SHOTS}/issue13-1280-${theme}.png` });
	}

	// Changing Priority moves the row.
	await setPriority(page, 'Beta', 'Low', 'Medium');
	await expect(rows(page, 'Medium').locator('.open')).toHaveText(['Beta', 'Delta']);
	await expect(rows(page, 'Low')).toHaveCount(0);
	await expect(group(page, 'Low')).toContainText('No low-priority tasks');

	// Clearing removes it.
	await setPriority(page, 'Beta', 'Medium', 'None');
	await expect(row(page, 'Beta')).toHaveCount(0);

	// Completing removes it.
	await saved(page, () => row(page, 'Alpha').getByRole('checkbox', { name: 'Alpha' }).click());
	await expect(row(page, 'Alpha')).toHaveCount(0);
	await page.reload();
	await expect(rows(page, 'High').locator('.open')).toHaveText(['Gamma']);

	// The detail panel opens from the row and from ?task=.
	await row(page, 'Gamma').getByRole('button', { name: 'Gamma', exact: true }).click();
	await expect(detailPanel(page)).toBeVisible();
	await expect(page).toHaveURL(/\/priority\?task=/);
	await page.reload();
	await expect(detailPanel(page)).toBeVisible();
	await expect(detailPanel(page).getByRole('button', { name: 'Delta' })).toBeVisible();
});

test('shows one column at a time on a narrow screen', async ({ page }) => {
	await page.setViewportSize({ width: 360, height: 740 });
	await page.goto('/');
	await addTask(page, 'Low one');
	await addTask(page, 'High one');
	await setPriority(page, 'High one', 'None', 'High');
	await setPriority(page, 'Low one', 'None', 'Low');
	await page.goto('/priority');

	const switcher = page.getByRole('combobox', { name: 'Priority' });
	await expect(switcher).toHaveValue('high');
	await expect(group(page, 'High')).toBeVisible();
	await expect(group(page, 'Low')).toBeHidden();
	await expect(rows(page, 'High').locator('.open')).toHaveText(['High one']);
	for (const theme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme: theme });
		await page.screenshot({ path: `${SHOTS}/issue13-360-${theme}.png` });
	}

	await switcher.selectOption('low');
	await expect(group(page, 'Low')).toBeVisible();
	await expect(group(page, 'High')).toBeHidden();
	await expect(rows(page, 'Low').locator('.open')).toHaveText(['Low one']);
	await switcher.selectOption('medium');
	await expect(group(page, 'Medium')).toContainText('No medium-priority tasks');
});
