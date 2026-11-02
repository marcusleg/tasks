import { type Locator, type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { loginAs } from './auth';
import { addTask, column, detailPanel, openTitles, saved } from './lists-tasks';

// Dates are shown in the browser's zone and locale; pin both so labels are predictable.
test.use({ timezoneId: 'Europe/Berlin', locale: 'en-GB' });

test.beforeEach(async ({ page }) => {
	await loginAs(page);
});

const LIST = 'My Tasks';

const openList = (page: Page): Locator =>
	column(page, LIST).getByRole('list', { name: 'Open tasks' });

/** The open row of a top-level Task. */
const openRow = (page: Page, title: string): Locator =>
	openList(page).locator(':scope > li[data-task-id]', {
		has: page.getByRole('button', { name: title, exact: true })
	});

const editPrompt = (page: Page): Locator =>
	page.getByRole('dialog', { name: 'Change a repeating task' });
const deletePrompt = (page: Page): Locator =>
	page.getByRole('dialog', { name: 'Delete a repeating task' });

const undoButton = (page: Page): Locator =>
	page
		.getByRole('status', { name: 'Notifications' })
		.getByRole('group', { name: 'Notification' })
		.getByRole('button', { name: 'Undo' });

async function openTask(page: Page, title: string): Promise<void> {
	await openList(page).getByRole('button', { name: title, exact: true }).click();
	await expect(detailPanel(page)).toBeVisible();
}

async function closePanel(page: Page): Promise<void> {
	await page.keyboard.press('Escape');
	await expect(detailPanel(page)).toBeHidden();
}

const plannedDateInput = (page: Page): Locator =>
	detailPanel(page)
		.getByRole('group', { name: 'Planned date' })
		.getByLabel('Date', { exact: true });

const titleInput = (page: Page): Locator =>
	detailPanel(page).getByRole('textbox', { name: 'Title' });

/** "Water plants", planned on Wednesday 10 Mar 2027, weekly. */
async function weeklyTask(page: Page, title = 'Water plants'): Promise<void> {
	await addTask(page, title);
	await openTask(page, title);
	await saved(page, async () => {
		await plannedDateInput(page).fill('2027-03-10');
		await plannedDateInput(page).blur();
	});
	await saved(page, () =>
		detailPanel(page).getByRole('combobox', { name: 'Repeat', exact: true }).selectOption('Weekly')
	);
	await closePanel(page);
}

async function complete(page: Page, title: string): Promise<void> {
	const completed = page.waitForResponse((r) => r.url().endsWith('/complete'));
	await openList(page).getByRole('checkbox', { name: title }).click();
	expect((await completed).ok()).toBe(true);
}

test('moving This Occurrence keeps the next one on the rule’s weekday', async ({ page }) => {
	await weeklyTask(page);
	await openTask(page, 'Water plants');

	await plannedDateInput(page).fill('2027-03-11');
	await plannedDateInput(page).blur();
	await expect(editPrompt(page)).toBeVisible();
	await saved(page, () =>
		editPrompt(page).getByRole('button', { name: 'This occurrence' }).click()
	);
	await expect(editPrompt(page)).toBeHidden();
	await expect(detailPanel(page).getByRole('status')).toContainText(
		'Date changes apply to this occurrence only.'
	);
	await closePanel(page);
	await expect(openRow(page, 'Water plants')).toContainText('11 Mar 2027');

	await complete(page, 'Water plants');

	// Wednesday again, a week after the series' 10 March.
	await expect(openRow(page, 'Water plants')).toContainText('17 Mar 2027');
	await page.reload();
	await expect(openRow(page, 'Water plants')).toContainText('17 Mar 2027');
});

test('a Title changed for this and all future Occurrences carries on', async ({ page }) => {
	await weeklyTask(page);
	await openTask(page, 'Water plants');

	await titleInput(page).fill('Water all plants');
	// Typing alone doesn't ask; committing does.
	await page.waitForTimeout(800);
	await expect(editPrompt(page)).toBeHidden();
	await titleInput(page).press('Enter');
	await saved(page, () =>
		editPrompt(page).getByRole('button', { name: 'This and all future' }).click()
	);

	// The choice holds for the rest of the panel's details: no second question.
	await saved(page, () =>
		detailPanel(page).getByRole('radio', { name: 'High', exact: true }).check()
	);
	await expect(editPrompt(page)).toBeHidden();
	await closePanel(page);

	await complete(page, 'Water all plants');

	await expect(openTitles(page, LIST)).toHaveText(['Water all plants']);
	await expect(openRow(page, 'Water all plants')).toContainText('17 Mar 2027');
	await expect(
		openRow(page, 'Water all plants').getByRole('button', { name: 'Priority: High' })
	).toBeVisible();
});

test('cancelling the question discards the change', async ({ page }) => {
	await weeklyTask(page);
	await openTask(page, 'Water plants');

	await titleInput(page).fill('Water nothing');
	await titleInput(page).press('Enter');
	await editPrompt(page).getByRole('button', { name: 'Cancel' }).click();

	await expect(titleInput(page)).toHaveValue('Water plants');
	await closePanel(page);
	await expect(openTitles(page, LIST)).toHaveText(['Water plants']);
});

test('deleting This Occurrence skips to the next one', async ({ page }) => {
	await weeklyTask(page);
	await openTask(page, 'Water plants');
	await detailPanel(page).getByRole('textbox', { name: 'Add subtask' }).fill('Fern');
	await page.keyboard.press('Enter');
	await saved(page, () =>
		editPrompt(page).getByRole('button', { name: 'This and all future' }).click()
	);

	await detailPanel(page).getByRole('button', { name: 'Delete task' }).click();
	await expect(deletePrompt(page)).toBeVisible();
	await saved(page, () =>
		deletePrompt(page).getByRole('button', { name: 'This occurrence' }).click()
	);

	await expect(detailPanel(page)).toBeHidden();
	await expect(openTitles(page, LIST)).toHaveText(['Water plants']);
	await expect(openRow(page, 'Water plants')).toContainText('17 Mar 2027');
	await expect(column(page, LIST).getByText(/Completed \(/)).toHaveCount(0);
	await page.reload();
	await expect(openRow(page, 'Water plants')).toContainText('17 Mar 2027');
	await expect(
		column(page, LIST)
			.getByRole('list', { name: 'Subtasks of Water plants', exact: true })
			.getByRole('checkbox', { name: 'Fern' })
	).not.toBeChecked();
});

test('deleting this and all future Occurrences leaves nothing behind', async ({ page }) => {
	await weeklyTask(page);
	await openTask(page, 'Water plants');

	await detailPanel(page).getByRole('button', { name: 'Delete task' }).click();
	await saved(page, () =>
		deletePrompt(page).getByRole('button', { name: 'This and all future' }).click()
	);

	await expect(openTitles(page, LIST)).toHaveCount(0);
	await page.reload();
	await expect(openTitles(page, LIST)).toHaveCount(0);
});

test('a Task that doesn’t repeat is never asked about', async ({ page }) => {
	await addTask(page, 'Buy milk');
	await openTask(page, 'Buy milk');

	await saved(page, async () => {
		await titleInput(page).fill('Buy oat milk');
		await titleInput(page).press('Enter');
	});
	await saved(page, async () => {
		await plannedDateInput(page).fill('2027-03-11');
		await plannedDateInput(page).blur();
	});
	await expect(editPrompt(page)).toBeHidden();

	await saved(page, () => detailPanel(page).getByRole('button', { name: 'Delete task' }).click());
	await expect(deletePrompt(page)).toBeHidden();
	await expect(openTitles(page, LIST)).toHaveCount(0);
});

test('Undo after deleting This Occurrence brings it back instead of the next one', async ({
	page
}) => {
	await weeklyTask(page);
	await openTask(page, 'Water plants');
	await detailPanel(page).getByRole('button', { name: 'Delete task' }).click();
	await saved(page, () =>
		deletePrompt(page).getByRole('button', { name: 'This occurrence' }).click()
	);
	await expect(openRow(page, 'Water plants')).toContainText('17 Mar 2027');

	const restore = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/tasks/restore');
	await undoButton(page).click();
	expect((await restore).ok()).toBe(true);

	await expect(openTitles(page, LIST)).toHaveText(['Water plants']);
	await expect(openRow(page, 'Water plants')).toContainText('10 Mar 2027');
	await page.reload();
	await expect(openTitles(page, LIST)).toHaveText(['Water plants']);
	await expect(openRow(page, 'Water plants')).toContainText('10 Mar 2027');

	// The series counts on from the restored Occurrence: completing it brings 17 March.
	await complete(page, 'Water plants');
	await expect(openRow(page, 'Water plants')).toContainText('17 Mar 2027');
});

test('Undo after deleting this and all future Occurrences restores the series', async ({
	page
}) => {
	await weeklyTask(page);
	await openTask(page, 'Water plants');
	await detailPanel(page).getByRole('button', { name: 'Delete task' }).click();
	await saved(page, () =>
		deletePrompt(page).getByRole('button', { name: 'This and all future' }).click()
	);
	await expect(openTitles(page, LIST)).toHaveCount(0);

	await saved(page, () => undoButton(page).click());

	await expect(openRow(page, 'Water plants')).toContainText('10 Mar 2027');
	await expect(
		openRow(page, 'Water plants').getByRole('img', { name: 'Repeats weekly' })
	).toBeVisible();
	await page.reload();
	await expect(openRow(page, 'Water plants')).toContainText('10 Mar 2027');
});
