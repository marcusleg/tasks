/**
 * The part of a store's optimistic protocol (ADR 0003) that comes after the local change: send
 * the request, replace the local copy with the server's answer, and recover if it fails. Shared
 * by {@link TaskStore} and {@link ListStore}.
 *
 * Requests go out one at a time, in the order they were queued, so e.g. completing a Task that
 * was just added can't overtake the request that creates it. A request that fails shows a toast
 * and reloads the page data; the requests queued behind it still go out.
 */
import type { Toasts } from './toasts.svelte.js';

export class OptimisticQueue {
	readonly #toasts: Toasts;
	readonly #reload: () => Promise<unknown>;
	#last: Promise<unknown> = Promise.resolve();

	/** `reload` reloads the page data, so the store's copy matches the server again. */
	constructor(toasts: Toasts, reload: () => Promise<unknown>) {
		this.#toasts = toasts;
		this.#reload = reload;
	}

	/**
	 * Queues `request`; when it answers, hands the answer to `apply`. `what` completes "Couldn't …"
	 * in the toast. Resolves to whether it worked (a failure in `apply` counts as a failure).
	 */
	send<Answer>(
		what: string,
		request: () => Promise<Answer>,
		apply: (answer: Answer) => void
	): Promise<boolean> {
		const result = this.#last.then(async () => {
			try {
				apply(await request());
				return true;
			} catch (cause) {
				this.#toasts.failed(what, cause);
				await this.#reload();
				return false;
			}
		});
		this.#last = result;
		return result;
	}
}
