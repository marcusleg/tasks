import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';

const port = 4173;

// Every run gets a fresh database. Set once in the main process so workers,
// which re-evaluate this file, inherit the same path.
process.env.E2E_DATABASE_PATH ??= join(mkdtempSync(join(tmpdir(), 'tasks-e2e-')), 'tasks.db');

export default defineConfig({
	testDir: 'e2e',
	testMatch: '**/*.e2e.ts',
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
	use: { baseURL: `http://localhost:${port}` },
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		command: 'npm run build && node build',
		url: `http://localhost:${port}/healthz`,
		reuseExistingServer: false,
		timeout: 120_000,
		env: {
			PORT: String(port),
			DATABASE_PATH: process.env.E2E_DATABASE_PATH
		}
	}
});
