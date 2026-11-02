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
 *   panel closes ({@link EditScopes}), and the panel says what it remembers. Deleting is always
 *   asked.
 * - Cancel discards the edit.
 */
import { getContext, setContext } from 'svelte';
import type { ApplyTo } from '#lib/domain/recurring-tasks.js';
import type { SerializedTask } from '#lib/domain/tasks.js';

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

/**
 * One detail panel's answers: asked once per field group, then reused until the panel closes.
 * Every change made in a Subtask's panel is a Subtask change of the recurring parent.
 */
export class EditScopes {
	chosen = $state<Partial<Record<ScopeGroup, ApplyTo>>>({});
	readonly #prompt: ScopePrompt;
	readonly #target: () => SeriesTarget | null;

	constructor(prompt: ScopePrompt, target: () => SeriesTarget | null) {
		this.#prompt = prompt;
		this.#target = target;
	}

	get target(): SeriesTarget | null {
		return this.#target();
	}

	#group(group: ScopeGroup, target: SeriesTarget): ScopeGroup {
		return target.subtask ? 'subtasks' : group;
	}

	/** Whether a change in `group` would have to be asked about first. */
	unanswered(group: ScopeGroup): boolean {
		const target = this.#target();
		return target !== null && this.chosen[this.#group(group, target)] === undefined;
	}

	/**
	 * Which Occurrences a change in `group` applies to: `undefined` when the Task doesn't recur
	 * (nothing to ask), `null` when the User cancelled.
	 */
	async choose(group: ScopeGroup): Promise<ApplyTo | null | undefined> {
		const target = this.#target();
		if (!target) return undefined;
		const key = this.#group(group, target);
		const known = this.chosen[key];
		if (known) return known;
		const choice = await this.#prompt.ask({
			action: 'edit',
			seriesTitle: target.series.title,
			subtaskTitle: target.subtask?.title,
			remembersFor: SCOPE_GROUP_LABELS[key]
		});
		if (choice) this.chosen = { ...this.chosen, [key]: choice };
		return choice;
	}

	/** Asks again next time. */
	forget(): void {
		this.chosen = {};
	}
}

/** Asks whether deleting `target` skips This Occurrence or deletes this and all future ones. */
export function askDeleteScope(prompt: ScopePrompt, target: SeriesTarget): Promise<ApplyTo | null> {
	return prompt.ask({
		action: 'delete',
		seriesTitle: target.series.title,
		subtaskTitle: target.subtask?.title
	});
}

/** Asks about a one-off edit outside the detail panel (e.g. the Priority picker on a row). */
export function askEditScope(prompt: ScopePrompt, target: SeriesTarget): Promise<ApplyTo | null> {
	return prompt.ask({
		action: 'edit',
		seriesTitle: target.series.title,
		subtaskTitle: target.subtask?.title
	});
}

const KEY = Symbol('scope-prompt');

export function setScopePrompt(prompt: ScopePrompt): ScopePrompt {
	return setContext(KEY, prompt);
}

export function getScopePrompt(): ScopePrompt {
	return getContext<ScopePrompt>(KEY);
}
