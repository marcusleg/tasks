import type { Browser, Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { loginAs } from './auth';
import { expect, test } from './fixtures';
import {
	addTask,
	column,
	createList,
	detailPanel,
	expectFocused,
	openTitles,
	saved,
	sidebar
} from './lists-tasks';

const RELOAD_EVERY_MS = 60_000;

/** The same User signed in on two devices (separate browser contexts), both on `/`. */
async function twoDevices(
	browser: Browser,
	{ fakeClockOnOne = false } = {}
): Promise<{ one: Page; two: Page }> {
	const sub = `user-${randomUUID()}`;
	const one = await (await browser.newContext()).newPage();
	const two = await (await browser.newContext()).newPage();
	if (fakeClockOnOne) await one.clock.install();
	await loginAs(one, { sub });
	await loginAs(two, { sub });
	return { one, two };
}

/** Two devices showing the same new List. */
async function sharedList(
	browser: Browser,
	options?: { fakeClockOnOne?: boolean }
): Promise<{ one: Page; two: Page }> {
	const { one, two } = await twoDevices(browser, options);
	await createList(two, 'Shared');
	await comeBack(one);
	await sidebar(one).getByRole('link', { name: 'Shared' }).click();
	await one.waitForURL(/\/lists\//);
	await expectFocused(one, 'Shared');
	return { one, two };
}

/** The User returns to this device's window. */
async function comeBack(page: Page): Promise<void> {
	await page.evaluate(() => window.dispatchEvent(new Event('focus')));
}

/** Pretends the tab was switched away from or back to; Playwright pages always count as visible. */
async function setVisibility(page: Page, state: 'hidden' | 'visible'): Promise<void> {
	await page.evaluate((visibilityState) => {
		Object.defineProperty(document, 'visibilityState', {
			configurable: true,
			get: () => visibilityState
		});
		document.dispatchEvent(new Event('visibilitychange'));
	}, state);
}

/** Collects the page's data reloads from here on. */
function watchReloads(page: Page): string[] {
	const reloads: string[] = [];
	page.on('request', (request) => {
		if (new URL(request.url()).pathname.endsWith('/__data.json')) reloads.push(request.url());
	});
	return reloads;
}

test('a List created on another device shows up on coming back', async ({ browser }) => {
	const { one, two } = await twoDevices(browser);

	await createList(two, 'Groceries');
	await comeBack(one);

	await expect(sidebar(one).getByRole('link', { name: 'Groceries' })).toBeVisible();
});

test('a Task added on another device shows up on coming back', async ({ browser }) => {
	const { one, two } = await sharedList(browser);

	await addTask(two, 'Added elsewhere');
	await comeBack(one);

	await expect(openTitles(one, 'Shared')).toHaveText(['Added elsewhere']);
});

test('a device that stays visible catches up by itself', async ({ browser }) => {
	const { one, two } = await twoDevices(browser, { fakeClockOnOne: true });

	// The first reload after the page opened, without ever coming back to it.
	await createList(two, 'Shared');
	await expect(column(one, 'Shared')).toHaveCount(0);
	await one.clock.fastForward(RELOAD_EVERY_MS + 1000);
	await expect(column(one, 'Shared')).toBeVisible();

	// And it keeps going.
	await addTask(two, 'Added elsewhere');
	await expect(openTitles(one, 'Shared')).toHaveCount(0);
	await one.clock.fastForward(RELOAD_EVERY_MS + 1000);
	await expect(openTitles(one, 'Shared')).toHaveText(['Added elsewhere']);
});

test('a hidden device doesn’t reload, and catches up when it’s shown', async ({ browser }) => {
	const { one, two } = await sharedList(browser, { fakeClockOnOne: true });
	await setVisibility(one, 'hidden');
	const reloads = watchReloads(one);

	await addTask(two, 'Added while hidden');
	await one.clock.fastForward(RELOAD_EVERY_MS * 3);
	await two.waitForTimeout(500);
	expect(reloads).toEqual([]);

	await setVisibility(one, 'visible');
	await one.clock.fastForward(1000);

	await expect(openTitles(one, 'Shared')).toHaveText(['Added while hidden']);
});

test('coming back while offline keeps the app, and recovers', async ({ browser }) => {
	const { one, two } = await sharedList(browser);
	await one.context().setOffline(true);

	await comeBack(one);
	await one.waitForTimeout(500);
	await expect(column(one, 'Shared')).toBeVisible();

	await addTask(two, 'Added meanwhile');
	await one.context().setOffline(false);

	await expect(openTitles(one, 'Shared')).toHaveText(['Added meanwhile'], { timeout: 10_000 });
});

test('a Task being typed survives a reload, keeping the focus', async ({ browser }) => {
	const { one, two } = await sharedList(browser);
	const draft = column(one, 'Shared').getByRole('textbox', { name: 'Add a task' });
	await draft.fill('Half-typed');

	await addTask(two, 'Added elsewhere');
	await comeBack(one);
	await expect(openTitles(one, 'Shared')).toHaveText(['Added elsewhere']);

	await expect(draft).toHaveValue('Half-typed');
	await expect(draft).toBeFocused();
});

test('the detail panel follows an edit from another device', async ({ browser }) => {
	const { one, two } = await sharedList(browser);
	await addTask(two, 'Old title');
	await comeBack(one);
	await column(one, 'Shared').getByRole('button', { name: 'Old title' }).click();
	const title = detailPanel(one).getByRole('textbox', { name: 'Title' });
	await expect(title).toHaveValue('Old title');

	await column(two, 'Shared').getByRole('button', { name: 'Old title' }).click();
	await saved(two, async () => {
		await detailPanel(two).getByRole('textbox', { name: 'Title' }).fill('New title');
		await two.keyboard.press('Enter');
	});
	await comeBack(one);

	await expect(title).toHaveValue('New title');
});

test('unsaved edits in the detail panel survive a reload', async ({ browser }) => {
	const { one, two } = await sharedList(browser);
	await addTask(two, 'Old title');
	await comeBack(one);
	await column(one, 'Shared').getByRole('button', { name: 'Old title' }).click();
	const title = detailPanel(one).getByRole('textbox', { name: 'Title' });

	// Hold the reload back, so it lands right after typing, before the debounced save goes out.
	let land = () => {};
	const held = new Promise<void>((resolve) => (land = resolve));
	await one.route('**/__data.json*', async (route) => {
		await held;
		await route.continue();
	});
	const reloading = one.waitForRequest(/__data\.json/);
	await addTask(two, 'Added elsewhere');
	await comeBack(one);
	await reloading;
	await title.fill('Typed here');
	land();

	await expect(openTitles(one, 'Shared')).toHaveCount(2);
	await expect(title).toHaveValue('Typed here');
});

test('a reload waits for changes still being saved', async ({ browser }) => {
	const { one, two } = await sharedList(browser);

	let answer = () => {};
	const held = new Promise<void>((resolve) => (answer = resolve));
	await one.route('**/api/tasks', async (route) => {
		await held;
		await route.continue();
	});
	await column(one, 'Shared').getByRole('textbox', { name: 'Add a task' }).fill('Mine');
	await one.keyboard.press('Enter');
	await expect(openTitles(one, 'Shared')).toHaveText(['Mine']);

	const reloads = watchReloads(one);
	await addTask(two, 'Theirs');
	await comeBack(one);
	// Past the delay a reload would wait for: still only what this device added.
	await one.waitForTimeout(500);
	expect(reloads).toEqual([]);
	await expect(openTitles(one, 'Shared')).toHaveText(['Mine']);

	answer();
	// The server took "Mine" last, so it's on top.
	await expect(openTitles(one, 'Shared')).toHaveText(['Mine', 'Theirs']);
});

test('a device showing a List deleted elsewhere goes back to the start', async ({ browser }) => {
	const { one, two } = await sharedList(browser);

	await column(two, 'Shared').getByRole('button', { name: 'List options' }).click();
	await column(two, 'Shared').getByRole('button', { name: 'Delete list' }).click();
	await saved(two, () => two.getByRole('dialog').getByRole('button', { name: 'Delete' }).click());
	await comeBack(one);

	await expect(one).toHaveURL('/');
	await expect(sidebar(one).getByRole('link', { name: 'Shared' })).toHaveCount(0);
});

test('a Calendar Link created elsewhere shows up in the settings', async ({ browser }) => {
	const { one, two } = await twoDevices(browser);
	await one.goto('/settings');

	await two.evaluate(() =>
		fetch('/api/calendar-links', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ name: 'From elsewhere', allLists: true })
		})
	);
	await comeBack(one);

	await expect(one.getByText('From elsewhere')).toBeVisible();
});
