/**
 * Short-lived messages at the bottom of the screen, announced through a live region. For now
 * they report failed requests; #14 adds Undo actions.
 */
import { getContext, setContext } from 'svelte';

export interface Toast {
	id: number;
	message: string;
}

const DISMISS_AFTER_MS = 6000;

export class Toasts {
	items = $state<Toast[]>([]);
	#nextId = 1;

	show(message: string): void {
		const id = this.#nextId++;
		this.items = [...this.items, { id, message }];
		setTimeout(() => this.dismiss(id), DISMISS_AFTER_MS);
	}

	/** Reports a failed request; `what` completes "Couldn't …", e.g. "add the task". */
	failed(what: string, cause: unknown): void {
		console.error(`Couldn't ${what}`, cause);
		const detail = cause instanceof Error && cause.message ? ` ${cause.message}.` : '';
		this.show(`Couldn't ${what}.${detail}`);
	}

	dismiss(id: number): void {
		this.items = this.items.filter((toast) => toast.id !== id);
	}
}

const KEY = Symbol('toasts');

export function setToasts(toasts: Toasts): Toasts {
	return setContext(KEY, toasts);
}

export function getToasts(): Toasts {
	return getContext<Toasts>(KEY);
}
