import { expect, test as base } from '@playwright/test';
import { waitForHydrationOnNavigation } from './hydration';

/** Playwright's `test`, with a `page` whose navigations wait for hydration. */
export const test = base.extend({
	page: async ({ page }, use) => {
		await use(waitForHydrationOnNavigation(page));
	}
});

export { expect };
