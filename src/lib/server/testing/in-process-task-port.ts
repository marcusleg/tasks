/**
 * A {@link TaskPort} for specs that calls the real `/api/tasks` endpoint handlers in-process,
 * for one signed-in User. Requests and answers go through JSON text exactly as over HTTP, so a
 * spec sees the serialized shapes the browser would get, not the server's domain objects.
 *
 * The endpoints open the app's database through `getDb`; the spec has to mock `#lib/server/db.js`
 * to hand them its in-memory one:
 *
 *     vi.mock('#lib/server/db.js', () => ({ getDb: () => db }));
 */
import type { RequestEvent } from '@sveltejs/kit';
import type { TaskPort } from '#lib/client/task-port.js';
import type { User } from '#lib/server/db/schema.js';
import { POST as createTask } from '../../../routes/api/tasks/+server.js';
import {
	DELETE as deleteTask,
	PATCH as updateTask
} from '../../../routes/api/tasks/[id]/+server.js';
import { POST as completeTask } from '../../../routes/api/tasks/[id]/complete/+server.js';
import { POST as moveTask } from '../../../routes/api/tasks/[id]/move/+server.js';
import { POST as reopenTask } from '../../../routes/api/tasks/[id]/reopen/+server.js';
import { POST as restoreTasks } from '../../../routes/api/tasks/restore/+server.js';
import { DELETE as deleteCompletedTasks } from '../../../routes/api/lists/[id]/completed-tasks/+server.js';

type Handler = (event: never) => Response | Promise<Response>;

/** A request the port sent, as the endpoint received it. */
export interface SentRequest {
	method: string;
	path: string;
	body: unknown;
}

export interface InProcessTaskPort extends TaskPort {
	/** Every request in the order it reached an endpoint. */
	readonly requests: SentRequest[];
	/** How many times the page data was reloaded. */
	readonly reloads: number;
	/** Resolves once no request is on its way. */
	idle(): Promise<void>;
}

export function inProcessTaskPort(
	user: User,
	options: {
		/** Holds a request back until the returned promise settles (e.g. to keep it in flight). */
		beforeRequest?: (request: SentRequest) => Promise<void> | void;
	} = {}
): InProcessTaskPort {
	const requests: SentRequest[] = [];
	let reloads = 0;
	let inFlight: Promise<unknown>[] = [];

	async function call<T>(
		handler: Handler,
		method: string,
		path: string,
		params: Record<string, string>,
		body?: unknown
	): Promise<T> {
		const url = new URL(`http://localhost${path}`);
		const sent: SentRequest = {
			method,
			path,
			body: body === undefined ? undefined : JSON.parse(JSON.stringify(body))
		};
		const run = (async () => {
			await options.beforeRequest?.(sent);
			requests.push(sent);
			const request = new Request(url, {
				method,
				headers: body === undefined ? {} : { 'content-type': 'application/json' },
				body: body === undefined ? undefined : JSON.stringify(body)
			});
			const event = { locals: { user }, request, url, params } as unknown as RequestEvent;
			let response: Response;
			try {
				response = await handler(event as never);
			} catch (cause) {
				// SvelteKit's `error()`: the browser would get `{ message }` with the status.
				const { status, body } = cause as { status?: number; body?: { message?: string } };
				if (typeof status !== 'number') throw cause;
				throw new Error(body?.message ?? `Request failed (${status})`, { cause });
			}
			if (!response.ok) throw new Error(`Request failed (${response.status})`);
			return (response.status === 204 ? undefined : await response.json()) as T;
		})();
		inFlight.push(run.catch(() => undefined));
		return run;
	}

	return {
		requests,
		get reloads() {
			return reloads;
		},
		async idle() {
			// Requests wait in the store’s queue for a microtask or two before they reach the port.
			await new Promise((resolve) => setTimeout(resolve, 0));
			while (inFlight.length > 0) {
				const waiting = inFlight;
				inFlight = [];
				await Promise.all(waiting);
			}
		},
		createTask: (input) => call(createTask as Handler, 'POST', '/api/tasks', {}, input),
		updateTask: (id, patch, applyTo) =>
			call(updateTask as Handler, 'PATCH', `/api/tasks/${id}`, { id }, { ...patch, applyTo }),
		completeTask: (id, timeZone) =>
			call(completeTask as Handler, 'POST', `/api/tasks/${id}/complete`, { id }, { timeZone }),
		reopenTask: (id) => call(reopenTask as Handler, 'POST', `/api/tasks/${id}/reopen`, { id }, {}),
		deleteTask: (id, { applyTo, timeZone }) => {
			const query = new URLSearchParams();
			if (applyTo) query.set('applyTo', applyTo);
			if (timeZone) query.set('timeZone', timeZone);
			const search = query.size > 0 ? `?${query}` : '';
			return call(deleteTask as Handler, 'DELETE', `/api/tasks/${id}${search}`, { id });
		},
		restoreTasks: (tasks, replaces) =>
			call(
				restoreTasks as Handler,
				'POST',
				'/api/tasks/restore',
				{},
				{
					tasks,
					...(replaces && { replaces })
				}
			),
		moveTask: (id, move) =>
			call(moveTask as Handler, 'POST', `/api/tasks/${id}/move`, { id }, move),
		deleteCompletedTasks: (listId) =>
			call(deleteCompletedTasks as Handler, 'DELETE', `/api/lists/${listId}/completed-tasks`, {
				id: listId
			}),
		async reload() {
			reloads++;
		}
	};
}
