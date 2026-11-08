/**
 * Short-lived messages at the bottom of the screen, announced through a live region: failed
 * requests, and the Undo offered after completing, deleting or moving a Task (#14).
 *
 * Each toast dismisses itself after {@link DISMISS_AFTER_MS}; the countdown pauses while the
 * toast is hovered or has focus. There is at most one toast with an action: a new one replaces
 * it, and the replaced action is then final.
 */
import { getContext, setContext } from 'svelte';
import { m } from '#lib/paraglide/messages.js';

export interface ToastAction {
	/** The button's text, e.g. "Undo". */
	label: string;
	run: () => void;
}

export interface Toast {
	id: number;
	message: string;
	action?: ToastAction;
}

export const DISMISS_AFTER_MS = 6000;

interface Countdown {
	/** Milliseconds left while paused, or since `startedAt` while running. */
	remaining: number;
	startedAt: number;
	timer: ReturnType<typeof setTimeout> | undefined;
	/** Pause reasons (hover, focus); the countdown runs while there are none. */
	holds: Set<string>;
}

export class Toasts {
	items = $state<Toast[]>([]);
	readonly #dismissAfterMs: number;
	#nextId = 1;
	// Timer bookkeeping, never rendered: plain collections on purpose.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	#countdowns = new Map<number, Countdown>();

	constructor(dismissAfterMs = DISMISS_AFTER_MS) {
		this.#dismissAfterMs = dismissAfterMs;
	}

	/** Shows a message, optionally with an action button. Returns the toast's id. */
	show(message: string, action?: ToastAction): number {
		const id = this.#nextId++;
		if (action) {
			const previous = this.actionable;
			if (previous) this.dismiss(previous.id);
		}
		this.items = [...this.items, { id, message, ...(action && { action }) }];
		const countdown: Countdown = {
			remaining: this.#dismissAfterMs,
			startedAt: 0,
			timer: undefined,
			// eslint-disable-next-line svelte/prefer-svelte-reactivity
			holds: new Set()
		};
		this.#countdowns.set(id, countdown);
		this.#run(id, countdown);
		return id;
	}

	/** Shows a message with an "Undo" button that calls `undo`. Returns the toast's id. */
	undoable(message: string, undo: () => void): number {
		return this.show(message, { label: m.toast_undo(), run: undo });
	}

	/** Reports a failed request; `what` names the action in the User's Language, e.g. "add the task". */
	failed(what: string, cause: unknown): void {
		console.error(`Couldn't ${what}`, cause);
		const detail = cause instanceof Error && cause.message ? ` ${cause.message}.` : '';
		this.show(`${m.toast_failed({ what })}${detail}`);
	}

	/** The toast with an action button, if one is showing. */
	get actionable(): Toast | undefined {
		return this.items.find((toast) => toast.action);
	}

	/** Runs a toast's action and dismisses it. */
	act(id: number): void {
		const toast = this.items.find((item) => item.id === id);
		if (!toast?.action) return;
		this.dismiss(id);
		toast.action.run();
	}

	/** Runs the current action (e.g. Undo from Ctrl+Z). Returns whether there was one. */
	actCurrent(): boolean {
		const toast = this.actionable;
		if (!toast) return false;
		this.act(toast.id);
		return true;
	}

	dismiss(id: number): void {
		const countdown = this.#countdowns.get(id);
		if (countdown) clearTimeout(countdown.timer);
		this.#countdowns.delete(id);
		this.items = this.items.filter((toast) => toast.id !== id);
	}

	/** Stops a toast's countdown while `reason` (e.g. "hover", "focus") holds. */
	pause(id: number, reason: string): void {
		const countdown = this.#countdowns.get(id);
		if (!countdown || countdown.holds.has(reason)) return;
		countdown.holds.add(reason);
		if (countdown.holds.size === 1) {
			clearTimeout(countdown.timer);
			countdown.remaining -= Date.now() - countdown.startedAt;
		}
	}

	/** Resumes a toast's countdown once no reason to pause it is left. */
	resume(id: number, reason: string): void {
		const countdown = this.#countdowns.get(id);
		if (!countdown?.holds.delete(reason) || countdown.holds.size > 0) return;
		this.#run(id, countdown);
	}

	#run(id: number, countdown: Countdown): void {
		countdown.startedAt = Date.now();
		countdown.timer = setTimeout(() => this.dismiss(id), Math.max(0, countdown.remaining));
	}
}

const KEY = Symbol('toasts');

export function setToasts(toasts: Toasts): Toasts {
	return setContext(KEY, toasts);
}

export function getToasts(): Toasts {
	return getContext<Toasts>(KEY);
}
