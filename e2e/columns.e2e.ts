import { expect, test } from './fixtures';
import { loginAs } from './auth';
import { column, createList, saved, sidebar, switchToList } from './lists-tasks';

const listNames = (page: import('@playwright/test').Page) =>
	sidebar(page).locator('li[data-list-id] a');

test('desktop shows the visible Lists as columns; hiding persists', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await loginAs(page);
	await createList(page, 'Groceries');
	await page.goto('/');

	await expect(column(page, 'My Tasks')).toBeVisible();
	await expect(column(page, 'Groceries')).toBeVisible();
	const a = (await column(page, 'My Tasks').boundingBox())!;
	const b = (await column(page, 'Groceries').boundingBox())!;
	expect(b.x).toBeGreaterThan(a.x + a.width - 1);
	expect(Math.abs(a.y - b.y)).toBeLessThan(2);

	await saved(page, () =>
		sidebar(page).getByRole('checkbox', { name: 'Show Groceries' }).uncheck()
	);
	await expect(column(page, 'Groceries')).toBeHidden();
	await expect(column(page, 'My Tasks')).toBeVisible();

	await page.reload();
	await expect(column(page, 'Groceries')).toBeHidden();
	await expect(sidebar(page).getByRole('checkbox', { name: 'Show Groceries' })).not.toBeChecked();

	// Showing it again loads its Tasks.
	await saved(page, () => sidebar(page).getByRole('checkbox', { name: 'Show Groceries' }).check());
	await expect(column(page, 'Groceries')).toBeVisible();

	// The page itself never scrolls sideways.
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow).toBeLessThanOrEqual(0);
});

test('a link to a hidden List shows its column', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await loginAs(page);
	await createList(page, 'Groceries');
	await saved(page, () =>
		sidebar(page).getByRole('checkbox', { name: 'Show Groceries' }).uncheck()
	);
	await page.goto('/');
	await expect(column(page, 'Groceries')).toBeHidden();

	await sidebar(page).getByRole('link', { name: 'Groceries' }).click();
	await expect(column(page, 'Groceries')).toBeVisible();
	await expect(page.locator('[data-column]:focus')).toHaveCount(1);
});

test('reordering Lists with the keyboard changes the column order and persists', async ({
	page
}) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await loginAs(page);
	await createList(page, 'Groceries');
	await createList(page, 'Work');
	await page.goto('/');
	await expect(listNames(page)).toHaveText(['My Tasks', 'Groceries', 'Work']);

	const handle = sidebar(page).getByRole('button', { name: 'Reorder Work' });
	await handle.focus();
	await saved(page, () => page.keyboard.press('ArrowUp'));
	await saved(page, () => page.keyboard.press('ArrowUp'));
	await expect(handle).toBeFocused();
	await expect(listNames(page)).toHaveText(['Work', 'My Tasks', 'Groceries']);
	await expect(page.getByText('Work moved to position 1 of 3')).toBeAttached();

	const xs = async () => [
		(await column(page, 'Work').boundingBox())!.x,
		(await column(page, 'My Tasks').boundingBox())!.x,
		(await column(page, 'Groceries').boundingBox())!.x
	];
	let [work, mine, groceries] = await xs();
	expect(work).toBeLessThan(mine);
	expect(mine).toBeLessThan(groceries);

	await page.reload();
	await expect(listNames(page)).toHaveText(['Work', 'My Tasks', 'Groceries']);
	[work, mine, groceries] = await xs();
	expect(work).toBeLessThan(mine);
	expect(mine).toBeLessThan(groceries);

	// Alt+Arrow works on the entry's link too.
	const link = sidebar(page).getByRole('link', { name: 'Work' });
	await link.focus();
	await saved(page, () => page.keyboard.press('Alt+ArrowDown'));
	await expect(listNames(page)).toHaveText(['My Tasks', 'Work', 'Groceries']);
});

test('dragging a List in the sidebar reorders it', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await loginAs(page);
	await createList(page, 'Groceries');
	await page.goto('/');

	const handle = sidebar(page).getByRole('button', { name: 'Reorder Groceries' });
	const target = (await sidebar(page).getByRole('link', { name: 'My Tasks' }).boundingBox())!;
	const from = (await handle.boundingBox())!;
	await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
	await page.mouse.down();
	await page.mouse.move(from.x + 5, target.y + 2, { steps: 8 });
	await saved(page, () => page.mouse.up());
	await expect(listNames(page)).toHaveText(['Groceries', 'My Tasks']);
});

test('on a phone one List shows at a time and the menu changes it', async ({ page }) => {
	await loginAs(page);
	await createList(page, 'Groceries');
	await page.setViewportSize({ width: 360, height: 740 });
	await page.goto('/');

	// `/` shows the last-viewed List.
	await expect(column(page, 'Groceries')).toBeVisible();
	await expect(column(page, 'My Tasks')).toBeHidden();

	await switchToList(page, 'My Tasks');
	await expect(page).toHaveURL(/\/lists\//);
	await expect(column(page, 'My Tasks')).toBeVisible();
	await expect(column(page, 'Groceries')).toBeHidden();

	// ...and is remembered.
	await page.goto('/');
	await expect(column(page, 'My Tasks')).toBeVisible();
	await expect(column(page, 'Groceries')).toBeHidden();

	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow).toBeLessThanOrEqual(0);
});
