/**
 * Asking which Occurrences of a recurring Task a change applies to: "This Occurrence" or "This and
 * all future" (CONTEXT.md → Occurrence, #17). One {@link ScopePrompt} per app shows the question
 * (`ScopeDialog.svelte` in the layout); it outlives the detail panel, so an edit flushed while the
 * panel closes can still be asked about.
 *
 * Decisions:
 * - Only edits to an open recurring Task, or to a Subtask of one, are asked about. Completing or
 *   reopening never is, nor is changing the Recurrence itself (always this and all future), nor
 *   moving (a Subtask moved in or out changes This Occurrence only; see `moveTask`).
 * - An edit is asked about when it is committed (blur, Enter, a pick), not per keystroke.
 * - In the detail panel, the answer is remembered per field group ({@link ScopeGroup}) until the
 *   panel closes ({@link ScopedTasks}), and the panel says what it remembers. Deleting is always
 *   asked.
 * - Cancel discards the edit.
 * - Callers hand changes to {@link ScopedTasks}; the store won't take one without a {@link Scope},
 *   which only that class makes, so forgetting to ask can't fall back to the server's default.
 */
import { getContext, setContext } from 'svelte';
import type { ApplyTo } from '#lib/domain/recurring-tasks.js';
import type { SerializedTask } from '#lib/domain/tasks.js';
import type { TaskPatch } from './task-port.js';

export type { ApplyTo };

export interface ScopeQuestion {
	action: 'edit' | 'delete';
	/** The recurring Task's Title. */
	seriesTitle: string;
	/** The Subtask's Title, when the change is to a Subtask of the recurring Task. */
	subtaskTitle?: string;
	/** What the answer is remembered for in the open panel, e.g. "date changes". */
	remembersFor?: string;
}

export class ScopePrompt {
	/** The question on screen, if any. */
	question = $state<ScopeQuestion | null>(null);
	#resolve: ((choice: ApplyTo | null) => void) | null = null;
	#queue: Promise<unknown> = Promise.resolve();

	/** Asks a question (after any already open); resolves to the choice, or `null` for Cancel. */
	ask(question: ScopeQuestion): Promise<ApplyTo | null> {
		const answer = this.#queue.then(
			() =>
				new Promise<ApplyTo | null>((resolve) => {
					this.question = question;
					this.#resolve = resolve;
				})
		);
		this.#queue = answer;
		return answer;
	}

	answer(choice: ApplyTo | null): void {
		const resolve = this.#resolve;
		this.#resolve = null;
		this.question = null;
		resolve?.(choice);
	}
}

/** The recurring Task a change to `task` concerns, or `null` when none is. */
export interface SeriesTarget {
	series: SerializedTask;
	/** The changed Subtask of `series`, if the change isn't to `series` itself. */
	subtask?: SerializedTask;
}

/**
 * The recurring Task a change to `task` concerns: the Task itself while it is an open Occurrence,
 * or its parent while that is one. `null` otherwise, and nothing needs asking.
 */
export function seriesTarget(
	task: SerializedTask | undefined,
	parent: SerializedTask | undefined
): SeriesTarget | null {
	if (!task || task.completedAt) return null;
	if (task.recurrence) return { series: task };
	if (parent?.recurrence && !parent.completedAt) return { series: parent, subtask: task };
	return null;
}

/** Field groups whose answer the detail panel remembers separately. */
export type ScopeGroup = 'details' | 'dates' | 'subtasks';

export const SCOPE_GROUP_LABELS: Record<ScopeGroup, string> = {
	details: 'title, details and priority changes',
	dates: 'date changes',
	subtasks: 'subtask changes'
};

declare const decided: unique symbol;

/**
 * Which Occurrences a change reaches, as decided by {@link ScopedTasks}: the answer, or nothing
 * for a Task that doesn't recur. `TaskStore`'s add, update and remove require one, and only this
 * module can make one.
 */
export interface Scope {
	readonly [decided]: true;
	readonly applyTo: ApplyTo | undefined;
}

function decide(applyTo?: ApplyTo): Scope {
	return { applyTo } as Scope;
}

/** The part of `TaskStore` that {@link ScopedTasks} sends changes through. */
export interface ScopedStore {
	get(id: string | null | undefined): SerializedTask | undefined;
	add(listId: string, title: string, parentId: string | null, scope: Scope): string;
	update(id: string, patch: TaskPatch, scope: Scope): Promise<boolean>;
	remove(id: string, scope: Scope): Promise<boolean>;
}

export interface UpdateOptions {
	/** The field group the change belongs to (default `details`); a Subtask's are all `subtasks`. */
	group?: ScopeGroup;
	/** Called when the User cancels, to put drafts and pickers back to the saved value. */
	discard: () => void;
}

