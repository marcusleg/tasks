/**
 * A {@link ListPort} for specs that calls the real `/api/lists` endpoint handlers in-process, for
 * one signed-in User (see `in-process-endpoints.ts`, including the `getDb` mock it needs).
 */
import type { ListPort } from '#lib/client/list-port.js';
import type { User } from '#lib/server/db/schema.js';
import { POST as createList } from '../../../routes/api/lists/+server.js';
import {
	DELETE as deleteList,
	PATCH as updateList
} from '../../../routes/api/lists/[id]/+server.js';
import {
	inProcessEndpoints,
	type Handler,
	type InProcessEndpoints
} from './in-process-endpoints.js';

export type InProcessListPort = ListPort &
	Pick<InProcessEndpoints, 'requests' | 'reloads' | 'idle'>;

export function inProcessListPort(
	user: User,
	options: Parameters<typeof inProcessEndpoints>[1] = {}
): InProcessListPort {
	const endpoints = inProcessEndpoints(user, options);
	const { call } = endpoints;
	return {
		get requests() {
			return endpoints.requests;
		},
		get reloads() {
			return endpoints.reloads;
		},
		idle: () => endpoints.idle(),
		reload: () => endpoints.reload(),
		createList: (input) => call(createList as Handler, 'POST', '/api/lists', {}, input),
		updateList: (id, patch) =>
			call(updateList as Handler, 'PATCH', `/api/lists/${id}`, { id }, patch),
		deleteList: (id) => call(deleteList as Handler, 'DELETE', `/api/lists/${id}`, { id })
	};
}
