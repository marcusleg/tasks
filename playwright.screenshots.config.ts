import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * Retakes the README screenshots (e2e/readme-screenshots.shot.ts): `npm run screenshots`. Same
 * servers as the e2e suite, which only runs `*.e2e.ts` and so never picks this up.
 */
export default defineConfig({
	...base,
	testMatch: '**/*.shot.ts',
	retries: 0,
	reporter: 'list'
});