/**
 * Every add, update and delete of a Task goes through here: it asks (via the {@link ScopePrompt})
 * which Occurrences a change to a recurring Task, or a Subtask of one, applies to, and sends it to
 * the store with the answer. Cancel discards the change.
 *
 * With `remembers` (one per detail panel), an answer is kept per {@link ScopeGroup} until the
 * panel closes or {@link forget}. Every change made in a Subtask's panel is a `subtasks` change.
 * Targets are read from the store when the change is committed, not when the panel was opened, so
 * an edit flushed while the panel closes is still asked about.
 */
export class ScopedTasks {
	chosen = $state<Partial<Record<ScopeGroup, ApplyTo>>>({});
	readonly #prompt: Pick<ScopePrompt, 'ask'>;
	readonly #store: ScopedStore;
	readonly #remembers: boolean;

	constructor(
		prompt: Pick<ScopePrompt, 'ask'>,
		store: ScopedStore,
		options: { remembers?: boolean } = {}
	) {
		this.#prompt = prompt;
		this.#store = store;
		this.#remembers = options.remembers ?? false;
	}

	/** The recurring Task a change to `id` concerns, if any. */
	target(id: string): SeriesTarget | null {
		const task = this.#store.get(id);
		return seriesTarget(task, this.#store.get(task?.parentId));
	}

	/** Whether a change to `id` in `group` would have to be asked about first. */
	unanswered(id: string, group: ScopeGroup): boolean {
		const target = this.target(id);
		return target !== null && this.chosen[this.#key(group, target)] === undefined;
	}

	/** Asks again next time. */
	forget(): void {
		this.chosen = {};
	}

	/**
	 * Updates a Task's title, description, dates or priority (its Recurrence goes through
	 * {@link setRecurrence}). `patch` may be a function, called once the scope is known, returning
	 * what to send (or `null` for nothing). Cancelled: nothing is sent and `discard` is called.
	 */
	async update(
		id: string,
		patch: TaskPatch | (() => TaskPatch | null),
		options: UpdateOptions
	): Promise<void> {
		const scope = await this.#decide(options.group ?? 'details', this.target(id));
		if (!scope) return options.discard();
		const resolved = typeof patch === 'function' ? patch() : patch;
		if (resolved) void this.#store.update(id, resolved, scope);
	}

	/**
	 * Adds a Task to a List, or a Subtask under `parentId`; a Subtask of a recurring Task asks
	 * first. Resolves to the new id, or `null` when cancelled (the caller keeps its draft).
	 */
	async add(listId: string, title: string, parentId: string | null = null): Promise<string | null> {
		const series = parentId === null ? null : seriesTarget(this.#store.get(parentId), undefined);
		const scope = await this.#decide('subtasks', series);
		return scope ? this.#store.add(listId, title, parentId, scope) : null;
	}

	/**
	 * Deletes a Task; a recurring one (or a Subtask of one) always asks, and the answer isn't
	 * remembered. `onConfirmed` runs once it's decided, before the delete is sent. Resolves to
	 * whether it was deleted.
	 */
	async remove(id: string, onConfirmed?: () => void): Promise<boolean> {
		const target = this.target(id);
		let applyTo: ApplyTo | null | undefined;
		if (target) {
			applyTo = await this.#prompt.ask({
				action: 'delete',
				seriesTitle: target.series.title,
				subtaskTitle: target.subtask?.title
			});
			if (applyTo === null) return false;
		}
		onConfirmed?.();
		void this.#store.remove(id, decide(applyTo ?? undefined));
		return true;
	}

	/** Changes the Recurrence itself: never asked about, always this and all future Occurrences. */
	setRecurrence(id: string, recurrence: TaskPatch['recurrence']): Promise<boolean> {
		return this.#store.update(id, { recurrence }, decide());
	}

	#key(group: ScopeGroup, target: SeriesTarget): ScopeGroup {
		return target.subtask ? 'subtasks' : group;
	}

	/** The scope for a change to `target`, or `null` when the User cancelled. */
	async #decide(group: ScopeGroup, target: SeriesTarget | null): Promise<Scope | null> {
		if (!target) return decide();
		const key = this.#key(group, target);
		const known = this.#remembers ? this.chosen[key] : undefined;
		if (known) return decide(known);
		const choice = await this.#prompt.ask({
			action: 'edit',
			seriesTitle: target.series.title,
			subtaskTitle: target.subtask?.title,
			remembersFor: this.#remembers ? SCOPE_GROUP_LABELS[key] : undefined
		});
		if (!choice) return null;
		if (this.#remembers) this.chosen = { ...this.chosen, [key]: choice };
		return decide(choice);
	}
}

const KEY = Symbol('scope-prompt');

export function setScopePrompt(prompt: ScopePrompt): ScopePrompt {
	return setContext(KEY, prompt);
}

export function getScopePrompt(): ScopePrompt {
	return getContext<ScopePrompt>(KEY);
}
