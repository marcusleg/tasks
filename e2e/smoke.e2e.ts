import { expect, test } from '@playwright/test';
import { loginAs } from './auth';

test('GET /healthz reports ok', async ({ request }) => {
	const response = await request.get('/healthz');

	expect(response.status()).toBe(200);
	expect(await response.json()).toEqual({ status: 'ok' });
});

test('home page renders', async ({ page }) => {
	await loginAs(page);

	await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible();
});
