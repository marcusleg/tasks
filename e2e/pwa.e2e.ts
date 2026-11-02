import { expect, test } from './fixtures';
import { loginAs } from './auth';

test('manifest is served without a session', async ({ request }) => {
	const response = await request.get('/manifest.webmanifest');

	expect(response.status()).toBe(200);
	expect(response.headers()['content-type']).toContain('application/manifest+json');
	const manifest = await response.json();
	expect(manifest).toMatchObject({
		name: 'Tasks',
		short_name: 'Tasks',
		start_url: '/',
		scope: '/',
		display: 'standalone'
	});
	expect(manifest.icons.map((icon: { src: string }) => icon.src)).toEqual(
		expect.arrayContaining(['/icon-192.png', '/icon-512.png', '/icon-maskable-512.png'])
	);
});

test('icons are served without a session', async ({ request }) => {
	for (const path of [
		'/icon-192.png',
		'/icon-512.png',
		'/icon-maskable-512.png',
		'/apple-touch-icon.png',
		'/favicon.svg'
	]) {
		const response = await request.get(path);
		expect(response.status(), path).toBe(200);
	}
});

test('home page links the manifest', async ({ page }) => {
	await loginAs(page);

	await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
		'href',
		'/manifest.webmanifest'
	);
});
