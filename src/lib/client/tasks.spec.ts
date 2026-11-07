import { beforeEach, describe, expect, it, vi } from 'vitest';
import { serializeTask, type SerializedTask } from '#lib/domain/tasks.js';
import type { Db } from '#lib/server/db/client.js';
import type { User } from '#lib/server/db/schema.js';
import { createList } from '#lib/server/lists.js';
import { completeTask, createTask, getTasksOfLists } from '#lib/server/tasks.js';
import { createTestDb, insertUser } from '#lib/server/testing/index.js';
import { inProcessTaskPort } from '#lib/server/testing/in-process-task-port.js';
import { TaskStore } from './tasks.svelte';
import { Toasts } from './toasts.svelte';

// The endpoints open the app's database through `getDb`; hand them an in-memory one instead.
let db: Db;
vi.mock('#lib/server/db.js', () => ({ getDb: () => db }));

let user: User;

beforeEach(() => {
	shown = [];
	vi.spyOn(console, 'error').mockImplementation(() => {});
	db = createTestDb();
	user = insertUser(db, 'alice');
});

const scope = () => ({ db, userId: user.id });

/** The Lists the page shows; their Tasks are the page data. */
let shown: string[];

/** What the server has for the shown Lists, as the browser would see it. */
function serverTasks(...listIds: string[]): SerializedTask[] {
	return getTasksOfLists(scope(), listIds.length > 0 ? listIds : shown).map(serializeTask);
}

/** Seeds a Task through the server, as page data from an earlier `load` would have it. */
function seed(listId: string, title: string, parentId?: string): SerializedTask {
	return serializeTask(createTask(scope(), { listId, title, parentId })!.upserted[0]);
}

/** A store on a page showing one List. */
function setup(listId: string, options: Parameters<typeof inProcessTaskPort>[1] = {}) {
	return setupOn([listId], options);
}

function setupOn(lists: string[], options: Parameters<typeof inProcessTaskPort>[1] = {}) {
	shown = lists;
	const pageData = serverTasks();
	const toasts = new Toasts();
	const port = inProcessTaskPort(user, options);
	const store = new TaskStore(() => pageData, toasts, port);
	return { store, toasts, port };
}

const messages = (toasts: Toasts) => toasts.items.map((toast) => toast.message);

/**
 * The fields both the optimistic copy and the server's answer know, compared. `ignore` names
 * fields that can't agree, each with the reason where it's used.
 */
function expectAgreement(
	optimistic: SerializedTask,
	answer: SerializedTask | undefined,
	ignore: (keyof SerializedTask)[] = []
) {
	expect(answer).toBeDefined();
	// `changedSinceGenerated` is the server's bookkeeping for Reopen (it marks a Task, or a parent,
	// that was edited): the browser never reads it, so its copy lags until the answer arrives.
	const skip = new Set<keyof SerializedTask>([
		'createdAt',
		'updatedAt',
		'changedSinceGenerated',
		...ignore
	]);
	const strip = (task: SerializedTask) =>
		Object.fromEntries(Object.entries(task).filter(([key]) => !skip.has(key as never)));
	expect(strip(answer!)).toEqual(strip(optimistic));
}

/** After the answers are in, the store holds exactly what the server has. */
function expectInSyncWithServer(store: TaskStore, ...listIds: string[]) {
	expect(store.all).toEqual(serverTasks(...listIds));
}

