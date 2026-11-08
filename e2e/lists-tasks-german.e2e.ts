import { type Locator, type Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { loginAs } from './auth';
import { waitForHydration } from './hydration';
import { saved } from './lists-tasks';

// Lists and Tasks in German (CONTEXT.md → Language). Dates and Recurrence are not part of this.
test.use({ locale: 'de-DE', timezoneId: 'Europe/Berlin' });

const LIST = 'Einkauf';

test.beforeEach(async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 800 });
	await loginAs(page);
});

const column = (page: Page): Locator => page.getByRole('region', { name: LIST, exact: true });
const toast = (page: Page): Locator =>
	page
		.getByRole('status', { name: 'Benachrichtigungen' })
		.getByRole('group', { name: 'Benachrichtigung' });
const panel = (page: Page): Locator => page.getByRole('complementary', { name: 'Aufgabendetails' });

async function createListAndTask(page: Page, title: string): Promise<void> {
	await page
		.getByRole('navigation', { name: 'Hauptnavigation' })
		.getByRole('button', { name: 'Neue Liste' })
		.click();
	await saved(page, async () => {
		await page.getByRole('textbox', { name: 'Name der neuen Liste' }).fill(LIST);
		await page.keyboard.press('Enter');
	});
	await expect(
		page.locator('[data-column][data-focused]').getByRole('heading', { name: LIST })
	).toBeVisible();
	await waitForHydration(page);
	await saved(page, async () => {
		await column(page).getByRole('textbox', { name: 'Aufgabe hinzufügen' }).fill(title);
		await page.keyboard.press('Enter');
	});
}

test('a List page is German: add, complete, Undo, delete', async ({ page }) => {
	await page.goto('/');
	await createListAndTask(page, 'Milch');

	const open = column(page).getByRole('list', { name: 'Offene Aufgaben' });
	await expect(open.getByRole('checkbox', { name: 'Milch' })).toBeVisible();
	await expect(column(page).getByRole('button', { name: 'Listenoptionen' })).toBeVisible();
	await expect(column(page).getByRole('button', { name: 'Priorität: Keine' })).toBeVisible();

	// Complete, then Undo from the toast.
	await saved(page, () => open.getByRole('checkbox', { name: 'Milch' }).click());
	await expect(toast(page)).toContainText('Aufgabe erledigt');
	await expect(column(page).getByText('Alle Aufgaben erledigt')).toBeVisible();
	await expect(column(page).getByText('Erledigt (1)')).toBeVisible();
	await saved(page, () => toast(page).getByRole('button', { name: 'Rückgängig' }).click());
	await expect(open.getByRole('checkbox', { name: 'Milch' })).not.toBeChecked();
	await expect(column(page).getByText('Erledigt (1)')).toBeHidden();

	// The detail panel, apart from dates and Recurrence.
	await column(page).getByRole('button', { name: 'Milch', exact: true }).click();
	await expect(panel(page)).toBeVisible();
	await expect(panel(page).getByRole('button', { name: 'Details schließen' })).toBeVisible();
	await expect(panel(page).getByRole('textbox', { name: 'Titel' })).toHaveValue('Milch');
	await expect(panel(page).getByRole('textbox', { name: 'Details' })).toHaveAttribute(
		'placeholder',
		'Details hinzufügen'
	);
	const priority = panel(page).getByRole('group', { name: 'Priorität' });
	for (const level of ['Keine', 'Niedrig', 'Mittel', 'Hoch']) {
		await expect(priority.getByRole('radio', { name: level })).toBeVisible();
	}
	await expect(panel(page).getByRole('heading', { name: 'Unteraufgaben' })).toBeVisible();
	await expect(panel(page).getByLabel('Liste')).toBeVisible();
	await expect(panel(page).getByRole('button', { name: 'Aufgabe löschen' })).toBeVisible();
	await expect(panel(page).getByRole('button', { name: 'Als erledigt markieren' })).toBeVisible();

	// A Subtask and its progress.
	await saved(page, async () => {
		await panel(page).getByRole('textbox', { name: 'Unteraufgabe hinzufügen' }).fill('Bio');
		await page.keyboard.press('Enter');
	});
	await expect(panel(page).getByText('0/1')).toBeVisible();
	await saved(page, () => priority.getByText('Hoch').click());
	await expect(column(page).getByRole('button', { name: 'Priorität: Hoch' })).toBeVisible();
	await expect(
		column(page).getByRole('button', { name: 'Unteraufgaben von Milch' })
	).toHaveAttribute('title', '0 von 1 Unteraufgabe erledigt');
	await expect(column(page).getByRole('list', { name: 'Unteraufgaben von Milch' })).toBeAttached();

	// Delete with Undo.
	await saved(page, () => panel(page).getByRole('button', { name: 'Aufgabe löschen' }).click());
	await expect(toast(page)).toContainText('Aufgabe gelöscht');
	await expect(column(page).getByText('Noch keine Aufgaben')).toBeVisible();
	await saved(page, () => toast(page).getByRole('button', { name: 'Rückgängig' }).click());
	await expect(column(page).getByRole('button', { name: 'Milch', exact: true })).toBeVisible();
});

test('the List menu, its confirm dialogs and the Priority View are German', async ({ page }) => {
	await page.goto('/');
	await createListAndTask(page, 'Brot');
	await saved(page, () => column(page).getByRole('checkbox', { name: 'Brot' }).click());

	await column(page).getByRole('button', { name: 'Listenoptionen' }).click();
	await expect(column(page).getByRole('group', { name: 'Sortierung' })).toBeVisible();
	for (const mode of ['Eigene Reihenfolge', 'Geplant', 'Fällig', 'Priorität', 'Titel']) {
		await expect(column(page).getByRole('button', { name: mode })).toBeVisible();
	}
	await expect(column(page).getByRole('button', { name: 'Liste umbenennen' })).toBeVisible();

	await column(page).getByRole('button', { name: 'Alle erledigten löschen' }).click();
	const dialog = page.getByRole('dialog', { name: 'Alle erledigten Aufgaben löschen?' });
	await expect(dialog).toContainText('1 erledigte Aufgabe in „Einkauf“ wird gelöscht.');
	await dialog.getByRole('button', { name: 'Abbrechen' }).click();
	await expect(dialog).toBeHidden();

	await column(page).getByRole('button', { name: 'Listenoptionen' }).click();
	await column(page).getByRole('button', { name: 'Liste löschen' }).click();
	const confirm = page.getByRole('dialog', { name: '„Einkauf“ löschen?' });
	await expect(confirm).toContainText('Die Liste und alle ihre Aufgaben werden gelöscht.');
	await confirm.getByRole('button', { name: 'Abbrechen' }).click();

	await page.goto('/priority');
	await expect(page).toHaveTitle('Priorität · Tasks');
	for (const level of ['Hoch', 'Mittel', 'Niedrig']) {
		await expect(page.getByRole('heading', { name: level })).toBeVisible();
	}
	await expect(page.getByText('Keine Aufgaben mit hoher Priorität')).toBeVisible();
});
