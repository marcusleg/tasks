import { expect, test, type Page } from '@playwright/test';
import { loginAs } from './auth';
import {
	addSubtask,
	addTask,
	column,
	detailPanel,
	openTitles,
	saved,
	subtaskTitles
} from './lists-tasks';

test.beforeEach(async ({ page }) => {
	await loginAs(page);
});

const LIST = 'My Tasks';

const partyButton = (page: Page) =>
	column(page, LIST).getByRole('button', { name: 'Party', exact: true });

/** A parent "Party" with the Subtasks "Cake", "Candles", "Balloons", and a Task "Milk". */
async function party(page: Page): Promise<void> {
	await addTask(page, 'Milk');
	await addTask(page, 'Party');
	await partyButton(page).click();
	for (const title of ['Cake', 'Candles', 'Balloons']) await addSubtask(page, title);
	await page.keyboard.press('Escape');
	await expect(detailPanel(page)).toBeHidden();
}

test('add Subtasks in the detail panel: they show indented under their parent, in order', async ({
	page
}) => {
	await addTask(page, 'Party');
	await partyButton(page).click();
	const panel = detailPanel(page);
	const input = panel.getByRole('textbox', { name: 'Add subtask' });

	await addSubtask(page, 'Cake');
	await expect(input).toBeFocused();
	await expect(input).toHaveValue('');
	await addSubtask(page, 'Candles');

	// New Subtasks go to the bottom, like a checklist.
	const inPanel = panel.getByRole('list', { name: 'Subtasks' }).getByRole('button');
	await expect(inPanel).toHaveText(['Cake', 'Candles']);
	await expect(subtaskTitles(page, LIST, 'Party')).toHaveText(['Cake', 'Candles']);
	await expect(openTitles(page, LIST)).toHaveText(['Party']);

	// A Subtask's detail links back to its parent, and has no Subtasks of its own.
	await inPanel.filter({ hasText: 'Candles' }).click();
	await expect(panel.getByRole('textbox', { name: 'Title' })).toHaveValue('Candles');
	await expect(panel.getByRole('textbox', { name: 'Add subtask' })).toBeHidden();
	await panel.getByRole('navigation', { name: 'Parent task' }).getByRole('button').click();
	await expect(panel.getByRole('textbox', { name: 'Title' })).toHaveValue('Party');

	await page.reload();
	await expect(subtaskTitles(page, LIST, 'Party')).toHaveText(['Cake', 'Candles']);
});

test('collapse and expand a parent’s Subtasks with the keyboard; the browser remembers', async ({
	page
}) => {
	await party(page);
	const toggle = column(page, LIST).getByRole('button', { name: 'Subtasks of Party' });
	await expect(toggle).toHaveAttribute('aria-expanded', 'true');

	await toggle.focus();
	await page.keyboard.press('Enter');
	await expect(toggle).toHaveAttribute('aria-expanded', 'false');
	await expect(subtaskTitles(page, LIST, 'Party')).toHaveCount(0);

	await page.reload();
	await expect(toggle).toHaveAttribute('aria-expanded', 'false');
	await expect(subtaskTitles(page, LIST, 'Party').first()).toBeHidden();

	await toggle.focus();
	await page.keyboard.press('Space');
	await expect(subtaskTitles(page, LIST, 'Party')).toHaveText(['Cake', 'Candles', 'Balloons']);
});

