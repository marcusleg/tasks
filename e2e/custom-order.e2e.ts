import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginAs } from './auth';
import {
	addSubtask,
	addTask,
	column,
	createList,
	detailPanel,
	openTitles,
	saved,
	subtaskTitles
} from './lists-tasks';

const LIST = 'My Tasks';

test.beforeEach(async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await loginAs(page);
});

/** The drag handle of a Task's row ("Move task", described by the Task's Title). */
const handle = (page: Page, title: string, list = LIST): Locator =>
	column(page, list)
		.locator('li[data-task-id]')
		.filter({ has: page.getByRole('button', { name: title, exact: true }) })
		.getByRole('button', { name: 'Move task' });

/** Adds Tasks so that they show top to bottom in the given order (new Tasks go to the top). */
async function addTasks(page: Page, ...titles: string[]): Promise<void> {
	for (const title of [...titles].reverse()) await addTask(page, title);
}

/** Adds Subtasks to a Task through its detail panel. */
async function addSubtasks(page: Page, parent: string, ...titles: string[]): Promise<void> {
	await column(page, LIST).getByRole('button', { name: parent, exact: true }).click();
	for (const title of titles) await addSubtask(page, title);
	await page.keyboard.press('Escape');
	await expect(detailPanel(page)).toBeHidden();
}

