import { expect, test } from '@playwright/test';
import { loginAs } from './auth';
import { addTask, column, createList, listOption, saved, sidebar } from './lists-tasks';

test('a new User sees "My Tasks"', async ({ page }) => {
	await loginAs(page);

	await expect(sidebar(page).getByRole('link', { name: 'My Tasks' })).toHaveAttribute(
		'aria-current',
		'page'
	);
	await expect(page.getByRole('heading', { name: 'My Tasks', level: 2 })).toBeVisible();
	await expect(column(page, 'My Tasks').getByText('No tasks yet')).toBeVisible();

	// Signing in again doesn't create a second one.
	await page.reload();
	await expect(sidebar(page).getByRole('link')).toHaveText(['My Tasks', 'Priority', 'Settings']);
});

test('create, rename and delete Lists', async ({ page }) => {
	await loginAs(page);

	await createList(page, 'Groceries');
	await expect(page).toHaveURL(/\/lists\/[0-9a-f-]{36}$/);
	await createList(page, 'Work');
	await expect(sidebar(page).getByRole('list').first().getByRole('link')).toHaveText([
		'My Tasks',
		'Groceries',
		'Work'
	]);

	await sidebar(page).getByRole('link', { name: 'Groceries' }).click();
	// Every List is a column already; wait until Groceries is the one the page is about.
	await expect(
		page
			.locator('[data-column][data-focused]')
			.getByRole('heading', { name: 'Groceries', level: 2 })
	).toBeVisible();
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
	const shoppingUrl = page.url();

	// Deleting asks first; cancelling keeps the List.
	await listOption(page, 'Shopping', 'Delete list');
	const dialog = page.getByRole('dialog', { name: 'Delete “Shopping”?' });
	await expect(dialog).toBeVisible();
	await dialog.getByRole('button', { name: 'Cancel' }).click();
	await expect(dialog).toBeHidden();
	await expect(sidebar(page).getByRole('link', { name: 'Shopping' })).toBeVisible();

	await listOption(page, 'Shopping', 'Delete list');
	await saved(page, () => dialog.getByRole('button', { name: 'Delete list' }).click());
	await expect(page).toHaveURL(/\/$/);
	await expect(sidebar(page).getByRole('link', { name: 'Shopping' })).toBeHidden();
	await expect(page.getByRole('heading', { level: 2, name: 'My Tasks' })).toBeVisible();

	// The List and its Tasks are gone.
	const response = await page.goto(shoppingUrl);
	expect(response?.status()).toBe(404);
});

test('the last-viewed List is shown at /', async ({ page }) => {
	await loginAs(page);
	await createList(page, 'Work');

	await page.goto('/');

	await expect(page.getByRole('heading', { name: 'Work', level: 2 })).toBeVisible();
	await expect(sidebar(page).getByRole('link', { name: 'Work' })).toHaveAttribute(
		'aria-current',
		'page'
	);
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
	expect((await bob.goto(aliceListUrl))?.status()).toBe(404);
	await expect(bob.getByText('Alice task')).toBeHidden();

	// Nor can they change them through the API.
	const listId = new URL(aliceListUrl).pathname.split('/').at(-1);
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
