import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { Temporal } from 'temporal-polyfill';
import { loginAs } from './auth';
import { expect, test } from './fixtures';
import { waitForHydrationOnNavigation } from './hydration';

/**
 * Retakes the README screenshots in docs/screenshots: `npm run screenshots`. Runs on its own
 * config (playwright.screenshots.config.ts) against a production build, not as part of the e2e
 * suite.
 *
 * The sample data is dated relative to today, so the chips read like "Overdue Yesterday",
 * "Tomorrow" and "Today 10:00" whenever it runs. Weekday labels follow the day it runs on.
 */

const OUT = join(import.meta.dirname, '..', 'docs', 'screenshots');
const TIME_ZONE = 'Europe/Berlin';

const today = Temporal.Now.plainDateISO(TIME_ZONE);
const day = (offset: number) => today.add({ days: offset });
const onDay = (offset: number) => ({ kind: 'date', date: day(offset).toString() });
const at = (offset: number, time: string) => ({
	kind: 'timed',
	dateTime: `${day(offset)}T${time}`,
	timeZone: TIME_ZONE
});
const weeklyFrom = (offset: number) => ({
	frequency: 'weekly',
	interval: 1,
	weekdays: [day(offset).dayOfWeek],
	end: { kind: 'never' },
	anchor: 'schedule'
});

/** "18 to 20 November", or "30 November to 2 December" across a month boundary. */
function dateRange(from: Temporal.PlainDate, to: Temporal.PlainDate): string {
	const month = (date: Temporal.PlainDate) => date.toLocaleString('en-GB', { month: 'long' });
	return from.month === to.month
		? `${from.day} to ${to.day} ${month(to)}`
		: `${from.day} ${month(from)} to ${to.day} ${month(to)}`;
}

test.use({ timezoneId: TIME_ZONE, locale: 'en-GB' });

/** Fills the signed-in User's account with the sample Lists and Tasks, through the JSON API. */
async function seed(page: Page): Promise<void> {
	const send = async (method: 'post' | 'patch', url: string, data: object) => {
		const response = await page.request[method](url, { data });
		expect(response.ok(), `${method.toUpperCase()} ${url}: ${await response.text()}`).toBe(true);
	};
	const list = async (name: string) => {
		const id = randomUUID();
		await send('post', '/api/lists', { id, name });
		return id;
	};
	const task = async (listId: string, title: string, fields: object = {}) => {
		const id = randomUUID();
		await send('post', '/api/tasks', { id, listId, title, ...fields });
		return id;
	};

	// Every new User starts with "My Tasks"; its id is in the sidebar link.
	await page.goto('/');
	const href = await page.getByRole('link', { name: 'My Tasks' }).first().getAttribute('href');
	const myTasks = href!.split('/').pop()!;

	// New Tasks go on top, so each List is filled bottom-up.
	const renewed = await task(myTasks, 'Renew the library books');
	await send('post', `/api/tasks/${renewed}/complete`, { timeZone: TIME_ZONE });
	await task(myTasks, 'Call the dentist', { planned: onDay(3) });
	const plants = await task(myTasks, 'Water the plants', { planned: onDay(1) });
	await send('patch', `/api/tasks/${plants}`, { recurrence: weeklyFrom(1) });
	const trip = await task(myTasks, 'Plan the Hamburg trip', {
		description: `Conference from ${dateRange(day(16), day(18))}.`,
		due: onDay(12),
		priority: 'medium'
	});
	await task(myTasks, 'Book a hotel', { parentId: trip, priority: 'high' });
	await task(myTasks, 'Buy train tickets', { parentId: trip, planned: onDay(2) });
	await task(myTasks, 'Pay the electricity bill', { due: onDay(-1), priority: 'high' });

	const groceries = await list('Groceries');
	for (const title of ['Coffee beans', 'Bread', 'Bananas']) await task(groceries, title);
	await task(groceries, 'Oat milk', { priority: 'low' });

	const work = await list('Work');
	await task(work, 'Quarterly review notes', { due: onDay(18), priority: 'low' });
	const sync = await task(work, 'Team sync', {
		planned: { ...at(0, '10:00'), durationMinutes: 30 }
	});
	await send('patch', `/api/tasks/${sync}`, { recurrence: weeklyFrom(0) });
	await task(work, 'Review pull requests', { planned: onDay(0) });
	await task(work, 'Write the release notes', { due: at(4, '17:00'), priority: 'high' });
}

async function shoot(page: Page, name: string): Promise<void> {
	for (const scheme of ['light', 'dark'] as const) {
		await page.emulateMedia({ colorScheme: scheme });
		await page.goto('/');
		await page.evaluate(() => document.fonts.ready);
		// Keep the pointer off anything with a hover state.
		await page.mouse.move(0, page.viewportSize()!.height - 1);
		await page.waitForTimeout(300);
		await page.screenshot({ path: join(OUT, `${name}-${scheme}.png`) });
	}
}

test('README screenshots', async ({ page, browser, baseURL }) => {
	await loginAs(page, { name: 'Demo' });
	await seed(page);

	await page.setViewportSize({ width: 1480, height: 900 });
	await shoot(page, 'desktop');

	// A phone needs its own context for the pixel ratio; it shares the signed-in session.
	const phone = await browser.newContext({
		storageState: await page.context().storageState(),
		baseURL,
		extraHTTPHeaders: test.info().project.use.extraHTTPHeaders,
		timezoneId: TIME_ZONE,
		locale: 'en-GB',
		viewport: { width: 390, height: 844 },
		deviceScaleFactor: 2,
		isMobile: true,
		hasTouch: true
	});
	await shoot(waitForHydrationOnNavigation(await phone.newPage()), 'mobile');
	await phone.close();
});