/** Drags with the mouse from a Task's handle to a point, in small steps. */
async function drag(
	page: Page,
	from: Locator,
	to: { x: number; y: number },
	release: () => Promise<void> = () => page.mouse.up()
): Promise<void> {
	await from.hover();
	const box = (await from.boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(to.x, to.y, { steps: 12 });
	await release();
}

test('reorder with the keyboard on the drag handle; the order survives a reload', async ({
	page
}) => {
	await addTasks(page, 'Bread', 'Eggs', 'Milk');
	await expect(openTitles(page, LIST)).toHaveText(['Bread', 'Eggs', 'Milk']);

	const milk = handle(page, 'Milk');
	await milk.focus();
	await expect(milk).toBeVisible();
	await saved(page, () => page.keyboard.press('ArrowUp'));
	await saved(page, () => page.keyboard.press('ArrowUp'));
	await expect(openTitles(page, LIST)).toHaveText(['Milk', 'Bread', 'Eggs']);
	await expect(milk).toBeFocused();
	await expect(page.getByText('Milk moved to position 1 of 3 in My Tasks')).toBeAttached();

	// Nowhere further to go: nothing is sent, and that is announced.
	await page.keyboard.press('ArrowUp');
	await expect(page.getByText('Milk is already at the top')).toBeAttached();

	await page.reload();
	await expect(openTitles(page, LIST)).toHaveText(['Milk', 'Bread', 'Eggs']);

	await handle(page, 'Bread').focus();
	await saved(page, () => page.keyboard.press('ArrowDown'));
	await expect(openTitles(page, LIST)).toHaveText(['Milk', 'Eggs', 'Bread']);
});

test('nest and un-nest with the keyboard', async ({ page }) => {
	await addTasks(page, 'Party', 'Milk', 'Eggs');

	await handle(page, 'Milk').focus();
	await saved(page, () => page.keyboard.press('ArrowRight'));
	await expect(subtaskTitles(page, LIST, 'Party')).toHaveText(['Milk']);
	await expect(openTitles(page, LIST)).toHaveText(['Party', 'Eggs']);
	await expect(handle(page, 'Milk')).toBeFocused();
	await expect(page.getByText('Milk is now subtask 1 of 1 under Party')).toBeAttached();

	// Eggs goes under Party too, below Milk.
	await handle(page, 'Eggs').focus();
	await saved(page, () => page.keyboard.press('ArrowRight'));
	await expect(subtaskTitles(page, LIST, 'Party')).toHaveText(['Milk', 'Eggs']);

	// A Task with Subtasks can't become a Subtask itself.
	await page.reload();
	await expect(subtaskTitles(page, LIST, 'Party')).toHaveText(['Milk', 'Eggs']);
	await addTask(page, 'Top');
	await handle(page, 'Party').focus();
	await page.keyboard.press('ArrowRight');
	await expect(page.getByText(/Can’t move Party: a Task with Subtasks/)).toBeAttached();
	await expect(openTitles(page, LIST)).toHaveText(['Top', 'Party']);

	// Out again: right after its parent.
	await handle(page, 'Milk').focus();
	await saved(page, () => page.keyboard.press('ArrowLeft'));
	await expect(openTitles(page, LIST)).toHaveText(['Top', 'Party', 'Milk']);
	await expect(subtaskTitles(page, LIST, 'Party')).toHaveText(['Eggs']);

	await page.reload();
	await expect(openTitles(page, LIST)).toHaveText(['Top', 'Party', 'Milk']);
	await expect(subtaskTitles(page, LIST, 'Party')).toHaveText(['Eggs']);
});

test('drag with the mouse to reorder, nest and un-nest', async ({ page }) => {
	await addTasks(page, 'Bread', 'Eggs', 'Milk');

	// Milk to the top.
	const bread = (await column(page, LIST).getByRole('button', { name: 'Bread' }).boundingBox())!;
	await saved(page, () =>
		drag(page, handle(page, 'Milk'), { x: bread.x, y: bread.y + 2 }, () => page.mouse.up())
	);
	await expect(openTitles(page, LIST)).toHaveText(['Milk', 'Bread', 'Eggs']);

	// Eggs right under Bread and to the right: it becomes Bread's Subtask.
	const breadRow = (await page.locator('li[data-task-id]', { hasText: 'Bread' }).boundingBox())!;
	await saved(page, () =>
		drag(page, handle(page, 'Eggs'), {
			x: breadRow.x + 60,
			y: breadRow.y + breadRow.height - 4
		})
	);
	await expect(subtaskTitles(page, LIST, 'Bread')).toHaveText(['Eggs']);
	await expect(openTitles(page, LIST)).toHaveText(['Milk', 'Bread']);

	// And back out to the left, below Bread.
	const eggsRow = (await page.locator('li[data-task-id]', { hasText: 'Eggs' }).boundingBox())!;
	await saved(page, () =>
		drag(page, handle(page, 'Eggs'), { x: eggsRow.x - 40, y: eggsRow.y + eggsRow.height - 4 })
	);
	await expect(openTitles(page, LIST)).toHaveText(['Milk', 'Bread', 'Eggs']);

	await page.reload();
	await expect(openTitles(page, LIST)).toHaveText(['Milk', 'Bread', 'Eggs']);
});

test('an invalid drop shows a "not allowed" cue and changes nothing; Esc cancels', async ({
	page
}) => {
	await addTasks(page, 'Party', 'Milk');
	await addSubtasks(page, 'Party', 'Cake');
	let moves = 0;
	page.on('request', (request) => {
		if (request.url().endsWith('/move')) moves++;
	});

	// Party has a Subtask, so it can't go under Milk.
	const milkRow = (await page.locator('li[data-task-id]', { hasText: 'Milk' }).boundingBox())!;
	await drag(
		page,
		handle(page, 'Party'),
		{ x: milkRow.x + 80, y: milkRow.y + milkRow.height + 4 },
		async () => {
			await expect(page.getByText(/Not allowed: a Task with Subtasks/)).toBeVisible();
			await page.mouse.up();
		}
	);
	await expect(page.getByText(/Not allowed/)).toBeHidden();
	await expect(openTitles(page, LIST)).toHaveText(['Party', 'Milk']);

	// Esc cancels a drag, even over a valid place (above Party).
	const partyRow = (await page.locator('li[data-task-id]', { hasText: 'Party' }).boundingBox())!;
	await drag(page, handle(page, 'Milk'), { x: partyRow.x, y: partyRow.y + 2 }, async () => {
		await expect(page.locator('.drop-indicator')).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(page.locator('.drop-indicator')).toBeHidden();
		await page.mouse.up();
	});
	await expect(openTitles(page, LIST)).toHaveText(['Party', 'Milk']);
	expect(moves).toBe(0);
});

test('drag a Task to another List’s column: its Subtasks come along', async ({ page }) => {
	await addTasks(page, 'Party', 'Milk');
	await addSubtasks(page, 'Party', 'Cake', 'Candles');
	await createList(page, 'Work');
	await page.goto('/');
	await expect(column(page, 'Work')).toBeVisible();

	const target = (await column(page, 'Work').getByText('No tasks yet').boundingBox())!;
	await saved(page, () =>
		drag(page, handle(page, 'Party'), { x: target.x + 20, y: target.y + target.height / 2 })
	);

	await expect(openTitles(page, 'Work')).toHaveText(['Party']);
	await expect(subtaskTitles(page, 'Work', 'Party')).toHaveText(['Cake', 'Candles']);
	await expect(openTitles(page, LIST)).toHaveText(['Milk']);

	await page.reload();
	await expect(openTitles(page, 'Work')).toHaveText(['Party']);
	await expect(subtaskTitles(page, 'Work', 'Party')).toHaveText(['Cake', 'Candles']);
	await expect(openTitles(page, LIST)).toHaveText(['Milk']);
});

test('"Move to List" in the detail panel works on a phone', async ({ page }) => {
	await createList(page, 'Work');
	await page.setViewportSize({ width: 360, height: 740 });
	await page.getByRole('combobox', { name: 'List' }).selectOption({ label: LIST });
	await expect(column(page, LIST)).toBeVisible();
	await addTasks(page, 'Party');
	await addSubtasks(page, 'Party', 'Cake');

	await column(page, LIST).getByRole('button', { name: 'Party', exact: true }).click();
	const select = detailPanel(page).getByRole('combobox', { name: 'List' });
	await expect(select).toHaveValue(/.+/);
	const overflow = await page.evaluate(
		() => document.documentElement.scrollWidth - document.documentElement.clientWidth
	);
	expect(overflow).toBeLessThanOrEqual(0);
	await saved(page, () => select.selectOption({ label: 'Work' }));
	await page.keyboard.press('Escape');
	await expect(detailPanel(page)).toBeHidden();
	await expect(column(page, LIST).getByText('No tasks yet')).toBeVisible();

	await page.getByRole('combobox', { name: 'List' }).selectOption({ label: 'Work' });
	await expect(openTitles(page, 'Work')).toHaveText(['Party']);
	await expect(subtaskTitles(page, 'Work', 'Party')).toHaveText(['Cake']);
});

test('the move endpoint validates its input', async ({ page }) => {
	await addTasks(page, 'Party');
	const created = page.waitForResponse(
		(r) => new URL(r.url()).pathname === '/api/tasks' && r.request().method() === 'POST'
	);
	await addTask(page, 'Milk');
	const milk = (await (await created).json()).upserted[0];
	const move = (data: object) => page.request.post(`/api/tasks/${milk.id}/move`, { data });

	expect((await move({ listId: milk.listId })).status()).toBe(400);
	expect((await move({ listId: milk.listId, parentId: 5 })).status()).toBe(400);
	expect(
		(await move({ listId: milk.listId, parentId: null, before: 'a', after: 'b' })).status()
	).toBe(400);
	expect((await move({ listId: crypto.randomUUID(), parentId: null })).status()).toBe(404);
	expect(
		(
			await page.request.post(`/api/tasks/${crypto.randomUUID()}/move`, {
				data: { listId: milk.listId, parentId: null }
			})
		).status()
	).toBe(404);
	expect((await move({ listId: milk.listId, parentId: null })).status()).toBe(200);
});

test('the Priority View has no drag handles (it has no Custom Order)', async ({ page }) => {
	await addTasks(page, 'Milk');
	await expect(handle(page, 'Milk')).toHaveCount(1);
	const milk = page.locator('li[data-task-id]', {
		has: page.getByRole('button', { name: 'Milk', exact: true })
	});
	await milk.getByRole('button', { name: 'Priority: None' }).click();
	await saved(page, () => milk.getByRole('button', { name: 'High', exact: true }).click());

	await page.goto('/priority');
	await expect(page.getByRole('button', { name: 'Milk', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Move task' })).toHaveCount(0);
});
