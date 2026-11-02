import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig, devices } from '@playwright/test';
import {
	allowedGroup,
	appOrigin,
	appPort,
	oidcClientId,
	oidcClientSecret,
	oidcIssuer,
	oidcPort
} from './e2e/env';

// Every run gets a fresh database. Set once in the main process so workers,
// which re-evaluate this file, inherit the same path.
process.env.E2E_DATABASE_PATH ??= join(mkdtempSync(join(tmpdir(), 'tasks-e2e-')), 'tasks.db');

export default defineConfig({
	testDir: 'e2e',
	testMatch: '**/*.e2e.ts',
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
	use: {
		baseURL: appOrigin,
		// adapter-node assumes https unless PROTOCOL_HEADER says otherwise, which
		// would make SvelteKit's CSRF origin check reject every form post over
		// plain http. Play the reverse proxy's part (see "Reverse proxy" in the README).
		extraHTTPHeaders: { 'x-forwarded-proto': 'http' }
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: [
		{
			command: 'node e2e/oidc-mock.ts',
			url: `${oidcIssuer}/.well-known/openid-configuration`,
			reuseExistingServer: false,
			env: {
				E2E_OIDC_PORT: String(oidcPort),
				MOCK_OIDC_CLIENT_ID: oidcClientId,
				MOCK_OIDC_CLIENT_SECRET: oidcClientSecret
			}
		},
		{
			command: 'npm run build && node build',
			url: `${appOrigin}/healthz`,
			reuseExistingServer: false,
			timeout: 120_000,
			env: {
				PORT: String(appPort),
				DATABASE_PATH: process.env.E2E_DATABASE_PATH,
				ORIGIN: appOrigin,
				PROTOCOL_HEADER: 'x-forwarded-proto',
				OIDC_ISSUER: oidcIssuer,
				OIDC_CLIENT_ID: oidcClientId,
				OIDC_CLIENT_SECRET: oidcClientSecret,
				OIDC_ALLOWED_GROUP: allowedGroup
			}
		}
	]
});
