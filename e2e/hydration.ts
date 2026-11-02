import type { Page, Response } from '@playwright/test';

/**
 * The app marks `<html data-hydrated="true">` once the root layout has mounted. Controls that need
 * client JS are disabled until then (see `hydration.svelte.ts`), so anything that skips
 * actionability checks (`focus()`, `keyboard.press`, assertions on server-rendered state) must wait
 * for it first.
 */
export async function waitForHydration(page: Page): Promise<void> {
	await page.waitForFunction(() => document.documentElement.dataset.hydrated === 'true');
}

const patched = new WeakSet<Page>();

/**
 * Makes `goto`, `reload`, `goBack` and `goForward` resolve only after the loaded HTML page has
 * hydrated. Idempotent.
 */
export function waitForHydrationOnNavigation(page: Page): Page {
	if (patched.has(page)) return page;
	patched.add(page);

	for (const method of ['goto', 'reload', 'goBack', 'goForward'] as const) {
		const original = page[method].bind(page) as (...args: unknown[]) => Promise<Response | null>;
		(page as unknown as Record<string, unknown>)[method] = async (...args: unknown[]) => {
			const response = await original(...args);
			if (response?.headers()['content-type']?.includes('text/html')) await waitForHydration(page);
			return response;
		};
	}
	return page;
}
