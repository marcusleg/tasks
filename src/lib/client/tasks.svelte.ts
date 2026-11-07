/**
 * The browser's copy of the Tasks on screen, with optimistic mutations: each change is applied
 * locally at once, sent to the server, and replaced by what the server answers. If a request
 * fails, the page data is reloaded so the screen matches the server again. Inputs that the User
 * is typing into should keep their own draft rather than bind to the store, so a late answer
 * never overwrites newer keystrokes.
 *
 * Completing, deleting and moving a Task to another List offer Undo in a toast (#14), which puts
 * back the previous state through the server. Deleting a Task (a Subtask, or skipping an Occurrence
 * included) and moving to another List use the server's Undo (ADR 0004). The others have yet to
 * move to it: Reopen (which also restores the Subtasks the completion closed, and removes the next
 * Occurrence it created).
 *
 * Created by a page from its `load` data and shared with the components below it through
 * context ({@link setTaskStore} / {@link getTaskStore}). The page calls {@link TaskStore.dispose}
 * when it goes away, which withdraws its Undo.
 */
import { getContext, setContext } from 'svelte';
import {
	byCustomOrder,
	completedTasksOf,
	openTasksOf,
	type SerializedTask,
	type TaskChanges
} from '#lib/domain/tasks.js';
import {
	completedGroupsOf,
	completionChanges,
	newTaskPosition,
	reopenChanges,
	subtasksOf,
	type CompletedGroup,
	type CompletionChange
} from '#lib/domain/subtasks.js';
import { moveChanges, moveError, stepMove, type Step, type TaskMove } from '#lib/domain/moves.js';
import { newId, timestamp } from '#lib/domain/validation.js';
import type { TaskPatch, TaskPort } from './task-port.js';
import { browserTimeZone } from './clock.svelte.js';
import type { Scope } from './occurrence-scope.svelte.js';
import { OptimisticQueue } from './optimistic-queue.js';
import type { Toasts } from './toasts.svelte.js';

type ById = Record<string, SerializedTask>;

function byId(tasks: SerializedTask[]): ById {
	return Object.fromEntries(tasks.map((task) => [task.id, task]));
}

export class TaskStore {
	readonly #source: () => SerializedTask[];
	readonly #toasts: Toasts;
	readonly #port: TaskPort;
	readonly #listName: (id: string) => string | undefined;
	/** The toast offering Undo for this store's latest action, if any. */
	#undoToast: number | undefined;
	/** The page data. Only a new array (navigation, invalidation) resets the local copy. */
	#loaded = $derived.by(() => this.#source());
	/** Local copy; overwritten optimistically and by server answers. */
	#tasks = $derived<ById>(byId(this.#loaded));

	constructor(
		source: () => SerializedTask[],
		toasts: Toasts,
		port: TaskPort,
		listName: (id: string) => string | undefined = () => undefined
	) {
		this.#source = source;
		this.#toasts = toasts;
		this.#port = port;
		this.#queue = new OptimisticQueue(toasts, () => port.reload());
		this.#listName = listName;
	}

	/** Withdraws the Undo on offer: the page it would change is gone. */
	dispose(): void {
		if (this.#undoToast !== undefined) this.#toasts.dismiss(this.#undoToast);
		this.#undoToast = undefined;
	}

	/**
	 * Shows an Undo toast for an action (replacing any earlier one, which becomes final), and
	 * withdraws it if the action's request fails.
	 */
	#offerUndo(message: string, done: Promise<boolean>, undo: () => void): void {
		const toast = this.#toasts.undoable(message, undo);
		this.#undoToast = toast;
		void done.then((ok) => {
			if (!ok) this.#toasts.dismiss(toast);
		});
	}

