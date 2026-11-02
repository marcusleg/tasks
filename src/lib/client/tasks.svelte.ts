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
import { generateKeyBetween } from 'fractional-indexing';
import {
	byCustomOrder,
	completedTasksOf,
	openTasksOf,
	type SerializedTask,
	type TaskChanges
} from '#lib/domain/tasks.js';
import { newId, timestamp } from '#lib/domain/validation.js';
import { TASKS_DEPENDENCY } from '#lib/dependencies.js';
import { api } from './api.js';
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

	/** Adds a Task at the top of a List. Returns its id right away. */
	add(listId: string, title: string, parentId: string | null = null): string {
		const id = newId();
		const now = timestamp();
		const first = Object.values(this.#tasks)
			.filter((task) => task.listId === listId && task.parentId === parentId)
			.sort(byCustomOrder)[0];
		this.#tasks = {
			...this.#tasks,
			[id]: {
				id,
				listId,
				parentId,
				title: title.trim(),
				description: '',
				position: generateKeyBetween(null, first?.position ?? null),
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

	update(id: string, patch: { title?: string; description?: string }): Promise<boolean> {
		this.#patchLocal(id, patch);
		return this.#send('save the task', () => api.updateTask(id, patch));
	}

	complete(id: string): Promise<boolean> {
		this.#patchLocal(id, { completedAt: timestamp() });
		return this.#send('complete the task', () => api.completeTask(id));
	}

	reopen(id: string): Promise<boolean> {
		this.#patchLocal(id, { completedAt: null, completedByCascade: false });
		return this.#send('reopen the task', () => api.reopenTask(id));
	}

	remove(id: string): Promise<boolean> {
		this.apply({
			upserted: [],
			deleted: [id, ...this.all.filter((task) => task.parentId === id).map((task) => task.id)]
		});
		return this.#send('delete the task', () => api.deleteTask(id));
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
