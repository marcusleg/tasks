/**
 * Calls the real `/api/...` endpoint handlers in-process for one signed-in User, for the specs'
 * port adapters (`inProcessTaskPort`, `inProcessListPort`). Requests and answers go through JSON
 * text exactly as over HTTP, so a spec sees the serialized shapes the browser would get, not the
 * server's domain objects.
 *
 * The endpoints open the app's database through `getDb`; the spec has to mock `#lib/server/db.js`
 * to hand them its in-memory one:
 *
 *     vi.mock('#lib/server/db.js', () => ({ getDb: () => db }));
 */
import type { RequestEvent } from '@sveltejs/kit';
import type { User } from '#lib/server/db/schema.js';

export type Handler = (event: never) => Response | Promise<Response>;

/** A request the port sent, as the endpoint received it. */
export interface SentRequest {
	method: string;
	path: string;
	body: unknown;
}

export interface InProcessEndpoints {
	/** Every request in the order it reached an endpoint. */
	readonly requests: SentRequest[];
	/** How many times the page data was reloaded. */
	readonly reloads: number;
	/** What a port's `reload` does in a spec: counts the reload. */
	reload(): Promise<void>;
	/** Resolves once no request is on its way. */
	idle(): Promise<void>;
	call<T>(
		handler: Handler,
		method: string,
		path: string,
		params: Record<string, string>,
		body?: unknown
	): Promise<T>;
}

export function inProcessEndpoints(
	user: User,
	options: {
		/** Holds a request back until the returned promise settles (e.g. to keep it in flight). */
		beforeRequest?: (request: SentRequest) => Promise<void> | void;
	} = {}
): InProcessEndpoints {
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
		async reload() {
			reloads++;
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
		call
	};
}
