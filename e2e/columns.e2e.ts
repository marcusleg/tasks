import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { loginAs } from './auth';
import { addTask, column, createList, saved, sidebar, switchToList } from './lists-tasks';

const listNames = (page: Page) => sidebar(page).locator('li[data-list-id] a');

const PHONE = { width: 360, height: 740 };

const noSidewaysScroll = async (page: Page) =>
	expect(
		await page.evaluate(
			() => document.documentElement.scrollWidth - document.documentElement.clientWidth
		)
	).toBeLessThanOrEqual(0);

/** Hides a List with its eye in the sidebar (wide screens). */
const hide = (page: Page, name: string) =>
	saved(page, () =>
		sidebar(page)
			.getByRole('checkbox', { name: `Show ${name}` })
			.uncheck()
	);

/** Asserts the List's heading is in view and clear of the sticky header. */
async function expectScrolledTo(page: Page, name: string): Promise<void> {
	const heading = column(page, name).getByRole('heading', { name, level: 2 });
	await expect(heading).toBeInViewport();
	const header = (await page.locator('header').first().boundingBox())!;
	expect((await heading.boundingBox())!.y).toBeGreaterThanOrEqual(header.y + header.height);
}

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

	await hide(page, 'Groceries');
	await expect(column(page, 'Groceries')).toBeHidden();
	await expect(column(page, 'My Tasks')).toBeVisible();
	// There's no column to jump to.
	await expect(sidebar(page).getByRole('link', { name: 'Groceries' })).toHaveCount(0);

	await page.reload();
	await expect(column(page, 'Groceries')).toBeHidden();
	await expect(sidebar(page).getByRole('checkbox', { name: 'Show Groceries' })).not.toBeChecked();

	// Showing it again loads its Tasks.
	await saved(page, () => sidebar(page).getByRole('checkbox', { name: 'Show Groceries' }).check());
	await expect(column(page, 'Groceries')).toBeVisible();

	// The page itself never scrolls sideways.
	await noSidewaysScroll(page);
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

test('on a phone the visible Lists are stacked in List order', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await loginAs(page);
	await createList(page, 'Groceries');
	await createList(page, 'Work');
	await hide(page, 'Work');
	await page.setViewportSize(PHONE);
	await page.goto('/');

	await expect(page).toHaveTitle('Tasks');
	await expect(column(page, 'My Tasks')).toBeVisible();
	await expect(column(page, 'Groceries')).toBeVisible();
	await expect(column(page, 'Work')).toHaveCount(0);
	const a = (await column(page, 'My Tasks').boundingBox())!;
	const b = (await column(page, 'Groceries').boundingBox())!;
	expect(b.y).toBeGreaterThan(a.y + a.height - 1);
	expect(Math.abs(a.x - b.x)).toBeLessThan(2);
	expect(await page.evaluate(() => window.scrollY)).toBe(0);
	await noSidewaysScroll(page);
});

test('on a phone the menu scrolls to the List picked', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await loginAs(page);
	for (let i = 1; i <= 12; i++) await addTask(page, `Task ${i}`);
	await createList(page, 'Groceries');
	await page.setViewportSize(PHONE);
	await page.goto('/');
	await expect(column(page, 'Groceries')).not.toBeInViewport();

	await switchToList(page, 'Groceries');
	await expect(page).toHaveTitle('Tasks');
	await expect(page.getByRole('button', { name: 'Menu', exact: true })).toHaveAttribute(
		'aria-expanded',
		'false'
	);
	await expectScrolledTo(page, 'Groceries');
	await noSidewaysScroll(page);

	// Picking it again with the keyboard brings it back and moves the keyboard into it.
	await page.evaluate(() => window.scrollTo(0, 0));
	await page.getByRole('button', { name: 'Menu', exact: true }).click();
	await sidebar(page).getByRole('link', { name: 'Groceries', exact: true }).press('Enter');
	await expectScrolledTo(page, 'Groceries');
	await expect(
		page.locator('[data-column]:focus').getByRole('heading', { name: 'Groceries' })
	).toBeVisible();
});

test('when every List is hidden, the page says so', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await loginAs(page);
	await hide(page, 'My Tasks');
	await page.goto('/');

	const message = page.getByText('All your lists are hidden.');
	await expect(message).toBeVisible();
	await expect(column(page, 'My Tasks')).toHaveCount(0);

	await saved(page, () => sidebar(page).getByRole('checkbox', { name: 'Show My Tasks' }).check());
	await expect(column(page, 'My Tasks')).toBeVisible();
	await expect(message).toBeHidden();
});
