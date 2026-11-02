import { type Locator, type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import type { SerializedTask, TaskChanges } from '../src/lib/domain/tasks';
import { loginAs } from './auth';
import { appOrigin } from './env';
import {
	addTask,
	column,
	createList,
	detailPanel,
	openTitles,
	saved,
	subtaskTitles
} from './lists-tasks';

const LIST = 'My Tasks';

test.use({ timezoneId: 'Europe/Berlin', locale: 'en-GB' });

test.beforeEach(async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await loginAs(page);
});

const notifications = (page: Page): Locator => page.getByRole('status', { name: 'Notifications' });

const toast = (page: Page): Locator =>
	notifications(page).getByRole('group', { name: 'Notification' });

const undoButton = (page: Page): Locator => toast(page).getByRole('button', { name: 'Undo' });

const row = (page: Page, title: string, list = LIST): Locator =>
	column(page, list).locator('li[data-task-id]', {
		has: page.getByRole('button', { name: title, exact: true })
	});

const checkbox = (page: Page, title: string, list = LIST): Locator =>
	column(page, list)
		.getByRole('list', { name: 'Open tasks' })
		.getByRole('checkbox', { name: title, exact: true });

/** Adds a Task through the UI and returns it as the server created it. */
async function addTaskAndGet(page: Page, title: string): Promise<SerializedTask> {
	const created = page.waitForResponse(
		(r) => new URL(r.url()).pathname === '/api/tasks' && r.request().method() === 'POST'
	);
	await addTask(page, title);
	return ((await (await created).json()) as TaskChanges).upserted[0];
}

/** Creates a Task through the API (for fields the test doesn't need to drive through the UI). */
async function createThroughApi(page: Page, data: object): Promise<SerializedTask> {
	const response = await page.request.post('/api/tasks', {
		data: { id: crypto.randomUUID(), ...data }
	});
	expect(response.status()).toBe(201);
	return ((await response.json()) as TaskChanges).upserted[0];
}

/** Bread, Party (Subtasks Cake, Candles, Balloons; Balloons Completed by the User), Milk. */
async function partyBetweenBreadAndMilk(page: Page): Promise<SerializedTask> {
	const milk = await addTaskAndGet(page, 'Milk');
	const party = await addTaskAndGet(page, 'Party');
	await addTask(page, 'Bread');
	for (const title of ['Cake', 'Candles', 'Balloons']) {
		const subtask = await createThroughApi(page, {
			listId: milk.listId,
			parentId: party.id,
			title
		});
		if (title === 'Balloons') {
			await page.request.post(`/api/tasks/${subtask.id}/complete`, { data: {} });
		}
	}
	await page.reload();
	await expect(openTitles(page, LIST)).toHaveText(['Bread', 'Party', 'Milk']);
	await expect(subtaskTitles(page, LIST, 'Party')).toHaveText(['Cake', 'Candles']);
	return party;
}

test('complete, then Undo: the Task is back in its place with the Subtasks the completion closed', async ({
	page
}) => {
	await partyBetweenBreadAndMilk(page);

	await saved(page, () => checkbox(page, 'Party').click());
	await expect(openTitles(page, LIST)).toHaveText(['Bread', 'Milk']);
	await expect(toast(page)).toContainText('Task completed');

	await saved(page, () => undoButton(page).click());
	await expect(toast(page)).toHaveCount(0);
	await expect(openTitles(page, LIST)).toHaveText(['Bread', 'Party', 'Milk']);
	await expect(subtaskTitles(page, LIST, 'Party')).toHaveText(['Cake', 'Candles']);

	// The server agrees; Balloons, which the User completed, stays Completed.
	await page.reload();
	await expect(openTitles(page, LIST)).toHaveText(['Bread', 'Party', 'Milk']);
	await expect(subtaskTitles(page, LIST, 'Party')).toHaveText(['Cake', 'Candles']);
	await expect(column(page, LIST).getByText('Completed (1)')).toBeVisible();
});

test('"Mark completed" in the detail panel offers Undo too', async ({ page }) => {
	await addTask(page, 'Milk');
	await column(page, LIST).getByRole('button', { name: 'Milk', exact: true }).click();
	await saved(page, () =>
		detailPanel(page).getByRole('button', { name: 'Mark completed' }).click()
	);
	await expect(toast(page)).toContainText('Task completed');

	await saved(page, () => undoButton(page).click());
	await expect(detailPanel(page).getByRole('button', { name: 'Mark completed' })).toBeVisible();
	await expect(openTitles(page, LIST)).toHaveText(['Milk']);
});

