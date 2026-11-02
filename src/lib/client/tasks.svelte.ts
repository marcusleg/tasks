/**
 * The browser's copy of the Tasks on screen, with optimistic mutations: each change is applied
 * locally at once, sent to the server, and replaced by what the server answers. If a request
 * fails, the page data is reloaded so the screen matches the server again. Inputs that the User
 * is typing into should keep their own draft rather than bind to the store, so a late answer
 * never overwrites newer keystrokes.
 *
 * Created by a page from its `load` data and shared with the components below it through
 * context ({@link setTaskStore} / {@link getTaskStore}).
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
import { api, type TaskPatch } from './api.js';
import type { Toasts } from './toasts.svelte.js';

type ById = Record<string, SerializedTask>;

function byId(tasks: SerializedTask[]): ById {
	return Object.fromEntries(tasks.map((task) => [task.id, task]));
}

export class TaskStore {
	readonly #source: () => SerializedTask[];
	readonly #toasts: Toasts;
	/** The page data. Only a new array (navigation, invalidation) resets the local copy. */
	#loaded = $derived.by(() => this.#source());
	/** Local copy; overwritten optimistically and by server answers. */
	#tasks = $derived<ById>(byId(this.#loaded));

	constructor(source: () => SerializedTask[], toasts: Toasts) {
		this.#source = source;
		this.#toasts = toasts;
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
	 * Returns its id right away.
	 */
	add(listId: string, title: string, parentId: string | null = null): string {
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
		void this.#send('add the task', () => api.createTask({ id, listId, title, parentId }));
		return id;
	}

	update(id: string, patch: TaskPatch): Promise<boolean> {
		this.#patchLocal(id, patch);
		return this.#send('save the task', () => api.updateTask(id, patch));
	}

	/** Completes a Task and, with it, its open Subtasks (the cascade in `#lib/domain/subtasks`). */
	complete(id: string): Promise<boolean> {
		this.#applyCompletion(completionChanges(Object.values(this.#tasks), id, timestamp()));
		return this.#send('complete the task', () => api.completeTask(id));
	}

	/** Reopens a Task with the Subtasks its completion closed, or a Subtask with its parent. */
	reopen(id: string): Promise<boolean> {
		this.#applyCompletion(reopenChanges(Object.values(this.#tasks), id));
		return this.#send('reopen the task', () => api.reopenTask(id));
	}

	remove(id: string): Promise<boolean> {
		this.apply({
			upserted: [],
			deleted: [id, ...this.all.filter((task) => task.parentId === id).map((task) => task.id)]
		});
		return this.#send('delete the task', () => api.deleteTask(id));
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
	 * is sends nothing.
	 */
	move(id: string, move: TaskMove): Promise<boolean> {
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
