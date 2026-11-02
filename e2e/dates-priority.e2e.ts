import { type Locator, type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { loginAs } from './auth';
import { addSubtask, addTask, column, detailPanel, saved } from './lists-tasks';

// Dates are shown in the browser's zone and locale; pin both so labels are predictable.
test.use({ timezoneId: 'Europe/Berlin', locale: 'en-GB' });

test.beforeEach(async ({ page }) => {
	await loginAs(page);
});

const dateGroup = (page: Page, name: 'Planned date' | 'Due date'): Locator =>
	detailPanel(page).getByRole('group', { name });

const row = (page: Page, title: string): Locator =>
	column(page, 'My Tasks').locator('li[data-task-id]', {
		has: page.getByRole('button', { name: title, exact: true })
	});

/** Types a value into a date or time input and leaves it, which saves it. */
async function enter(page: Page, input: Locator, value: string): Promise<void> {
	await saved(page, async () => {
		await input.fill(value);
		await input.blur();
	});
}

async function openTask(page: Page, title: string): Promise<void> {
	await page.getByRole('button', { name: title, exact: true }).click();
	await expect(detailPanel(page)).toBeVisible();
}

async function taskId(page: Page, title: string): Promise<string> {
	const id = await row(page, title).getAttribute('data-task-id');
	if (!id) throw new Error(`No Task "${title}"`);
	return id;
}

test('a date-only Planned Date and a timed Due Date persist', async ({ page }) => {
	await addTask(page, 'Call the bank');
	await openTask(page, 'Call the bank');

	await enter(
		page,
		dateGroup(page, 'Planned date').getByLabel('Date', { exact: true }),
		'2027-03-10'
	);
	const due = dateGroup(page, 'Due date');
	await enter(page, due.getByLabel('Date', { exact: true }), '2027-03-12');
	await saved(page, () => due.getByRole('button', { name: 'Add time' }).click());
	await enter(page, due.getByLabel('Time', { exact: true }), '17:30');

	const chips = row(page, 'Call the bank');
	await expect(chips).toContainText('10 Mar 2027');
	await expect(chips).toContainText('Due 12 Mar 2027 17:30');

	await page.reload();
	await expect(chips).toContainText('10 Mar 2027');
	await expect(chips).toContainText('Due 12 Mar 2027 17:30');
	await openTask(page, 'Call the bank');
	await expect(dateGroup(page, 'Planned date').getByLabel('Date', { exact: true })).toHaveValue(
		'2027-03-10'
	);
	await expect(dateGroup(page, 'Planned date').getByLabel('Time', { exact: true })).toHaveCount(0);
	await expect(due.getByLabel('Date', { exact: true })).toHaveValue('2027-03-12');
	await expect(due.getByLabel('Time', { exact: true })).toHaveValue('17:30');

	// Clearing takes a date back to unset.
	await saved(page, () => due.getByRole('button', { name: 'Clear due date' }).click());
	await expect(due.getByLabel('Date', { exact: true })).toHaveValue('');
	await page.reload();
	await expect(chips).not.toContainText('Due');
});

test('a date typed just before closing the panel is still saved', async ({ page }) => {
	await addTask(page, 'Quick one');
	await openTask(page, 'Quick one');

	await saved(page, async () => {
		await dateGroup(page, 'Due date').getByLabel('Date', { exact: true }).fill('2027-03-12');
		await page.keyboard.press('Escape');
	});

	await expect(detailPanel(page)).toBeHidden();
	await page.reload();
	await expect(row(page, 'Quick one')).toContainText('Due 12 Mar 2027');
});

test('quick picks, Duration and the overdue highlight', async ({ page }) => {
	await addTask(page, 'Water plants');
	await openTask(page, 'Water plants');
	const planned = dateGroup(page, 'Planned date');

	await saved(page, () => planned.getByRole('button', { name: 'Today' }).click());
	await saved(page, () => planned.getByRole('button', { name: 'Add time' }).click());
	await expect(planned.getByLabel('Duration')).toHaveValue('30');
	await saved(page, async () => {
		await planned.getByLabel('Duration').fill('45');
		await planned.getByLabel('Duration').blur();
	});
	await expect(row(page, 'Water plants')).toContainText('Today 09:00');

	await saved(page, () =>
		dateGroup(page, 'Due date').getByRole('button', { name: 'Tomorrow' }).click()
	);
	await expect(row(page, 'Water plants')).toContainText('Due Tomorrow');

	const yesterday = await page.evaluate(() => {
		const date = new Date();
		date.setDate(date.getDate() - 1);
		return date.toLocaleDateString('sv'); // YYYY-MM-DD in the browser's zone
	});
	await enter(page, dateGroup(page, 'Due date').getByLabel('Date', { exact: true }), yesterday);
	await expect(row(page, 'Water plants')).toContainText('Overdue Yesterday');

	await page.reload();
	await expect(row(page, 'Water plants')).toContainText('Overdue Yesterday');
	await openTask(page, 'Water plants');
	await expect(planned.getByLabel('Duration')).toHaveValue('45');
});

test('Planned after Due shows a warning but still saves', async ({ page }) => {
	await addTask(page, 'File taxes');
	await openTask(page, 'File taxes');
	const warning = detailPanel(page).getByRole('status').filter({ hasText: 'after the due date' });

	await enter(page, dateGroup(page, 'Due date').getByLabel('Date', { exact: true }), '2027-03-12');
	await expect(warning).toBeHidden();
	await enter(
		page,
		dateGroup(page, 'Planned date').getByLabel('Date', { exact: true }),
		'2027-03-15'
	);
	await expect(warning).toBeVisible();

	await page.reload();
	await openTask(page, 'File taxes');
	await expect(dateGroup(page, 'Planned date').getByLabel('Date', { exact: true })).toHaveValue(
		'2027-03-15'
	);
	await expect(warning).toBeVisible();
});

test('set, change and clear Priority from the row and the detail panel', async ({ page }) => {
	await addTask(page, 'Pay rent');
	const task = row(page, 'Pay rent');

	await task.getByRole('button', { name: 'Priority: None' }).click();
	await saved(page, () => task.getByRole('button', { name: 'High' }).click());
	await expect(task.getByRole('button', { name: 'Priority: High' })).toBeVisible();

	await page.reload();
	await expect(task.getByRole('button', { name: 'Priority: High' })).toBeVisible();
	await openTask(page, 'Pay rent');
	const priority = detailPanel(page).getByRole('group', { name: 'Priority' });
	await expect(priority.getByRole('radio', { name: 'High' })).toBeChecked();

	await saved(page, () => priority.getByRole('radio', { name: 'Low' }).check());
	await expect(task.getByRole('button', { name: 'Priority: Low' })).toBeVisible();
	await saved(page, () => priority.getByRole('radio', { name: 'None' }).check());
	await expect(task.getByRole('button', { name: 'Priority: None' })).toBeAttached();

	await page.reload();
	await expect(task.getByRole('button', { name: 'Priority: None' })).toBeAttached();
	await openTask(page, 'Pay rent');
	await expect(priority.getByRole('radio', { name: 'None' })).toBeChecked();
});

test('Subtasks have dates and a Priority too, on their rows and in their panel', async ({
	page
}) => {
	await addTask(page, 'Party');
	await openTask(page, 'Party');
	await addSubtask(page, 'Cake');
	await detailPanel(page)
		.getByRole('list', { name: 'Subtasks' })
		.getByRole('button', { name: 'Cake', exact: true })
		.click();
	await expect(detailPanel(page).getByRole('textbox', { name: 'Title' })).toHaveValue('Cake');

	await saved(page, () =>
		dateGroup(page, 'Due date').getByRole('button', { name: 'Tomorrow' }).click()
	);
	await saved(page, () =>
		detailPanel(page)
			.getByRole('group', { name: 'Priority' })
			.getByRole('radio', { name: 'High' })
			.check()
	);

	const subtasks = column(page, 'My Tasks').getByRole('list', {
		name: 'Subtasks of Party',
		exact: true
	});
	await expect(subtasks).toContainText('Due Tomorrow');
	await expect(subtasks.getByRole('button', { name: 'Priority: High' })).toBeVisible();
	await page.reload();
	await expect(subtasks).toContainText('Due Tomorrow');
	await expect(subtasks.getByRole('button', { name: 'Priority: High' })).toBeVisible();
});

test('the API rejects malformed dates, zones and Priorities', async ({ page }) => {
	await addTask(page, 'Validate me');
	const id = await taskId(page, 'Validate me');
	const patch = (data: object) => page.request.patch(`/api/tasks/${id}`, { data });

	for (const body of [
		{ due: { kind: 'timed', dateTime: '2027-07-15T09:00', timeZone: 'Mars/Olympus' } },
		{ due: { kind: 'timed', dateTime: '2027-07-15T09:00', timeZone: '+02:00' } },
		{ due: { kind: 'timed', dateTime: '2027-07-15T09:00', timeZone: 'UTC', durationMinutes: 5 } },
		{ planned: { kind: 'timed', dateTime: '2027-07-15T09:00', timeZone: 'UTC' } },
		{ planned: { kind: 'date', date: '15.07.2027' } },
		{ planned: '2027-07-15' },
		{ priority: 'urgent' }
	]) {
		const response = await patch(body);
		expect(response.status(), JSON.stringify(body)).toBe(400);
	}

	const ok = await patch({
		planned: { kind: 'date', date: '2027-07-15' },
		due: { kind: 'timed', dateTime: '2027-07-16T09:00', timeZone: 'Asia/Tokyo' },
		priority: 'medium'
	});
	expect(ok.status()).toBe(200);
	expect((await ok.json()).upserted[0]).toMatchObject({
		planned: { kind: 'date', date: '2027-07-15' },
		due: { kind: 'timed', dateTime: '2027-07-16T09:00', timeZone: 'Asia/Tokyo' },
		priority: 'medium'
	});
});

test.describe('viewed from New York', () => {
	test.use({ timezoneId: 'America/New_York' });

	test('09:00 Europe/Berlin in summer shows as 03:00, and keeps its zone', async ({ page }) => {
		await addTask(page, 'Berlin call');
		const id = await taskId(page, 'Berlin call');
		const berlin = { kind: 'timed', dateTime: '2027-07-15T09:00', timeZone: 'Europe/Berlin' };
		const response = await page.request.patch(`/api/tasks/${id}`, {
			data: { due: berlin, planned: { ...berlin, durationMinutes: 60 } }
		});
		expect(response.ok()).toBe(true);

		await page.reload();
		await expect(row(page, 'Berlin call')).toContainText('15 Jul 2027 03:00');
		await expect(row(page, 'Berlin call')).toContainText('Due 15 Jul 2027 03:00');
		await openTask(page, 'Berlin call');
		const due = dateGroup(page, 'Due date');
		await expect(due.getByLabel('Time', { exact: true })).toHaveValue('03:00');
		await expect(due).toContainText('Set in Europe/Berlin: 09:00 there');

		// Editing another field leaves the zone alone…
		const priorityChange = page.waitForResponse((r) => r.request().method() === 'PATCH');
		await detailPanel(page).getByRole('radio', { name: 'High' }).check();
		const unchanged = (await (await priorityChange).json()).upserted[0];
		expect(unchanged.due).toEqual(berlin);

		// …editing the time saves it with this browser's zone.
		const timeChange = page.waitForResponse((r) => r.request().method() === 'PATCH');
		await due.getByLabel('Time', { exact: true }).fill('04:00');
		await due.getByLabel('Time', { exact: true }).blur();
		const moved = (await (await timeChange).json()).upserted[0];
		expect(moved.due).toEqual({
			kind: 'timed',
			dateTime: '2027-07-15T04:00',
			timeZone: 'America/New_York'
		});
		expect(moved.planned).toMatchObject({ timeZone: 'Europe/Berlin', durationMinutes: 60 });
	});
});
