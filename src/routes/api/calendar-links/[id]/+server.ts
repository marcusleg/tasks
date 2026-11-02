import { json } from '@sveltejs/kit';
import { getAuthConfig } from '#lib/server/auth/config.js';
import {
	deleteCalendarLink,
	serializeCalendarLink,
	updateCalendarLink
} from '#lib/server/calendar-links.js';
import {
	notFound,
	optionalBoolean,
	optionalString,
	optionalStringList,
	readJson,
	withInputErrors
} from '#lib/server/http.js';
import { userScope } from '#lib/server/scope.js';
import type { RequestHandler } from './$types';

/** Changes a Calendar Link: `{ name?, allLists?, listIds? }` → `{ calendarLink }`. */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const scope = userScope(locals);
	const body = await readJson(request);
	const patch = {
		name: optionalString(body, 'name'),
		allLists: optionalBoolean(body, 'allLists'),
		listIds: optionalStringList(body, 'listIds')
	};
	const link = withInputErrors(() => updateCalendarLink(scope, params.id, patch));
	if (!link) notFound('Calendar Link');
	return json({ calendarLink: serializeCalendarLink(link, getAuthConfig().origin) });
};

/** Deletes a Calendar Link; its URL stops working immediately. */
export const DELETE: RequestHandler = ({ locals, params }) => {
	if (!deleteCalendarLink(userScope(locals), params.id)) notFound('Calendar Link');
	return new Response(null, { status: 204 });
};