describe('TaskStore through the in-process adapter', () => {
	describe('optimistic state vs the server’s answer', () => {
		it('add: a new Task is as the server creates it', async () => {
			const list = createList(scope(), { name: 'Groceries' });
			seed(list.id, 'Bread');
			const { store, port } = setup(list.id);

			const id = store.add(list.id, '  Milk ');
			const optimistic = { ...store.get(id)! };
			await port.idle();

			// Only the timestamps differ (client clock vs server clock).
			expectAgreement(optimistic, store.get(id));
			expectInSyncWithServer(store, list.id);
			expect(store.openTasks(list.id).map((task) => task.title)).toEqual(['Milk', 'Bread']);
		});

		it('add: a Subtask goes to the bottom of its parent’s Subtasks', async () => {
			const list = createList(scope(), { name: 'Groceries' });
			const parent = seed(list.id, 'Party');
			seed(list.id, 'Cake', parent.id);
			const { store, port } = setup(list.id);

			const id = store.add(list.id, 'Candles', parent.id);
			const optimistic = { ...store.get(id)! };
			await port.idle();

			expectAgreement(optimistic, store.get(id));
			expectInSyncWithServer(store, list.id);
			expect(store.subtasks(parent.id).map((task) => task.title)).toEqual(['Cake', 'Candles']);
		});

		it('update: the patched fields are as the server stores them', async () => {
			const list = createList(scope(), { name: 'Groceries' });
			const task = seed(list.id, 'Milk');
			const { store } = setup(list.id);

			const done = store.update(task.id, {
				title: 'Oat milk',
				description: 'Barista edition',
				priority: 'high',
				planned: { kind: 'date', date: '2026-11-09' },
				due: { kind: 'timed', dateTime: '2026-11-10T18:00', timeZone: 'Europe/Berlin' }
			});
			const optimistic = { ...store.get(task.id)! };
			expect(await done).toBe(true);

			expectAgreement(optimistic, store.get(task.id));
			expectInSyncWithServer(store, list.id);
		});

		it('update: a Recurrence is filled in by the server, which the optimistic copy lacks', async () => {
			const list = createList(scope(), { name: 'Groceries' });
			const task = seed(list.id, 'Water plants');
			const { store, port } = setup(list.id);

			const done = store.update(task.id, {
				planned: { kind: 'date', date: '2026-11-09' },
				recurrence: {
					frequency: 'weekly',
					interval: 1,
					weekdays: [1],
					anchor: 'schedule',
					end: { kind: 'never' }
				} as never
			});
			const optimistic = { ...store.get(task.id)! };
			expect(await done).toBe(true);
			await port.idle();

			// The server also sets the series fields of a Task that starts to recur; until its
			// answer arrives the optimistic copy has only what was sent.
			expectAgreement(optimistic, store.get(task.id), ['recurrence', 'seriesId', 'seriesTemplate']);
			expectInSyncWithServer(store, list.id);
		});

		it('complete: the Task and its open Subtasks are Completed as the server does', async () => {
			const list = createList(scope(), { name: 'Groceries' });
			const parent = seed(list.id, 'Party');
			const cake = seed(list.id, 'Cake', parent.id);
			seed(list.id, 'Candles', parent.id);
			completeTask(scope(), cake.id);
			const { store, port } = setup(list.id);

			const done = store.complete(parent.id);
			const optimistic = store.all.map((task) => ({ ...task }));
			expect(await done).toBe(true);

			for (const before of optimistic) {
				// `completedAt` is the browser’s clock until the answer replaces it with the server’s.
				expectAgreement(before, store.get(before.id), ['completedAt']);
				expect(Boolean(before.completedAt)).toBe(Boolean(store.get(before.id)?.completedAt));
			}
			// The Subtask that was already Completed keeps its own completion time.
			expect(store.get(cake.id)?.completedAt).toBe(
				serverTasks(list.id).find((task) => task.id === cake.id)?.completedAt
			);
			expectInSyncWithServer(store, list.id);
			expect(port.reloads).toBe(0);
		});

		it('reopen: only the Subtasks the completion closed come back, as on the server', async () => {
			const list = createList(scope(), { name: 'Groceries' });
			const parent = seed(list.id, 'Party');
			const cake = seed(list.id, 'Cake', parent.id);
			seed(list.id, 'Candles', parent.id);
			completeTask(scope(), cake.id);
			completeTask(scope(), parent.id);
			const { store, port } = setup(list.id);

			const done = store.reopen(parent.id);
			const optimistic = store.all.map((task) => ({ ...task }));
			expect(await done).toBe(true);

			for (const before of optimistic) expectAgreement(before, store.get(before.id));
			expect(store.get(cake.id)?.completedAt).toBeTruthy();
			expectInSyncWithServer(store, list.id);
			expect(port.reloads).toBe(0);
		});

		it('reopen: a Subtask of a Completed parent reopens the parent too', async () => {
			const list = createList(scope(), { name: 'Groceries' });
			const parent = seed(list.id, 'Party');
			const candles = seed(list.id, 'Candles', parent.id);
			completeTask(scope(), parent.id);
			const { store } = setup(list.id);

			const done = store.reopen(candles.id);
			const optimistic = store.all.map((task) => ({ ...task }));
			expect(await done).toBe(true);

			for (const before of optimistic) expectAgreement(before, store.get(before.id));
			expectInSyncWithServer(store, list.id);
		});

		it('delete: the Task and its Subtasks are gone on both sides', async () => {
			const list = createList(scope(), { name: 'Groceries' });
			const parent = seed(list.id, 'Party');
			seed(list.id, 'Cake', parent.id);
			seed(list.id, 'Bread');
			const { store, port } = setup(list.id);

			const done = store.remove(parent.id);
			const optimistic = store.all.map((task) => task.id);
			expect(await done).toBe(true);

			expect(store.all.map((task) => task.id)).toEqual(optimistic);
			expectInSyncWithServer(store, list.id);
			expect(port.reloads).toBe(0);
		});

		it('delete, then Undo: the Tasks come back as they were', async () => {
			const list = createList(scope(), { name: 'Groceries' });
			const parent = seed(list.id, 'Party');
			seed(list.id, 'Cake', parent.id);
			const { store, toasts, port } = setup(list.id);
			const before = store.all;

			await store.remove(parent.id);
			toasts.act(toasts.actionable!.id);
			await port.idle();

			expect(store.all).toEqual(before);
			expectInSyncWithServer(store, list.id);
		});

		it('move: a Task moved among its siblings ends up where the server puts it', async () => {
			const list = createList(scope(), { name: 'Groceries' });
			const bread = seed(list.id, 'Bread');
			const milk = seed(list.id, 'Milk');
			const eggs = seed(list.id, 'Eggs');
			const { store, port } = setup(list.id);
			expect(store.openTasks(list.id).map((task) => task.id)).toEqual([eggs.id, milk.id, bread.id]);

			const done = store.move(eggs.id, { listId: list.id, parentId: null, after: bread.id });
			const optimistic = store.all.map((task) => ({ ...task }));
			expect(await done).toBe(true);

			for (const before of optimistic) expectAgreement(before, store.get(before.id));
			expect(store.openTasks(list.id).map((task) => task.id)).toEqual([milk.id, bread.id, eggs.id]);
			expectInSyncWithServer(store, list.id);
			expect(port.reloads).toBe(0);
		});

		it('move: a Task becomes a Subtask, as on the server', async () => {
			const list = createList(scope(), { name: 'Groceries' });
			const parent = seed(list.id, 'Party');
			const cake = seed(list.id, 'Cake');
			const { store } = setup(list.id);

			const done = store.move(cake.id, { listId: list.id, parentId: parent.id });
			const optimistic = store.all.map((task) => ({ ...task }));
			expect(await done).toBe(true);

			for (const before of optimistic) expectAgreement(before, store.get(before.id));
			expectInSyncWithServer(store, list.id);
		});

		it('move: a Task and its Subtasks move to another List', async () => {
			const groceries = createList(scope(), { name: 'Groceries' });
			const chores = createList(scope(), { name: 'Chores' });
			const parent = seed(groceries.id, 'Party');
			seed(groceries.id, 'Cake', parent.id);
			seed(chores.id, 'Dishes');
			const { store } = setupOn([groceries.id, chores.id]);
			const done = store.move(parent.id, { listId: chores.id, parentId: null });
			const optimistic = store.all.map((task) => ({ ...task }));
			expect(await done).toBe(true);

			for (const before of optimistic) {
				expectAgreement(before, store.get(before.id));
				expect(store.get(before.id)?.listId).toBe(chores.id);
			}
			expectInSyncWithServer(store);
			expect(store.openTasks(chores.id).map((task) => task.title)).toEqual(['Party', 'Dishes']);
		});

		it('delete-completed: the same Tasks go on both sides', async () => {
			const list = createList(scope(), { name: 'Groceries' });
			const bread = seed(list.id, 'Bread');
			const milk = seed(list.id, 'Milk');
			const party = seed(list.id, 'Party');
			const cake = seed(list.id, 'Cake', party.id);
			completeTask(scope(), bread.id);
			completeTask(scope(), cake.id);
			const { store, port } = setup(list.id);

			const done = store.deleteCompleted(list.id);
			const optimistic = store.all.map((task) => task.id);
			expect(await done).toBe(true);

			expect(store.all.map((task) => task.id)).toEqual(optimistic);
			expect(store.all.map((task) => task.id).sort()).toEqual([milk.id, party.id].sort());
			expectInSyncWithServer(store, list.id);
			expect(port.reloads).toBe(0);
		});
	});

	describe('requests', () => {
		it('go out one at a time, in the order they were made', async () => {
			const list = createList(scope(), { name: 'Groceries' });
			const releases: (() => void)[] = [];
			const { store, port } = setup(list.id, {
				// Each request waits to be let go, so only the queue can keep them in order.
				beforeRequest: () => new Promise<void>((resolve) => releases.push(resolve))
			});

			const id = store.add(list.id, 'Milk');
			void store.update(id, { title: 'Oat milk' });
			void store.complete(id);
			await vi.waitFor(() => expect(releases).toHaveLength(1));
			expect(port.requests).toEqual([]);

			releases[0]();
			await vi.waitFor(() => expect(releases).toHaveLength(2));
			expect(port.requests.map((request) => request.method)).toEqual(['POST']);
			releases[1]();
			await vi.waitFor(() => expect(releases).toHaveLength(3));
			releases[2]();
			await port.idle();

			expect(port.requests.map((request) => `${request.method} ${request.path}`)).toEqual([
				'POST /api/tasks',
				`PATCH /api/tasks/${id}`,
				`POST /api/tasks/${id}/complete`
			]);
			expect(store.get(id)).toMatchObject({ title: 'Oat milk' });
			expect(store.get(id)?.completedAt).toBeTruthy();
			expectInSyncWithServer(store, list.id);
		});

		it('a failed request shows a toast and reloads the page data', async () => {
			const list = createList(scope(), { name: 'Groceries' });
			const milk = seed(list.id, 'Milk');
			const { store, toasts, port } = setup(list.id);
			// The Task is deleted elsewhere, so completing it here fails with a 404.
			// Only the reload request is checked: vitest runs Svelte’s server build, whose $derived
			// doesn’t re-derive when page data changes, so the screen catching up is covered by e2e.
			db.run(`delete from tasks where id = '${milk.id}'`);

			expect(await store.complete(milk.id)).toBe(false);

			expect(messages(toasts)).toEqual(["Couldn't complete the task. Task not found."]);
			expect(port.reloads).toBe(1);
		});

		it('later requests still go out after one has failed', async () => {
			const list = createList(scope(), { name: 'Groceries' });
			const milk = seed(list.id, 'Milk');
			const { store, toasts, port } = setup(list.id);
			db.run(`delete from tasks where id = '${milk.id}'`);

			const failed = store.update(milk.id, { title: 'Oat milk' });
			const id = store.add(list.id, 'Bread');
			expect(await failed).toBe(false);
			await port.idle();

			expect(port.requests.map((request) => request.method)).toEqual(['PATCH', 'POST']);
			expect(messages(toasts)).toHaveLength(1);
			expect(serverTasks(list.id).map((task) => task.id)).toEqual([id]);
		});

		it('a failed action withdraws its Undo toast', async () => {
			const list = createList(scope(), { name: 'Groceries' });
			const milk = seed(list.id, 'Milk');
			const { store, toasts } = setup(list.id);
			db.run(`delete from tasks where id = '${milk.id}'`);

			await store.complete(milk.id);

			expect(toasts.actionable).toBeUndefined();
		});
	});
});
