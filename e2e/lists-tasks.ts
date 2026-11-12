import { expect, type Locator, type Page } from '@playwright/test';
import { waitForHydration } from './hydration';

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

/** On a phone: picks the List with this name in the menu. */
export async function switchToList(page: Page, name: string): Promise<void> {
	await page.getByRole('button', { name: 'Menu', exact: true }).click();
	await sidebar(page).getByRole('link', { name, exact: true }).click();
	// Visible Lists are on the page already; wait until this one is the one it links to.
	await expectFocused(page, name);
}

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
	// The page navigates to the new List once it is saved. Until the List is the focused one,
	// "Add a task" still belongs to the previous List.
	await expectFocused(page, name);
}

/**
 * The List the page is about: the one a `/lists/[id]` page links to, or the first column on `/`
 * (which links to none).
 */
export const currentColumn = (page: Page): Locator =>
	new URL(page.url()).pathname.startsWith('/lists/')
		? page.locator('[data-column][data-focused]')
		: page.locator('[data-column]').first();

/** Waits until the List with this name is the one the page is about (the focused column). */
export async function expectFocused(page: Page, name: string): Promise<void> {
	await expect(
		page.locator('[data-column][data-focused]').getByRole('heading', { name, level: 2 })
	).toBeVisible();
}

export async function addTask(page: Page, title: string): Promise<void> {
	await waitForHydration(page);
	await saved(page, async () => {
		await currentColumn(page).getByRole('textbox', { name: 'Add a task' }).fill(title);
		await page.keyboard.press('Enter');
	});
}

export async function listOption(page: Page, list: string, option: string): Promise<void> {
	await column(page, list).getByRole('button', { name: 'List options' }).click();
	await column(page, list).getByRole('button', { name: option }).click();
}

/** Titles of the open top-level Tasks of a List, top to bottom (Subtasks not included). */
export const openTitles = (page: Page, list: string): Locator =>
	column(page, list)
		.getByRole('list', { name: 'Open tasks' })
		.locator(':scope > li > .body > .open');

/** Titles of the open Subtasks shown under a parent in a List, top to bottom. */
export const subtaskTitles = (page: Page, list: string, parent: string): Locator =>
	column(page, list)
		.getByRole('list', { name: `Subtasks of ${parent}`, exact: true })
		.locator(':scope > li > .body > .open');

/** Adds a Subtask through the open detail panel's "Add subtask" field. */
export async function addSubtask(page: Page, title: string): Promise<void> {
	await saved(page, async () => {
		await detailPanel(page).getByRole('textbox', { name: 'Add subtask' }).fill(title);
		await page.keyboard.press('Enter');
	});
}
