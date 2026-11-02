import { expect, test } from '@playwright/test';
import { loginAs } from './auth';
import { addTask, column, detailPanel, listOption, openTitles, saved } from './lists-tasks';

test.beforeEach(async ({ page }) => {
	await loginAs(page);
});

test('add Tasks: Enter adds at the top and keeps the field ready', async ({ page }) => {
	const input = page.getByRole('textbox', { name: 'Add a task' });

	await addTask(page, 'Milk');
	await expect(input).toBeFocused();
	await expect(input).toHaveValue('');
	await addTask(page, 'Eggs');
	await addTask(page, 'Bread');

	await expect(openTitles(page, 'My Tasks')).toHaveText(['Bread', 'Eggs', 'Milk']);
	await page.reload();
	await expect(openTitles(page, 'My Tasks')).toHaveText(['Bread', 'Eggs', 'Milk']);
});

test('edit Title and Description in the detail panel', async ({ page }) => {
	await addTask(page, 'Milk');

	await page.getByRole('button', { name: 'Milk' }).click();
	const panel = detailPanel(page);
	await expect(panel).toBeVisible();
	await expect(page).toHaveURL(/\?task=/);
	const title = panel.getByRole('textbox', { name: 'Title' });
	await expect(title).toBeFocused();

	await saved(page, async () => {
		await title.fill('Oat milk');
		await page.keyboard.press('Enter');
	});
	await saved(page, async () => {
		await panel
			.getByRole('textbox', { name: 'Details' })
			.fill('Brand: see https://example.com/oat <b>not bold</b>');
		await panel.getByRole('textbox', { name: 'Details' }).blur();
	});

	// The Description shows its URL as a link and everything else as plain text.
	const link = panel.getByRole('link', { name: 'https://example.com/oat' });
	await expect(link).toHaveAttribute('href', 'https://example.com/oat');
	await expect(link).toHaveAttribute('rel', /noopener/);
	await expect(panel.getByText('<b>not bold</b>')).toBeVisible();
	await expect(panel.locator('b')).toHaveCount(0);

	// Esc closes the panel and returns focus to the row.
	await page.keyboard.press('Escape');
	await expect(panel).toBeHidden();
	await expect(page).not.toHaveURL(/\?task=/);
	await expect(page.getByRole('button', { name: 'Oat milk' })).toBeFocused();

	await page.reload();
	await expect(page.getByRole('button', { name: 'Oat milk' })).toBeVisible();
	await page.getByRole('button', { name: 'Oat milk' }).click();
	await expect(panel.getByRole('link', { name: 'https://example.com/oat' })).toBeVisible();
	await panel.getByRole('button', { name: 'Close details' }).click();
	await expect(panel).toBeHidden();
});

test('complete and reopen a Task through the Completed section', async ({ page }) => {
	await addTask(page, 'Milk');
	await addTask(page, 'Eggs');
	const list = column(page, 'My Tasks');

	await saved(page, () => list.getByRole('checkbox', { name: 'Milk' }).click());

	await expect(openTitles(page, 'My Tasks')).toHaveText(['Eggs']);
	const summary = list.getByText('Completed (1)');
	await expect(summary).toBeVisible();
	const completed = list.getByRole('list', { name: 'Completed tasks' });
	// Collapsed by default.
	await expect(completed).toBeHidden();

	await page.reload();
	await summary.click();
	await expect(completed.getByRole('checkbox', { name: 'Milk' })).toBeChecked();

	await saved(page, () => completed.getByRole('checkbox', { name: 'Milk' }).click());
	await expect(list.getByText(/Completed \(/)).toBeHidden();
	await expect(openTitles(page, 'My Tasks')).toHaveText(['Eggs', 'Milk']);

	await page.reload();
	await expect(openTitles(page, 'My Tasks')).toHaveText(['Eggs', 'Milk']);
});

test('delete a Task', async ({ page }) => {
	await addTask(page, 'Milk');
	await addTask(page, 'Eggs');

	await page.getByRole('button', { name: 'Milk' }).click();
	await saved(page, () => detailPanel(page).getByRole('button', { name: 'Delete task' }).click());

	await expect(detailPanel(page)).toBeHidden();
	await expect(openTitles(page, 'My Tasks')).toHaveText(['Eggs']);
	await page.reload();
	await expect(openTitles(page, 'My Tasks')).toHaveText(['Eggs']);
});

test('delete all completed asks first and removes only Completed Tasks', async ({ page }) => {
	const list = column(page, 'My Tasks');
	for (const title of ['Milk', 'Eggs', 'Bread']) await addTask(page, title);
	await saved(page, () => list.getByRole('checkbox', { name: 'Milk' }).click());
	await saved(page, () => list.getByRole('checkbox', { name: 'Bread' }).click());
	await expect(list.getByText('Completed (2)')).toBeVisible();

	await listOption(page, 'My Tasks', 'Delete all completed');
	const dialog = page.getByRole('dialog', { name: 'Delete all completed tasks?' });
	await expect(dialog).toContainText('2 completed tasks');
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
	await expect(list.getByText('Completed (2)')).toBeVisible();

	await listOption(page, 'My Tasks', 'Delete all completed');
	await saved(page, () => dialog.getByRole('button', { name: 'Delete' }).click());

	await expect(list.getByText(/Completed \(/)).toBeHidden();
	await expect(openTitles(page, 'My Tasks')).toHaveText(['Eggs']);
	await page.reload();
	await expect(openTitles(page, 'My Tasks')).toHaveText(['Eggs']);
	await list.getByRole('button', { name: 'List options' }).click();
	await expect(list.getByRole('button', { name: 'Delete all completed' })).toBeDisabled();
});

test('the detail panel is a full-screen sheet at 360px', async ({ page }) => {
	await page.setViewportSize({ width: 360, height: 740 });
	await addTask(page, 'A task with a rather long title that has to wrap at this width');

	await page.getByRole('button', { name: /A task with a rather long title/ }).click();

	const box = await detailPanel(page).boundingBox();
	expect(box).toMatchObject({ x: 0, y: 0, width: 360, height: 740 });
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow).toBeLessThanOrEqual(0);
	await page.keyboard.press('Escape');
	await expect(detailPanel(page)).toBeHidden();
});
