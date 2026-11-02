import { expect, test, type Page } from '@playwright/test';
import { loginAs } from './auth';
import { addTask, column, detailPanel, openTitles, saved } from './lists-tasks';

test.use({ timezoneId: 'Europe/Berlin', locale: 'en-GB' });

const LIST = 'My Tasks';

test.beforeEach(async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await loginAs(page);
});

async function setDue(page: Page, title: string, date: string): Promise<void> {
	await column(page, LIST).getByRole('button', { name: title, exact: true }).click();
	const input = detailPanel(page)
		.getByRole('group', { name: 'Due date' })
		.getByLabel('Date', { exact: true });
	await saved(page, async () => {
		await input.fill(date);
		await input.blur();
	});
	await page.keyboard.press('Escape');
	await expect(detailPanel(page)).toBeHidden();
}

async function sortBy(page: Page, option: string): Promise<void> {
	await column(page, LIST).getByRole('button', { name: 'List options' }).click();
	await saved(page, () =>
		column(page, LIST)
			.getByRole('group', { name: 'Sort by' })
			.getByRole('button', { name: option })
			.click()
	);
}

test('sorting by Due Date persists, and Custom Order comes back unchanged', async ({ page }) => {
	// Shown top to bottom: Bread, Eggs, Milk, Jam (new Tasks go to the top).
	for (const title of ['Jam', 'Milk', 'Eggs', 'Bread']) await addTask(page, title);
	await setDue(page, 'Milk', '2027-03-10');
	await setDue(page, 'Jam', '2027-03-01');
	await expect(openTitles(page, LIST)).toHaveText(['Bread', 'Eggs', 'Milk', 'Jam']);
	await expect(page.locator('[data-sort-indicator]')).toHaveCount(0);

	await sortBy(page, 'Due Date');
	await expect(openTitles(page, LIST)).toHaveText(['Jam', 'Milk', 'Bread', 'Eggs']);
	await expect(column(page, LIST)).toContainText('Sorted by Due Date');
	await expect(column(page, LIST).getByRole('button', { name: 'Move task' })).toHaveCount(0);

	await page.reload();
	await expect(openTitles(page, LIST)).toHaveText(['Jam', 'Milk', 'Bread', 'Eggs']);
	await expect(column(page, LIST)).toContainText('Sorted by Due Date');

	await sortBy(page, 'Custom Order');
	await expect(openTitles(page, LIST)).toHaveText(['Bread', 'Eggs', 'Milk', 'Jam']);
	await expect(column(page, LIST)).not.toContainText('Sorted by');
	await expect(column(page, LIST).getByRole('button', { name: 'Move task' }).first()).toBeVisible();
});

test('Title sort hides drag handles', async ({ page }) => {
	for (const title of ['b', 'C', 'a']) await addTask(page, title);
	await sortBy(page, 'Title');
	await expect(openTitles(page, LIST)).toHaveText(['a', 'b', 'C']);
	await expect(column(page, LIST).getByRole('button', { name: 'Move task' })).toHaveCount(0);
});
