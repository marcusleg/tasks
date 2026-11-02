import { json } from '@sveltejs/kit';
import { getAuthConfig } from '#lib/server/auth/config.js';
import { createCalendarLink, serializeCalendarLink } from '#lib/server/calendar-links.js';
import {
	optionalBoolean,
	optionalStringList,
	readJson,
	requiredString,
	withInputErrors
} from '#lib/server/http.js';
import { userScope } from '#lib/server/scope.js';
import type { RequestHandler } from './$types';

/** Creates a Calendar Link: `{ name, allLists?, listIds? }` → `{ calendarLink }`. */
export const POST: RequestHandler = async ({ locals, request }) => {
	const scope = userScope(locals);
	const body = await readJson(request);
	const input = {
		name: requiredString(body, 'name'),
		allLists: optionalBoolean(body, 'allLists'),
		listIds: optionalStringList(body, 'listIds')
	};
	const link = withInputErrors(() => createCalendarLink(scope, input));
	return json(
		{ calendarLink: serializeCalendarLink(link, getAuthConfig().origin) },
		{ status: 201 }
	);
};