	/** Every Task on screen, in Custom Order. */
	get all(): SerializedTask[] {
		return Object.values(this.#tasks).sort(byCustomOrder);
	}

	get(id: string | null | undefined): SerializedTask | undefined {
		return id ? this.#tasks[id] : undefined;
	}

	/**
	 * A Task as the page data has it, which changes only when that is reloaded, not with this
	 * browser's own edits and their answers.
	 */
	loaded(id: string): SerializedTask | undefined {
		return this.#loaded.find((task) => task.id === id);
	}

	/** The open top-level Tasks of a List, in Custom Order. */
	openTasks(listId: string): SerializedTask[] {
		return openTasksOf(Object.values(this.#tasks), listId);
	}

	/** The Completed top-level Tasks of a List, most recently Completed first. */
	completedTasks(listId: string): SerializedTask[] {
		return completedTasksOf(Object.values(this.#tasks), listId);
	}

	/** The Subtasks of a Task, open and Completed, in Custom Order. */
	subtasks(parentId: string): SerializedTask[] {
		return subtasksOf(Object.values(this.#tasks), parentId);
	}

	/** A List's Completed section: Completed Tasks, and Completed Subtasks of open parents. */
	completedGroups(listId: string): CompletedGroup<SerializedTask>[] {
		return completedGroupsOf(Object.values(this.#tasks), listId);
	}

	/** How many Tasks of a List (Subtasks included) are Completed. */
	completedCount(listId: string): number {
		return Object.values(this.#tasks).filter((task) => task.listId === listId && task.completedAt)
			.length;
	}

	/** Applies a server answer. */
	apply(changes: TaskChanges): void {
		const next = { ...this.#tasks };
		for (const id of changes.deleted) delete next[id];
		for (const task of changes.upserted) next[task.id] = task;
		this.#tasks = next;
	}

	#patchLocal(id: string, patch: Partial<SerializedTask>): void {
		const task = this.#tasks[id];
		if (task) this.#tasks = { ...this.#tasks, [id]: { ...task, ...patch } };
	}

	#applyCompletion(changes: CompletionChange<string>[]): void {
		const next = { ...this.#tasks };
		for (const { id, ...patch } of changes) {
			if (next[id]) next[id] = { ...next[id], ...patch };
		}
		this.#tasks = next;
	}

	/** Requests go out one at a time, in order (see {@link OptimisticQueue}). */
	readonly #queue: OptimisticQueue;

	#send(what: string, request: () => Promise<TaskChanges>): Promise<boolean> {
		return this.#queue.send(what, request, (changes) => this.apply(changes));
	}

	/**
	 * Adds a Task at the top of a List, or a Subtask at the bottom of its parent's Subtasks.
	 * Returns its id right away. `scope` comes from `ScopedTasks`.
	 */
	add(listId: string, title: string, parentId: string | null, scope: Scope): string {
		const id = newId();
		const now = timestamp();
		const siblings = Object.values(this.#tasks).filter(
			(task) => task.listId === listId && task.parentId === parentId
		);
		this.#tasks = {
			...this.#tasks,
			[id]: {
				id,
				listId,
				parentId,
				title: title.trim(),
				description: '',
				position: newTaskPosition(siblings, parentId),
				planned: null,
				due: null,
				priority: null,
				completedAt: null,
				completedByCascade: false,
				recurrence: null,
				seriesId: null,
				occurrencesSoFar: 1,
				generatedFromTaskId: null,
				changedSinceGenerated: false,
				seriesTemplate: null,
				createdAt: now,
				updatedAt: now
			}
		};
		void this.#send('add the task', () =>
			this.#port.createTask({
				id,
				listId,
				title,
				parentId,
				...(scope.applyTo && { applyTo: scope.applyTo })
			})
		);
		return id;
	}

	/** `scope` (from `ScopedTasks`): which Occurrences of a recurring Task the change reaches. */
	update(id: string, patch: TaskPatch, scope: Scope): Promise<boolean> {
		this.#patchLocal(id, patch);
		return this.#send('save the task', () => this.#port.updateTask(id, patch, scope.applyTo));
	}

	/**
	 * Completes a Task and, with it, its open Subtasks (the cascade in `#lib/domain/subtasks`).
	 * The next Occurrence of a recurring Task is created by the server and shows up with its answer.
	 * Undo reopens it, which the server turns back into exactly the state before.
	 */
	complete(id: string): Promise<boolean> {
		const changes = completionChanges(Object.values(this.#tasks), id, timestamp());
		this.#applyCompletion(changes);
		const done = this.#send('complete the task', () =>
			this.#port.completeTask(id, browserTimeZone())
		);
		if (changes.length > 0) this.#offerUndo('Task completed', done, () => void this.reopen(id));
		return done;
	}

	/**
	 * Reopens a Task with the Subtasks its completion closed, or a Subtask with its parent. What
	 * happens to a reopened Occurrence and the current one (CONTEXT.md → Reopen) comes from the
	 * server's answer.
	 */
	reopen(id: string): Promise<boolean> {
		this.#applyCompletion(reopenChanges(Object.values(this.#tasks), id));
		return this.#send('reopen the task', () => this.#port.reopenTask(id));
	}

	/**
	 * Deletes a Task and its Subtasks. `scope` "occurrence" skips a recurring Task's current
	 * Occurrence: the next one comes with the server's answer.
	 *
	 * Undo is the server's (ADR 0004): it puts back everything the delete did, as it was, and what
	 * it did to the parent or the next Occurrence comes with Undo's answer. If the state has moved
	 * on, the failure reloads the page data, which takes the Tasks away again.
	 */
	remove(id: string, scope: Scope): Promise<boolean> {
		const local = [this.#tasks[id], ...this.all.filter((task) => task.parentId === id)].filter(
			(task) => task !== undefined
		);
		this.apply({ upserted: [], deleted: local.map((task) => task.id) });
		let undoId: string | null = null;
		const done = this.#send('delete the task', async () => {
			const answer = await this.#port.deleteTask(id, {
				applyTo: scope.applyTo,
				timeZone: browserTimeZone()
			});
			undoId = answer.undo;
			return answer;
		});
		this.#offerUndo('Task deleted', done, () => {
			this.apply({ upserted: local, deleted: [] });
			// Queued after the delete, so its answer (with `undo`) is in by then.
			void this.#send('undo', () => {
				if (!undoId) throw new Error('The task wasn’t deleted');
				return this.#port.undo(undoId);
			});
		});
		return done;
	}

	/** Why Task `id` can't make `move` (see `moveError`), or `null` if it can. */
	moveError(id: string, move: TaskMove): string | null {
		return moveError(Object.values(this.#tasks), id, move);
	}

	/** The move that takes a Task one step from the keyboard, or `null` (see `stepMove`). */
	stepMove(id: string, step: Step): TaskMove | null {
		return stepMove(Object.values(this.#tasks), id, step);
	}

	/**
	 * Moves a Task in Custom Order: among its siblings, under another Task, out of its parent, or
	 * to another List with its Subtasks (the rules in `#lib/domain/moves`). A move the rules don't
	 * allow is refused without a request and resolves to `false`; a move to where the Task already
	 * is sends nothing. A move to another List offers Undo, which is the server's (ADR 0004): it puts
	 * back the Task (with its Subtasks) and anything the move did to its parent or Occurrences, and
	 * Undo's answer brings the store along.
	 */
	move(id: string, move: TaskMove): Promise<boolean> {
		const task = this.#tasks[id];
		const toAnotherList = task && task.listId !== move.listId;
		const local = toAnotherList
			? [task, ...this.all.filter((subtask) => subtask.parentId === id)]
			: [];
		let undoId: string | null = null;
		const done = this.#move(id, move, (answer) => (undoId = answer.undo));
		if (toAnotherList) {
			const name = this.#listName(move.listId);
			this.#offerUndo(name ? `Moved to ${name}` : 'Task moved', done, () => {
				this.apply({ upserted: local, deleted: [] });
				// Queued after the move, so its answer (with `undo`) is in by then.
				void this.#send('undo', () => {
					if (!undoId) throw new Error('The task wasn’t moved');
					return this.#port.undo(undoId);
				});
			});
		}
		return done;
	}

	/** `onAnswer` gets the server's answer to the move, which carries `undo` for a move to another List. */
	#move(
		id: string,
		move: TaskMove,
		onAnswer?: (answer: TaskChanges & { undo: string | null }) => void
	): Promise<boolean> {
		const all = Object.values(this.#tasks);
		if (moveError(all, id, move)) return Promise.resolve(false);
		const changes = moveChanges(all, id, move);
		const task = this.#tasks[id];
		const unchanged =
			changes.length === 1 &&
			changes[0].listId === task.listId &&
			changes[0].parentId === task.parentId &&
			changes[0].position === task.position;
		if (unchanged) return Promise.resolve(true);
		const next = { ...this.#tasks };
		for (const { id: changed, ...patch } of changes) next[changed] = { ...next[changed], ...patch };
		this.#tasks = next;
		return this.#send('move the task', async () => {
			const answer = await this.#port.moveTask(id, move);
			onAnswer?.(answer);
			return answer;
		});
	}

	/** "Delete all completed" for one List. */
	deleteCompleted(listId: string): Promise<boolean> {
		this.apply({
			upserted: [],
			deleted: this.all
				.filter((task) => task.listId === listId && task.completedAt)
				.map((task) => task.id)
		});
		return this.#send('delete the completed tasks', () => this.#port.deleteCompletedTasks(listId));
	}
}

const KEY = Symbol('task-store');

export function setTaskStore(store: TaskStore): TaskStore {
	return setContext(KEY, store);
}

export function getTaskStore(): TaskStore {
	return getContext<TaskStore>(KEY);
}