test('completing the parent completes its Subtasks; Reopen restores only those it closed', async ({
	page
}) => {
	await party(page);
	const list = column(page, LIST);
	const completed = list.getByRole('list', { name: 'Completed tasks' });

	// The User completes "Cake" themselves: it moves to Completed, under its parent's name.
	await saved(page, () => list.getByRole('checkbox', { name: 'Cake' }).click());
	await expect(subtaskTitles(page, LIST, 'Party')).toHaveText(['Candles', 'Balloons']);
	await list.getByText('Completed (1)').click();
	await expect(
		completed.getByRole('list', { name: 'Party', exact: true }).getByRole('checkbox')
	).toHaveCount(1);
	await expect(
		completed
			.getByRole('list', { name: 'Party', exact: true })
			.getByRole('checkbox', { name: 'Cake' })
	).toBeChecked();

	// Completing the parent closes the open Subtasks too.
	await saved(page, () => list.getByRole('checkbox', { name: 'Party' }).click());
	await expect(openTitles(page, LIST)).toHaveText(['Milk']);
	await expect(list.getByText('Completed (4)')).toBeVisible();
	const subtasksOfParty = completed.getByRole('list', { name: 'Subtasks of Party' });
	for (const title of ['Cake', 'Candles', 'Balloons']) {
		await expect(subtasksOfParty.getByRole('checkbox', { name: title })).toBeChecked();
	}

	// Reopening the parent brings back exactly the Subtasks its completion closed.
	await page.reload();
	await list.getByText('Completed (4)').click();
	await saved(page, () => completed.getByRole('checkbox', { name: 'Party' }).click());
	await expect(openTitles(page, LIST)).toHaveText(['Party', 'Milk']);
	await expect(subtaskTitles(page, LIST, 'Party')).toHaveText(['Candles', 'Balloons']);
	await expect(completed.getByRole('checkbox', { name: 'Cake' })).toBeChecked();

	await page.reload();
	await expect(subtaskTitles(page, LIST, 'Party')).toHaveText(['Candles', 'Balloons']);
	await expect(list.getByText('Completed (1)')).toBeVisible();
});

test('reopening a Subtask of a Completed parent reopens the parent too', async ({ page }) => {
	await party(page);
	const list = column(page, LIST);
	await saved(page, () => list.getByRole('checkbox', { name: 'Party' }).click());
	await list.getByText('Completed (4)').click();

	await saved(page, () =>
		list
			.getByRole('list', { name: 'Completed tasks' })
			.getByRole('checkbox', { name: 'Cake' })
			.click()
	);

	await expect(openTitles(page, LIST)).toHaveText(['Party', 'Milk']);
	await expect(subtaskTitles(page, LIST, 'Party')).toHaveText(['Cake']);
	await page.reload();
	await expect(subtaskTitles(page, LIST, 'Party')).toHaveText(['Cake']);
	await expect(list.getByText('Completed (2)')).toBeVisible();
});

test('deleting the parent removes its Subtasks', async ({ page }) => {
	await party(page);

	await partyButton(page).click();
	await saved(page, () => detailPanel(page).getByRole('button', { name: 'Delete task' }).click());

	await expect(openTitles(page, LIST)).toHaveText(['Milk']);
	await expect(column(page, LIST).getByRole('button', { name: 'Cake' })).toHaveCount(0);
	await page.reload();
	await expect(openTitles(page, LIST)).toHaveText(['Milk']);
	await expect(column(page, LIST).getByRole('button', { name: 'Cake' })).toHaveCount(0);
});

test('the server refuses Subtasks of a Subtask with 400', async ({ page }) => {
	await addTask(page, 'Party');
	await partyButton(page).click();
	const created = page.waitForResponse(
		(r) => new URL(r.url()).pathname === '/api/tasks' && r.request().method() === 'POST'
	);
	await addSubtask(page, 'Cake');
	const cake = (await (await created).json()).upserted[0];

	const response = await page.request.post('/api/tasks', {
		data: { listId: cake.listId, title: 'Sprinkles', parentId: cake.id }
	});

	expect(response.status()).toBe(400);
	expect((await response.json()).message).toMatch(/Subtask can’t have Subtasks/);
});

test('Subtasks fit at 360px', async ({ page }) => {
	await page.setViewportSize({ width: 360, height: 740 });
	await addTask(page, 'A parent task with a long title that has to wrap at this width');
	await page.getByRole('button', { name: /A parent task/ }).click();
	await addSubtask(page, 'A subtask with a long title that also has to wrap at this width');
	await page.keyboard.press('Escape');
	await expect(detailPanel(page)).toBeHidden();

	await expect(page.getByRole('button', { name: /A subtask with/ })).toBeVisible();
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow).toBeLessThanOrEqual(0);
});
