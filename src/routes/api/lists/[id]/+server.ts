import { error, json } from '@sveltejs/kit';
import { isSortMode, serializeList } from '#lib/domain/lists.js';
import {
	notFound,
	optionalBoolean,
	optionalString,
	readJson,
	withInputErrors
} from '#lib/server/http.js';
import { deleteList, updateList } from '#lib/server/lists.js';
import { userScope } from '#lib/server/scope.js';
import type { RequestHandler } from './$types';

/**
 * Changes a List: `{ name?, sortMode?, visible?, before?, after? }` → `{ list }`. `before` or
 * `after` (the id of another List) moves the List next to it.
 */
export const PATCH: RequestHandler = async ({ locals, params, request }) => {
	const scope = userScope(locals);
	const body = await readJson(request);
	const sortMode = optionalString(body, 'sortMode');
	if (sortMode !== undefined && !isSortMode(sortMode)) error(400, 'Unknown sortMode');
	const before = optionalString(body, 'before');
	const after = optionalString(body, 'after');
	if (before !== undefined && after !== undefined) error(400, 'Give before or after, not both');
	const move = before !== undefined ? { before } : after !== undefined ? { after } : undefined;
	const patch = {
		name: optionalString(body, 'name'),
		sortMode,
		visible: optionalBoolean(body, 'visible'),
		move
	};

	const list = withInputErrors(() => updateList(scope, params.id, patch));
	if (!list) notFound('List');
	return json({ list: serializeList(list) });
};

/** Deletes a List and all of its Tasks. */
export const DELETE: RequestHandler = ({ locals, params }) => {
	if (!deleteList(userScope(locals), params.id)) notFound('List');
	return new Response(null, { status: 204 });
};
