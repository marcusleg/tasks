import { json } from '@sveltejs/kit';
import { serializeList } from '#lib/domain/lists.js';
import { optionalString, readJson, requiredString, withInputErrors } from '#lib/server/http.js';
import { createList } from '#lib/server/lists.js';
import { userScope } from '#lib/server/scope.js';
import type { RequestHandler } from './$types';

/** Creates a List at the end: `{ id?, name }` → `{ list }`. */
export const POST: RequestHandler = async ({ locals, request }) => {
	const scope = userScope(locals);
	const body = await readJson(request);
	const input = { id: optionalString(body, 'id'), name: requiredString(body, 'name') };

	const list = withInputErrors(() => createList(scope, input));
	return json({ list: serializeList(list) }, { status: 201 });
};
