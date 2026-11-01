import { json } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import { getDb } from '#lib/server/db.js';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = () => {
	try {
		getDb().get(sql`select 1`);
		return json({ status: 'ok' });
	} catch (error) {
		console.error('Health check failed', error);
		return json({ status: 'error' }, { status: 503 });
	}
};
