/**
 * The browser's copy of the Tasks on screen, with optimistic mutations: each change is applied
 * locally at once, sent to the server, and replaced by what the server answers. If a request
 * fails, the page data is reloaded so the screen matches the server again. Inputs that the User
 * is typing into should keep their own draft rather than bind to the store, so a late answer
 * never overwrites newer keystrokes.
 *
 * Completing, deleting and moving a Task to another List offer Undo in a toast (#14), which puts
 * back the exact previous state through the server: Reopen (which also restores the Subtasks the
 * completion closed, and removes the next Occurrence it created), restoring the deleted Tasks,
 * or moving the Task back to its old Custom Order position.
 *
 * Created by a page from its `load` data and shared with the components below it through
 * context ({@link setTaskStore} / {@link getTaskStore}). The page calls {@link TaskStore.dispose}
 * when it goes away, which withdraws its Undo.
 */
import { getContext, setContext } from 'svelte';
import { invalidate } from '$app/navigation';
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
import { TASKS_DEPENDENCY } from '#lib/dependencies.js';
import type { ApplyTo } from '#lib/domain/recurring-tasks.js';
import { api, type TaskPatch } from './api.js';
import { browserTimeZone } from './clock.svelte.js';
import type { Toasts } from './toasts.svelte.js';

type ById = Record<string, SerializedTask>;

function byId(tasks: SerializedTask[]): ById {
	return Object.fromEntries(tasks.map((task) => [task.id, task]));
}

export class TaskStore {
	readonly #source: () => SerializedTask[];
	readonly #toasts: Toasts;
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
		listName: (id: string) => string | undefined = () => undefined
	) {
		this.#source = source;
		this.#toasts = toasts;
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

	/**
	 * Requests go out one at a time, in order, so e.g. completing a Task that was just added can't
	 * overtake the request that creates it.
	 */
	#queue: Promise<unknown> = Promise.resolve();

	#send(what: string, request: () => Promise<TaskChanges>): Promise<boolean> {
		const result = this.#queue.then(async () => {
			try {
				this.apply(await request());
				return true;
			} catch (cause) {
				this.#toasts.failed(what, cause);
				await invalidate(TASKS_DEPENDENCY);
				return false;
			}
		});
		this.#queue = result;
		return result;
	}

	/**
	 * Adds a Task at the top of a List, or a Subtask at the bottom of its parent's Subtasks.
	 * Returns its id right away. `applyTo` is for a Subtask of a recurring Task (see `api`).
	 */
	add(listId: string, title: string, parentId: string | null = null, applyTo?: ApplyTo): string {
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
			api.createTask({ id, listId, title, parentId, ...(applyTo && { applyTo }) })
		);
		return id;
	}

	/** `applyTo`: which Occurrences of a recurring Task (or its Subtasks) the change reaches. */
	update(id: string, patch: TaskPatch, applyTo?: ApplyTo): Promise<boolean> {
		this.#patchLocal(id, patch);
		return this.#send('save the task', () => api.updateTask(id, patch, applyTo));
	}

	/**
	 * Completes a Task and, with it, its open Subtasks (the cascade in `#lib/domain/subtasks`).
	 * The next Occurrence of a recurring Task is created by the server and shows up with its answer.
	 * Undo reopens it, which the server turns back into exactly the state before.
	 */
	complete(id: string): Promise<boolean> {
		const changes = completionChanges(Object.values(this.#tasks), id, timestamp());
		this.#applyCompletion(changes);
		const done = this.#send('complete the task', () => api.completeTask(id, browserTimeZone()));
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
		return this.#send('reopen the task', () => api.reopenTask(id));
	}

	/**
	 * Deletes a Task and its Subtasks. Undo restores them as the server deleted them (same ids,
	 * positions, dates, completion and everything else). `applyTo` "occurrence" skips a recurring
	 * Task's current Occurrence: the next one comes with the server's answer, and Undo puts the
	 * skipped one back in its place.
	 */
	remove(id: string, applyTo?: ApplyTo): Promise<boolean> {
		const local = [this.#tasks[id], ...this.all.filter((task) => task.parentId === id)].filter(
			(task) => task !== undefined
		);
		this.apply({ upserted: [], deleted: local.map((task) => task.id) });
		let removed: SerializedTask[] | undefined;
		let next: string | null = null;
		const done = this.#send('delete the task', async () => {
			const answer = await api.deleteTask(id, { applyTo, timeZone: browserTimeZone() });
			removed = answer.removed;
			next = answer.next;
			return answer;
		});
		this.#offerUndo('Task deleted', done, () => {
			this.apply({ upserted: local, deleted: [] });
			// Queued after the delete, so its answer (with `removed` and `next`) is in by then; the
			// restore's answer removes the next Occurrence it replaces.
			void this.#send('restore the task', () => {
				if (!removed) throw new Error('The task wasn’t deleted');
				return api.restoreTasks(removed, next);
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
	 * is sends nothing. A move to another List offers Undo, which moves the Task back to its old
	 * parent and Custom Order position.
	 */
	move(id: string, move: TaskMove): Promise<boolean> {
		const task = this.#tasks[id];
		const done = this.#move(id, move);
		if (task && task.listId !== move.listId) {
			const back = { listId: task.listId, parentId: task.parentId, position: task.position };
			const name = this.#listName(move.listId);
			this.#offerUndo(name ? `Moved to ${name}` : 'Task moved', done, () => {
				const problem = this.moveError(id, back);
				if (problem) this.#toasts.failed('undo the move', new Error(problem));
				else void this.#move(id, back);
			});
		}
		return done;
	}

	#move(id: string, move: TaskMove): Promise<boolean> {
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
		return this.#send('move the task', () => api.moveTask(id, move));
	}

	/** "Delete all completed" for one List. */
	deleteCompleted(listId: string): Promise<boolean> {
		this.apply({
			upserted: [],
			deleted: this.all
				.filter((task) => task.listId === listId && task.completedAt)
				.map((task) => task.id)
		});
		return this.#send('delete the completed tasks', () => api.deleteCompletedTasks(listId));
	}
}

const KEY = Symbol('task-store');

export function setTaskStore(store: TaskStore): TaskStore {
	return setContext(KEY, store);
}

export function getTaskStore(): TaskStore {
	return getContext<TaskStore>(KEY);
}