test('delete a Task with Subtasks, then Undo: all of them come back with their dates and Priority', async ({
	page
}) => {
	const party = await partyBetweenBreadAndMilk(page);
	const patched = await page.request.patch(`/api/tasks/${party.id}`, {
		data: {
			priority: 'high',
			planned: { kind: 'date', date: '2027-03-10' },
			due: { kind: 'timed', dateTime: '2027-03-12T17:30', timeZone: 'Europe/Berlin' }
		}
	});
	expect(patched.ok()).toBe(true);
	await page.reload();
	await expect(row(page, 'Party')).toContainText('Due 12 Mar 2027 17:30');

	await column(page, LIST).getByRole('button', { name: 'Party', exact: true }).click();
	const deletion = page.waitForResponse((r) => r.request().method() === 'DELETE');
	await detailPanel(page).getByRole('button', { name: 'Delete task' }).click();
	const removed = ((await (await deletion).json()) as { removed: SerializedTask[] }).removed;
	expect(removed.map((task) => task.title)).toEqual(['Party', 'Cake', 'Candles', 'Balloons']);
	await expect(toast(page)).toContainText('Task deleted');
	await expect(openTitles(page, LIST)).toHaveText(['Bread', 'Milk']);

	const restore = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/tasks/restore');
	await undoButton(page).click();
	const restored = (await (await restore).json()) as TaskChanges;
	const byId = (tasks: SerializedTask[]) => [...tasks].sort((a, b) => a.id.localeCompare(b.id));
	expect(byId(restored.upserted)).toEqual(byId(removed));

	await expect(openTitles(page, LIST)).toHaveText(['Bread', 'Party', 'Milk']);
	await expect(subtaskTitles(page, LIST, 'Party')).toHaveText(['Cake', 'Candles']);
	await page.reload();
	await expect(openTitles(page, LIST)).toHaveText(['Bread', 'Party', 'Milk']);
	await expect(subtaskTitles(page, LIST, 'Party')).toHaveText(['Cake', 'Candles']);
	await expect(row(page, 'Party')).toContainText('10 Mar 2027');
	await expect(row(page, 'Party')).toContainText('Due 12 Mar 2027 17:30');
	await expect(row(page, 'Party').getByRole('button', { name: /Priority: High/ })).toBeVisible();
	await expect(column(page, LIST).getByText('Completed (1)')).toBeVisible();
});

test('move to another List, then Undo: the Task goes back to its place', async ({ page }) => {
	await addTask(page, 'Milk');
	await addTask(page, 'Eggs');
	await addTask(page, 'Bread');
	await createList(page, 'Work');
	await expect(openTitles(page, LIST)).toHaveText(['Bread', 'Eggs', 'Milk']);

	await column(page, LIST).getByRole('button', { name: 'Eggs', exact: true }).click();
	await saved(page, () =>
		detailPanel(page).getByRole('combobox', { name: 'List' }).selectOption({ label: 'Work' })
	);
	await expect(toast(page)).toContainText('Moved to Work');
	await expect(openTitles(page, 'Work')).toHaveText(['Eggs']);
	await expect(openTitles(page, LIST)).toHaveText(['Bread', 'Milk']);

	await saved(page, () => undoButton(page).click());
	await expect(openTitles(page, LIST)).toHaveText(['Bread', 'Eggs', 'Milk']);
	await expect(openTitles(page, 'Work')).toHaveCount(0);

	await page.reload();
	await expect(openTitles(page, LIST)).toHaveText(['Bread', 'Eggs', 'Milk']);
	await expect(column(page, 'Work').getByText('No tasks yet')).toBeVisible();
});

test('Ctrl+Z undoes the latest action, but not while typing; Undo is reachable by keyboard', async ({
	page
}) => {
	await addTask(page, 'Milk');
	await addTask(page, 'Eggs');

	await saved(page, () => checkbox(page, 'Milk').click());
	await saved(page, () => checkbox(page, 'Eggs').click());
	// One Undo at a time: the newer action replaced the older one.
	await expect(toast(page)).toHaveCount(1);
	await expect(toast(page)).toContainText('Task completed');

	// In a text field, Ctrl+Z is the field's own undo.
	const input = column(page, LIST).getByRole('textbox', { name: 'Add a task' });
	await input.focus();
	await page.keyboard.press('Control+z');
	await expect(openTitles(page, LIST)).toHaveCount(0);

	await input.blur();
	await saved(page, () => page.keyboard.press('Control+z'));
	await expect(openTitles(page, LIST)).toHaveText(['Eggs']);
	await expect(toast(page)).toHaveCount(0);

	// Nothing left to undo.
	await page.keyboard.press('Control+z');
	await expect(openTitles(page, LIST)).toHaveText(['Eggs']);

	// Tab to the Undo button and press it.
	await saved(page, () => checkbox(page, 'Eggs').click());
	await undoButton(page).focus();
	await expect(undoButton(page)).toBeFocused();
	await saved(page, () => page.keyboard.press('Enter'));
	await expect(openTitles(page, LIST)).toHaveText(['Eggs']);
});

test('the toast goes away on its own, but not while hovered', async ({ page }) => {
	await page.clock.install();
	await page.reload();
	await addTask(page, 'Milk');
	await addTask(page, 'Eggs');

	await saved(page, () => checkbox(page, 'Milk').click());
	await expect(toast(page)).toBeVisible();
	await page.clock.runFor(6500);
	await expect(toast(page)).toHaveCount(0);

	await saved(page, () => checkbox(page, 'Eggs').click());
	await toast(page).hover();
	await page.clock.runFor(20_000);
	await expect(toast(page)).toBeVisible();
	await page.mouse.move(0, 0);
	await page.clock.runFor(6500);
	await expect(toast(page)).toHaveCount(0);
});

test('a failed restore is reported, e.g. when the List was deleted meanwhile', async ({ page }) => {
	await createList(page, 'Errands');
	const stamps = await addTaskAndGet(page, 'Stamps');
	await column(page, 'Errands').getByRole('button', { name: 'Stamps', exact: true }).click();
	await saved(page, () => detailPanel(page).getByRole('button', { name: 'Delete task' }).click());
	// As if from another tab: same origin (a bare DELETE needs it for the CSRF check).
	const gone = await page.request.delete(`/api/lists/${stamps.listId}`, {
		headers: { origin: appOrigin }
	});
	expect(gone.status()).toBe(204);

	await undoButton(page).click();
	await expect(notifications(page)).toContainText("Couldn't restore the task. List not found.");
});
