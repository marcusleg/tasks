import { expect, test, type Page } from '@playwright/test';
import Database from 'better-sqlite3';
import { loginAs } from './auth';
import { addTask, saved } from './lists-tasks';

/**
 * Task dates can't be set through the API yet, so the test writes a Planned Date straight into the
 * e2e database (shared with the server through E2E_DATABASE_PATH; SQLite WAL allows this).
 */
function setPlannedDate(title: string, date: string) {
	const db = new Database(process.env.E2E_DATABASE_PATH!);
	try {
		db.pragma('busy_timeout = 5000');
		const result = db.prepare('update tasks set planned_date = ? where title = ?').run(date, title);
		expect(result.changes).toBe(1);
	} finally {
		db.close();
	}
}

async function createLink(page: Page, name: string) {
	await page.getByRole('button', { name: 'New Calendar Link' }).click();
	await page.getByRole('textbox', { name: 'Name' }).fill(name);
	await saved(page, () => page.getByRole('button', { name: 'Create' }).click());
}

test('create, copy, fetch, edit and delete a Calendar Link', async ({ page, context, request }) => {
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	await loginAs(page);
	const title = `Dentist ${Date.now()}`;
	await addTask(page, title);
	setPlannedDate(title, '2026-05-04');

	await page
		.getByRole('navigation', { name: 'Main' })
		.getByRole('link', { name: 'Settings' })
		.click();
	await expect(page).toHaveURL(/\/settings$/);
	await expect(page.getByText('No Calendar Links yet')).toBeVisible();

	await createLink(page, 'Proton');
	const card = page.getByRole('article', { name: 'Proton' });
	await expect(card.getByText('All Lists')).toBeVisible();
	await expect(card.getByText('never')).toBeVisible();

	await card.getByRole('button', { name: 'Copy URL' }).click();
	const url = await page.evaluate(() => navigator.clipboard.readText());
	expect(url).toMatch(/\/cal\/[A-Za-z0-9_-]{43}\.ics$/);

	// Anonymous fetch (no cookies).
	const response = await request.get(url);
	expect(response.status()).toBe(200);
	expect(response.headers()['content-type']).toBe('text/calendar; charset=utf-8');
	expect(response.headers()['content-disposition']).toContain('proton.ics');
	const body = await response.text();
	expect(body).toContain('BEGIN:VCALENDAR');
	expect(body).toContain(`SUMMARY:${title}`);
	expect(body).toContain('DTSTART;VALUE=DATE:20260504');

	// Last accessed updates.
	await page.reload();
	await expect(card.getByText('never')).toHaveCount(0);
	await expect(card.getByText('just now')).toBeVisible();

	// Rename and restrict to a List without Tasks: the Task disappears from the feed.
	await card.getByRole('button', { name: 'Edit' }).click();
	await page.getByRole('textbox', { name: 'Name' }).fill('Work');
	await page.getByRole('checkbox', { name: /All Lists/ }).uncheck();
	await expect(page.getByRole('checkbox', { name: 'My Tasks' })).toBeVisible();
	await page.getByRole('checkbox', { name: 'My Tasks' }).check();
	await saved(page, () => page.getByRole('button', { name: 'Save' }).click());
	const renamed = page.getByRole('article', { name: 'Work' });
	await expect(renamed.getByText('My Tasks')).toBeVisible();
	expect(await (await request.get(url)).text()).toContain('X-WR-CALNAME:Work');

	// Delete revokes the URL.
	await renamed.getByRole('button', { name: 'Delete' }).click();
	await saved(page, () =>
		page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
	);
	await expect(page.getByText('No Calendar Links yet')).toBeVisible();
	expect((await request.get(url)).status()).toBe(404);
});

test('unknown tokens get a bare 404 and /settings needs a login', async ({ request, browser }) => {
	const response = await request.get(`/cal/${'a'.repeat(43)}.ics`);
	expect(response.status()).toBe(404);

	const anonymous = await browser.newContext();
	const page = await anonymous.newPage();
	await page.goto('/settings');
	await expect(page).toHaveURL(/\/auth\/login/);
	await anonymous.close();
});
