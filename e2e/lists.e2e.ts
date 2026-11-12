import { expect, test } from './fixtures';
import { loginAs } from './auth';
import {
	addTask,
	column,
	createList,
	detailPanel,
	listOption,
	saved,
	sidebar
} from './lists-tasks';

test('a new User sees "My Tasks"', async ({ page }) => {
	await loginAs(page);

	await expect(page.getByRole('heading', { name: 'My Tasks', level: 2 })).toBeVisible();
	await expect(column(page, 'My Tasks').getByText('No tasks yet')).toBeVisible();

	// Signing in again doesn't create a second one.
	await page.reload();
	await expect(sidebar(page).getByRole('link')).toHaveText(['My Tasks', 'Priority', 'Settings']);
});

test.describe('a German browser', () => {
	test.use({ locale: 'de-DE' });

	test('a new User sees "Meine Aufgaben"', async ({ page }) => {
		await loginAs(page);
		// The sidebar's accessible name is in German too (`sidebar()` expects English).
		const nav = page.getByRole('navigation', { name: 'Hauptnavigation' });

		await expect(page.getByRole('heading', { name: 'Meine Aufgaben', level: 2 })).toBeVisible();
		await expect(column(page, 'Meine Aufgaben')).toBeVisible();

		// Signing in again doesn't create a second one.
		await page.reload();
		await expect(nav.getByRole('link')).toHaveText([
			'Meine Aufgaben',
			'Priorität',
			'Einstellungen'
		]);
	});
});

test('create, rename and delete Lists', async ({ page }) => {
	await loginAs(page);

	await createList(page, 'Groceries');
	await expect(page).toHaveURL(/\/#[0-9a-f-]{36}$/);
	await createList(page, 'Work');
	await expect(sidebar(page).getByRole('list').first().getByRole('link')).toHaveText([
		'My Tasks',
		'Groceries',
		'Work'
	]);

	await sidebar(page).getByRole('link', { name: 'Groceries' }).click();
	await addTask(page, 'Milk');
	await listOption(page, 'Groceries', 'Rename list');
	const nameField = page.getByRole('textbox', { name: 'List name' });
	await expect(nameField).toBeFocused();
	await saved(page, async () => {
		await nameField.fill('Shopping');
		await page.keyboard.press('Enter');
	});
	await expect(page.getByRole('heading', { name: 'Shopping', level: 2 })).toBeVisible();
	await expect(sidebar(page).getByRole('link', { name: 'Shopping' })).toBeVisible();

	// Esc cancels a rename.
	await listOption(page, 'Shopping', 'Rename list');
	await nameField.fill('Nope');
	await page.keyboard.press('Escape');
	await expect(page.getByRole('heading', { name: 'Shopping', level: 2 })).toBeVisible();

	await page.reload();
	await expect(page.getByRole('heading', { name: 'Shopping', level: 2 })).toBeVisible();

	// Deleting asks first; cancelling keeps the List.
	await listOption(page, 'Shopping', 'Delete list');
	const dialog = page.getByRole('dialog', { name: 'Delete “Shopping”?' });
	await expect(dialog).toBeVisible();
	await dialog.getByRole('button', { name: 'Cancel' }).click();
	await expect(dialog).toBeHidden();
	await expect(sidebar(page).getByRole('link', { name: 'Shopping' })).toBeVisible();

	await listOption(page, 'Shopping', 'Delete list');
	await saved(page, () => dialog.getByRole('button', { name: 'Delete list' }).click());
	await expect(sidebar(page).getByRole('link', { name: 'Shopping' })).toBeHidden();
	await expect(column(page, 'Shopping')).toHaveCount(0);
	await expect(page.getByRole('heading', { level: 2, name: 'My Tasks' })).toBeVisible();

	// The List and its Tasks are gone.
	await page.reload();
	await expect(column(page, 'Shopping')).toHaveCount(0);
	await expect(page.getByText('Milk')).toHaveCount(0);
});

test('deleting a List closes the open panel of one of its Tasks', async ({ page }) => {
	await page.setViewportSize({ width: 1600, height: 900 });
	await loginAs(page);
	await createList(page, 'Groceries');
	await addTask(page, 'Milk');
	await column(page, 'Groceries').getByRole('button', { name: 'Milk', exact: true }).click();
	await expect(detailPanel(page)).toBeVisible();

	await listOption(page, 'Groceries', 'Delete list');
	const dialog = page.getByRole('dialog', { name: 'Delete “Groceries”?' });
	await saved(page, () => dialog.getByRole('button', { name: 'Delete list' }).click());
	await expect(column(page, 'Groceries')).toHaveCount(0);
	await expect(detailPanel(page)).toBeHidden();
});

test('two Users only ever see their own Lists', async ({ browser }) => {
	const alice = await (await browser.newContext()).newPage();
	const bob = await (await browser.newContext()).newPage();
	await loginAs(alice, { name: 'Alice' });
	await loginAs(bob, { name: 'Bob' });

	await createList(alice, 'Alice secret');
	await addTask(alice, 'Alice task');
	const aliceListUrl = alice.url();
	await createList(bob, 'Bob stuff');

	await bob.reload();
	await expect(sidebar(bob).getByRole('list').first().getByRole('link')).toHaveText([
		'My Tasks',
		'Bob stuff'
	]);

	// Nor can they change them through the API.
	const listId = new URL(aliceListUrl).hash.slice(1);
	const rename = await bob.request.patch(`/api/lists/${listId}`, {
		data: { name: 'Hacked' },
		headers: { 'content-type': 'application/json' }
	});
	expect(rename.status()).toBe(404);
	await alice.reload();
	await expect(alice.getByRole('heading', { name: 'Alice secret', level: 2 })).toBeVisible();
});

test('the API rejects anonymous requests with 401', async ({ request }) => {
	const response = await request.post('/api/lists', {
		data: { name: 'Nope' },
		headers: { 'content-type': 'application/json' }
	});

	expect(response.status()).toBe(401);
});

test('a failed List change toasts and the name rolls back', async ({ page }) => {
	await loginAs(page);
	await createList(page, 'Groceries');
	await page.route('**/api/lists/*', (route) =>
		route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"Boom"}' })
	);

	await listOption(page, 'Groceries', 'Rename list');
	await page.getByRole('textbox', { name: 'List name' }).fill('Shopping');
	await page.keyboard.press('Enter');

	await expect(page.getByRole('status', { name: 'Notifications' })).toContainText(
		"Couldn't save the list. Boom."
	);
	// The optimistic rename is rolled back by reloading the Lists.
	await expect(page.getByRole('heading', { name: 'Groceries', level: 2 })).toBeVisible({
		timeout: 3000
	});
	await expect(sidebar(page).getByRole('link', { name: 'Groceries' })).toBeVisible();
	await expect(sidebar(page).getByRole('link', { name: 'Shopping' })).toBeHidden();
});
