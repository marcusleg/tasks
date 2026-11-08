import { sequence, type ServerInit } from '@sveltejs/kit/hooks';
import { getAuthConfig } from '#lib/server/auth/config.js';
import { createAuthHandle } from '#lib/server/auth/guard.js';
import { getDb, initDb } from '#lib/server/db.js';
import { createLanguageHandle } from '#lib/server/language.js';

export const init: ServerInit = () => {
	// Fail fast: without the OIDC settings nobody could ever sign in.
	getAuthConfig();
	initDb();
};

export const handle = sequence(
	createAuthHandle({ db: getDb, config: getAuthConfig }),
	// After auth, so a User's stored choice can come from `locals.user`.
	createLanguageHandle({ preference: () => 'automatic' })
);
