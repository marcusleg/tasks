import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Helpers for driving Lists and Tasks. Mutations are optimistic, so anything that reloads
 * afterwards should wait for the request with {@link saved}.
 */

/** Runs `action` and waits until the API request it triggers has succeeded. */
export async function saved(page: Page, action: () => Promise<unknown>): Promise<void> {
	const response = page.waitForResponse(
		(r) => new URL(r.url()).pathname.startsWith('/api/') && r.request().method() !== 'GET'
	);
	await action();
	expect((await response).ok()).toBe(true);
}

export const sidebar = (page: Page): Locator => page.getByRole('navigation', { name: 'Main' });

/** The column of the List with this name. */
export const column = (page: Page, name: string): Locator =>
	page.getByRole('region', { name, exact: true });

export const detailPanel = (page: Page): Locator =>
	page.getByRole('complementary', { name: 'Task details' });

export async function createList(page: Page, name: string): Promise<void> {
	await sidebar(page).getByRole('button', { name: 'New list' }).click();
	await saved(page, async () => {
		await sidebar(page).getByRole('textbox', { name: 'New list name' }).fill(name);
		await page.keyboard.press('Enter');
	});
	await expect(page.getByRole('heading', { name, level: 2 })).toBeVisible();
}

export async function addTask(page: Page, title: string): Promise<void> {
	await saved(page, async () => {
		// The focused List is the one the page is about (the others sit beside it as columns).
		await page
			.locator('[data-column][data-focused]')
			.getByRole('textbox', { name: 'Add a task' })
			.fill(title);
		await page.keyboard.press('Enter');
	});
}

export async function listOption(page: Page, list: string, option: string): Promise<void> {
	await column(page, list).getByRole('button', { name: 'List options' }).click();
	await column(page, list).getByRole('button', { name: option }).click();
}

/** Titles of the open Tasks of a List, top to bottom. */
export const openTitles = (page: Page, list: string): Locator =>
	column(page, list).getByRole('list', { name: 'Open tasks' }).getByRole('button');
