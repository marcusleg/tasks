import { type Locator, type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { loginAs } from './auth';
import { waitForHydration } from './hydration';
import { currentColumn, saved } from './lists-tasks';

// Dates and Recurrence in German (CONTEXT.md → Language).
test.use({ locale: 'de-DE', timezoneId: 'Europe/Berlin' });

test.beforeEach(async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await loginAs(page);
});

// The List the page is about: named in the Language the User had when it was created.
const column = currentColumn;
const panel = (page: Page): Locator => page.getByRole('complementary', { name: 'Aufgabendetails' });
const row = (page: Page, title: string): Locator =>
	column(page)
		.getByRole('list', { name: 'Offene Aufgaben' })
		.locator(':scope > li[data-task-id]', {
			has: page.getByRole('button', { name: title, exact: true })
		});

async function addTask(page: Page, title: string): Promise<void> {
	await waitForHydration(page);
	await saved(page, async () => {
		await column(page).getByRole('textbox', { name: 'Aufgabe hinzufügen' }).fill(title);
		await page.keyboard.press('Enter');
	});
}

/** Plans the open panel's Task for tomorrow (the Tomorrow quick pick) at 14:00. */
async function planTomorrowAt14(page: Page): Promise<void> {
	const planned = panel(page).getByRole('group', { name: 'Geplantes Datum' });
	await saved(page, () => planned.getByRole('button', { name: 'Morgen' }).click());
	await saved(page, () => planned.getByRole('button', { name: 'Uhrzeit hinzufügen' }).click());
	await saved(page, async () => {
		const time = planned.getByLabel('Uhrzeit', { exact: true });
		await time.fill('14:00');
		await time.blur();
	});
}

test('dates, the Recurrence field and the scope dialog are German', async ({ page }) => {
	await page.goto('/');
	await addTask(page, 'Pflanzen gießen');
	await column(page).getByRole('button', { name: 'Pflanzen gießen', exact: true }).click();
	await expect(panel(page)).toBeVisible();

	await planTomorrowAt14(page);
	await expect(row(page, 'Pflanzen gießen')).toContainText('Morgen 14:00');
	await expect(
		panel(page).getByRole('button', { name: 'Geplantes Datum entfernen' })
	).toBeVisible();
	await expect(panel(page).getByText('Dauer')).toBeVisible();

	const due = panel(page).getByRole('group', { name: 'Fälligkeitsdatum' });
	await saved(page, () => due.getByRole('button', { name: 'Heute' }).click());
	await expect(row(page, 'Pflanzen gießen')).toContainText('Fällig Heute');
	await expect(panel(page).getByRole('status')).toContainText(
		'Das geplante Datum liegt nach dem Fälligkeitsdatum.'
	);

	// The Recurrence field.
	const repeat = panel(page).getByRole('combobox', { name: 'Wiederholung', exact: true });
	await expect(repeat.getByRole('option')).toHaveText([
		'Keine Wiederholung',
		'Täglich',
		'Wöchentlich',
		'Monatlich',
		'Jährlich'
	]);
	await saved(page, () => repeat.selectOption('Wöchentlich'));
	const weekdays = panel(page).getByRole('group', { name: 'An diesen Wochentagen' });
	await expect(weekdays.getByRole('button', { name: 'Montag' })).toBeVisible();
	await expect(weekdays.getByRole('button', { name: 'Sonntag' })).toBeVisible();
	await expect(panel(page).getByRole('combobox', { name: 'Endet' })).toBeVisible();
	await expect(panel(page).getByText('Nach Erledigung wiederholen')).toBeVisible();
	await expect(
		row(page, 'Pflanzen gießen').getByRole('img', { name: 'Wiederholt sich wöchentlich' })
	).toBeVisible();

	await saved(page, () => repeat.selectOption('Jährlich'));
	await expect(panel(page).getByText(/^Jedes Jahr am \d+\. \p{L}+\.$/u)).toBeVisible();

	// Changing a repeating Task asks which Termine.
	await panel(page).getByRole('textbox', { name: 'Titel' }).fill('Blumen gießen');
	await panel(page).getByRole('textbox', { name: 'Titel' }).blur();
	const dialog = page.getByRole('dialog', { name: 'Wiederholende Aufgabe ändern' });
	await expect(dialog).toContainText('wiederholt sich');
	await expect(dialog.getByRole('button', { name: 'Nur diesen Termin' })).toBeVisible();
	await expect(dialog.getByRole('button', { name: 'Abbrechen' })).toBeVisible();
	await saved(page, () =>
		dialog.getByRole('button', { name: 'Diesen und alle folgenden Termine' }).click()
	);
	await expect(panel(page)).toContainText(
		'Änderungen an Titel, Details und Priorität gelten für diesen und alle folgenden Termine.'
	);
	await expect(panel(page).getByRole('button', { name: 'Erneut fragen' })).toBeVisible();
});

test('a chosen Deutsch on an en-US browser writes dates in German', async ({ browser }) => {
	const context = await browser.newContext({ locale: 'en-US', timezoneId: 'Europe/Berlin' });
	const page = await context.newPage();
	await page.setViewportSize({ width: 1280, height: 800 });
	await loginAs(page);
	await page.goto('/settings');
	await page.getByRole('combobox', { name: 'Language' }).selectOption('de');
	await expect(page.getByRole('heading', { name: 'Einstellungen', level: 1 })).toBeVisible();

	await page.goto('/');
	await addTask(page, 'Milch');
	await column(page).getByRole('button', { name: 'Milch', exact: true }).click();
	await planTomorrowAt14(page);
	await expect(row(page, 'Milch')).toContainText('Morgen 14:00');
	await expect(row(page, 'Milch')).not.toContainText('PM');
	await context.close();
});
