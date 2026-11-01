import type { ServerInit } from '@sveltejs/kit/hooks';
import { initDb } from '#lib/server/db.js';

export const init: ServerInit = () => {
	initDb();
};
