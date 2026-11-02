import { error } from '@sveltejs/kit';
import { getAuthConfig } from '#lib/server/auth/config.js';
import { buildCalendarLinkFeed, feedFilename } from '#lib/server/calendar-feed.js';
import { findCalendarLinkByToken, markAccessed } from '#lib/server/calendar-links.js';
import { getDb } from '#lib/server/db.js';
import type { RequestHandler } from './$types';

/** The Calendar Link's feed. Public: the token in the URL is the secret. */
export const GET: RequestHandler = ({ params }) => {
	const db = getDb();
	const link = findCalendarLinkByToken(db, params.token);
	if (!link) error(404);

	const body = buildCalendarLinkFeed(db, link, getAuthConfig().origin);
	markAccessed(db, link.id);
	return new Response(body, {
		headers: {
			'content-type': 'text/calendar; charset=utf-8',
			'cache-control': 'private, max-age=300',
			'content-disposition': `inline; filename="${feedFilename(link.name)}"`
		}
	});
};
