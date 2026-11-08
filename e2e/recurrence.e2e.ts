import { type Locator, type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { loginAs } from './auth';
import { addSubtask, addTask, column, detailPanel, openTitles, saved } from './lists-tasks';

// Dates are shown in the browser's zone and locale; pin both so labels are predictable.
test.use({ timezoneId: 'Europe/Berlin', locale: 'en-GB' });

test.beforeEach(async ({ page }) => {
	await loginAs(page);
});

const LIST = 'My Tasks';

const openList = (page: Page): Locator =>
	column(page, LIST).getByRole('list', { name: 'Open tasks' });
const completedList = (page: Page): Locator =>
	column(page, LIST).getByRole('list', { name: 'Completed tasks' });

/** The open row of a top-level Task. */
const openRow = (page: Page, title: string): Locator =>
	openList(page).locator(':scope > li[data-task-id]', {
		has: page.getByRole('button', { name: title, exact: true })
	});

const repeat = (page: Page): Locator =>
	detailPanel(page).getByRole('combobox', { name: 'Repeat', exact: true });

async function openTask(page: Page, title: string): Promise<void> {
	await openList(page).getByRole('button', { name: title, exact: true }).click();
	await expect(detailPanel(page)).toBeVisible();
}

async function closePanel(page: Page): Promise<void> {
	await page.keyboard.press('Escape');
	await expect(detailPanel(page)).toBeHidden();
}

async function setPlannedDate(page: Page, date: string): Promise<void> {
	const input = detailPanel(page)
		.getByRole('group', { name: 'Planned date' })
		.getByLabel('Date', { exact: true });
	await saved(page, async () => {
		await input.fill(date);
		await input.blur();
	});
}

/** "Water plants", planned on Wednesday 10 Mar 2027, weekly, with the Subtask "Fern". */
async function weeklyTask(page: Page): Promise<void> {
	await addTask(page, 'Water plants');
	await openTask(page, 'Water plants');
	await setPlannedDate(page, '2027-03-10');
	await addSubtask(page, 'Fern');
	await saved(page, () => repeat(page).selectOption('Weekly'));
	await closePanel(page);
}

async function completeWaterPlants(page: Page): Promise<void> {
	const completed = page.waitForResponse((r) => r.url().endsWith('/complete'));
	await openList(page).getByRole('checkbox', { name: 'Water plants' }).click();
	expect((await completed).ok()).toBe(true);
}

test('a weekly Task: completing it brings the next Occurrence a week later, Subtasks reopened', async ({
	page
}) => {
	await weeklyTask(page);
	const row = openRow(page, 'Water plants');
	await expect(row.getByRole('img', { name: 'Repeats weekly' })).toBeVisible();
	await openTask(page, 'Water plants');
	// The weekday defaults to the Planned Date's.
	const weekdays = detailPanel(page).getByRole('group', { name: 'On these days' });
	await expect(weekdays.getByRole('button', { name: 'Wednesday' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(weekdays.getByRole('button', { name: 'Monday' })).toHaveAttribute(
		'aria-pressed',
		'false'
	);
	await closePanel(page);

	await completeWaterPlants(page);

	await expect(openTitles(page, LIST)).toHaveText(['Water plants']);
	await expect(row).toContainText('17 Mar 2027');
	await expect(row.getByRole('img', { name: 'Repeats weekly' })).toBeVisible();
	const subtasks = column(page, LIST).getByRole('list', {
		name: 'Subtasks of Water plants',
		exact: true
	});
	await expect(subtasks.getByRole('checkbox', { name: 'Fern' })).not.toBeChecked();
	await column(page, LIST).getByText('Completed (2)').click();
	await expect(completedList(page).getByRole('checkbox', { name: 'Water plants' })).toBeChecked();

	await page.reload();
	await expect(openTitles(page, LIST)).toHaveText(['Water plants']);
	await expect(row).toContainText('17 Mar 2027');
	await expect(subtasks.getByRole('checkbox', { name: 'Fern' })).not.toBeChecked();
});

test('reopening the Completed Occurrence right away puts it back in place of the new one', async ({
	page
}) => {
	await weeklyTask(page);
	await completeWaterPlants(page);
	await expect(openRow(page, 'Water plants')).toContainText('17 Mar 2027');

	await column(page, LIST).getByText('Completed (2)').click();
	await saved(page, () =>
		completedList(page).getByRole('checkbox', { name: 'Water plants' }).click()
	);

	await expect(openTitles(page, LIST)).toHaveText(['Water plants']);
	await expect(openRow(page, 'Water plants')).toContainText('10 Mar 2027');
	await expect(column(page, LIST).getByText(/Completed \(/)).toHaveCount(0);
	await page.reload();
	await expect(openTitles(page, LIST)).toHaveText(['Water plants']);
	await expect(openRow(page, 'Water plants')).toContainText('10 Mar 2027');
	await expect(
		openRow(page, 'Water plants').getByRole('img', { name: 'Repeats weekly' })
	).toBeVisible();
});

test('after the new Occurrence is edited, reopening the old one brings it back as a one-off', async ({
	page
}) => {
	await weeklyTask(page);
	await completeWaterPlants(page);
	await openTask(page, 'Water plants');
	await detailPanel(page).getByRole('textbox', { name: 'Title' }).fill('Water all plants');
	await detailPanel(page).getByRole('textbox', { name: 'Title' }).blur();
	await saved(page, () =>
		page
			.getByRole('dialog', { name: 'Change a repeating task' })
			.getByRole('button', { name: 'This and all future' })
			.click()
	);
	await closePanel(page);

	await column(page, LIST).getByText('Completed (2)').click();
	await saved(page, () =>
		completedList(page).getByRole('checkbox', { name: 'Water plants' }).click()
	);

	// It comes back in its own place, just above the Occurrence that took it.
	await expect(openTitles(page, LIST)).toHaveText(['Water plants', 'Water all plants']);
	const oneOff = openRow(page, 'Water plants');
	await expect(oneOff).toContainText('10 Mar 2027');
	await expect(oneOff.getByRole('img', { name: /Repeats/ })).toHaveCount(0);
	await expect(
		openRow(page, 'Water all plants').getByRole('img', { name: 'Repeats weekly' })
	).toBeVisible();
	await openTask(page, 'Water plants');
	await expect(repeat(page)).toHaveValue('off');
});

test('clearing the last date of a repeating Task is refused with a message', async ({ page }) => {
	await weeklyTask(page);
	await openTask(page, 'Water plants');

	await detailPanel(page).getByRole('button', { name: 'Clear planned date' }).click();
	const prompt = page.getByRole('dialog', { name: 'Change a repeating task' });
	const refused = page.waitForResponse((r) => r.request().method() === 'PATCH');
	await prompt.getByRole('button', { name: 'This and all future' }).click();
	const response = await refused;

	expect(response.status()).toBe(400);
	expect(await response.json()).toMatchObject({ code: 'recurrence_needs_date' });
	await expect(page.getByRole('status', { name: 'Notifications' })).toContainText(
		"Couldn't save the task. A repeating Task needs a Planned Date or a Due Date."
	);
});

test('the Recurrence editor explains when a Task can’t repeat', async ({ page }) => {
	await addTask(page, 'Garden');
	await openTask(page, 'Garden');
	await expect(repeat(page)).toBeDisabled();
	await expect(detailPanel(page)).toContainText('Set a planned or due date to repeat this task.');

	// A recurring Subtask keeps its parent from recurring.
	await setPlannedDate(page, '2027-03-10');
	await expect(repeat(page)).toBeEnabled();
	await addSubtask(page, 'Mow');
	await detailPanel(page)
		.getByRole('list', { name: 'Subtasks' })
		.getByRole('button', { name: 'Mow' })
		.click();
	await expect(detailPanel(page).getByRole('textbox', { name: 'Title' })).toHaveValue('Mow');
	await setPlannedDate(page, '2027-03-11');
	await saved(page, () => repeat(page).selectOption('Monthly'));
	await expect(detailPanel(page).getByLabel('On day')).toHaveValue('11');
	await detailPanel(page)
		.getByRole('navigation', { name: 'Parent task' })
		.getByRole('button')
		.click();
	await expect(detailPanel(page).getByRole('textbox', { name: 'Title' })).toHaveValue('Garden');
	await expect(repeat(page)).toBeDisabled();
	await expect(detailPanel(page)).toContainText('A subtask repeats, so this task can’t.');

	// The server refuses it too.
	const id = await openRow(page, 'Garden').getAttribute('data-task-id');
	const response = await page.request.patch(`/api/tasks/${id}`, {
		data: {
			recurrence: { frequency: 'daily', interval: 1, end: { kind: 'never' }, anchor: 'schedule' }
		}
	});
	expect(response.status()).toBe(400);
	expect((await response.json()).message).toMatch(/Subtask of this Task repeats/);
});
