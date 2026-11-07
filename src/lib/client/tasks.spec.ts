import { beforeEach, describe, expect, it, vi } from 'vitest';
import { serializeTask, type SerializedTask } from '#lib/domain/tasks.js';
import type { Db } from '#lib/server/db/client.js';
import type { User } from '#lib/server/db/schema.js';
import { createList } from '#lib/server/lists.js';
import { dateOnly } from '#lib/domain/dates.js';
import { parseRecurrence } from '#lib/domain/recurrence.js';
import {
	completeTask,
	createTask,
	getListTasks,
	getTask,
	getTasksOfLists,
	updateTask
} from '#lib/server/tasks.js';

import { createTestDb, insertUser } from '#lib/server/testing/index.js';
import { inProcessTaskPort } from '#lib/server/testing/in-process-task-port.js';
import type { ApplyTo, Scope } from './occurrence-scope.svelte';
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

// Only `ScopedTasks` makes a `Scope`; these specs test the store, so they cast one.
const asked = (applyTo?: ApplyTo) => ({ applyTo }) as Scope;
const noScope = asked();

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
			const chores = createList(scope(), { name: 'Chores' });
			seed(list.id, 'Bread');
			// Another List on the page: its Tasks mustn't count as siblings.
			seed(chores.id, 'Dishes');
			seed(chores.id, 'Mop');
			const { store, port } = setupOn([list.id, chores.id]);

			const id = store.add(list.id, '  Milk ', null, noScope);
			const optimistic = { ...store.get(id)! };
			await port.idle();

			// Only the timestamps differ (client clock vs server clock).
			expectAgreement(optimistic, store.get(id));
			expectInSyncWithServer(store);
			expect(store.openTasks(list.id).map((task) => task.title)).toEqual(['Milk', 'Bread']);
		});

		it('add: a Subtask goes to the bottom of its parent’s Subtasks', async () => {
			const list = createList(scope(), { name: 'Groceries' });
			const parent = seed(list.id, 'Party');
			seed(list.id, 'Cake', parent.id);
			const { store, port } = setup(list.id);

			const id = store.add(list.id, 'Candles', parent.id, noScope);
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

			const done = store.update(
				task.id,
				{
					title: 'Oat milk',
					description: 'Barista edition',
					priority: 'high',
					planned: { kind: 'date', date: '2026-11-09' },
					due: { kind: 'timed', dateTime: '2026-11-10T18:00', timeZone: 'Europe/Berlin' }
				},
				noScope
			);
			const optimistic = { ...store.get(task.id)! };
			expect(await done).toBe(true);

			expectAgreement(optimistic, store.get(task.id));
			expectInSyncWithServer(store, list.id);
		});

		it('update: a new Recurrence is as sent, and the server starts its series', async () => {
			const list = createList(scope(), { name: 'Groceries' });
			const task = seed(list.id, 'Water plants');
			const { store, port } = setup(list.id);

			const done = store.update(
				task.id,
				{
					planned: { kind: 'date', date: '2026-11-09' },
					recurrence: {
						frequency: 'weekly',
						interval: 1,
						weekdays: [1],
						anchor: 'schedule',
						end: { kind: 'never' }
					}
				},
				noScope
			);
			const optimistic = { ...store.get(task.id)! };
			expect(await done).toBe(true);
			await port.idle();

			// Server only: the new series' id (the series template follows the first edit).
			expectAgreement(optimistic, store.get(task.id), ['seriesId']);
			expectInSyncWithServer(store, list.id);
		});

		it('complete: the Task and its open Subtasks are Completed as the server does', async () => {
			const list = createList(scope(), { name: 'Groceries' });
			const parent = seed(list.id, 'Party');
			const cake = seed(list.id, 'Cake', parent.id);
			seed(list.id, 'Candles', parent.id);
			completeTask(scope(), cake.id);
			const { store, port } = setup(list.id);

			const cakeCompletedAt = store.get(cake.id)?.completedAt;
			expect(cakeCompletedAt).toBeTruthy();

			const done = store.complete(parent.id);
			const optimistic = store.all.map((task) => ({ ...task }));
			expect(await done).toBe(true);

			for (const before of optimistic) {
				// `completedAt` is the browser’s clock until the answer replaces it with the server’s.
				expectAgreement(before, store.get(before.id), ['completedAt']);
				expect(Boolean(before.completedAt)).toBe(Boolean(store.get(before.id)?.completedAt));
			}
			// The Subtask that was already Completed keeps its own completion time.
			expect(store.get(cake.id)?.completedAt).toBe(cakeCompletedAt);
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

			const done = store.remove(parent.id, noScope);
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

			await store.remove(parent.id, noScope);
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

		it('move: to a List that isn’t on the page, the position is the store’s guess until the answer', async () => {
			// The picker offers every List, but a page loads the Tasks of only some (the Priority View
			// of none of the target), so the store can't know the target's Custom Order.
			const groceries = createList(scope(), { name: 'Groceries' });
			const chores = createList(scope(), { name: 'Chores' });
			const milk = seed(groceries.id, 'Milk');
			seed(chores.id, 'Dishes');
			const { store } = setup(groceries.id);

			const done = store.move(milk.id, { listId: chores.id, parentId: null });
			const optimistic = { ...store.get(milk.id)! };
			expect(await done).toBe(true);

			// Server only: the Task goes above Dishes; alone, the store puts it at the start.
			expectAgreement(optimistic, store.get(milk.id), ['position']);
			expect(optimistic.position).not.toBe(store.get(milk.id)?.position);
			expect(store.get(milk.id)?.listId).toBe(chores.id);
			expect(serverTasks(chores.id).find((task) => task.id === milk.id)?.position).toBe(
				store.get(milk.id)?.position
			);
		});

		it('delete-completed: the same Tasks go on both sides', async () => {
			const list = createList(scope(), { name: 'Groceries' });
			const bread = seed(list.id, 'Bread');
			const milk = seed(list.id, 'Milk');
			const party = seed(list.id, 'Party');
			const cake = seed(list.id, 'Cake', party.id);
			completeTask(scope(), bread.id);
			completeTask(scope(), cake.id);
			// Another List on the page, with a Completed Task of its own: it stays.
			const chores = createList(scope(), { name: 'Chores' });
			const dishes = seed(chores.id, 'Dishes');
			completeTask(scope(), dishes.id);
			const { store, port } = setupOn([list.id, chores.id]);

			const done = store.deleteCompleted(list.id);
			const optimistic = store.all.map((task) => task.id);
			expect(await done).toBe(true);

			expect(store.all.map((task) => task.id)).toEqual(optimistic);
			expect(store.all.map((task) => task.id).sort()).toEqual(
				[milk.id, party.id, dishes.id].sort()
			);
			expectInSyncWithServer(store);
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

			const id = store.add(list.id, 'Milk', null, noScope);
			void store.update(id, { title: 'Oat milk' }, noScope);
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
			// doesn’t re-derive when page data changes, so the screen catching up after the reload is
			// covered by the e2e test “a failed request toasts and the screen catches up”.
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

			const failed = store.update(milk.id, { title: 'Oat milk' }, noScope);
			const id = store.add(list.id, 'Bread', null, noScope);
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

	describe('recurring Tasks', () => {
		const weekly = (weekdays?: number[]) =>
			parseRecurrence({
				frequency: 'weekly',
				interval: 1,
				...(weekdays && { weekdays }),
				end: { kind: 'never' },
				anchor: 'schedule'
			});

		/** "Water plants", weekly from Monday 2026-11-09, with a Subtask "Fill can". */
		function plants(listId: string) {
			const task = seed(listId, 'Water plants');
			updateTask(scope(), task.id, { planned: dateOnly('2026-11-09'), recurrence: weekly([1]) });
			const subtask = seed(listId, 'Fill can', task.id);
			return { task: serializeTask(getTask(scope(), task.id)!), subtask };
		}

		/**
		 * Which fields of which Tasks differ between a snapshot taken right after the action
		 * (optimistic) and the store once the answer is in. Timestamps and `changedSinceGenerated`
		 * are left out (see `expectAgreement`). A Task that only the answer brings is `"new"`, one
		 * the answer takes away `"gone"`.
		 */
		function drift(
			before: SerializedTask[],
			store: TaskStore,
			ignore: (keyof SerializedTask)[] = []
		) {
			const result: Record<string, string[] | 'new' | 'gone'> = {};
			const after = store.all;
			for (const task of after) {
				const was = before.find((other) => other.id === task.id);
				if (!was) {
					result[`${task.title} (next)`] = 'new';
					continue;
				}
				const fields = (Object.keys(task) as (keyof SerializedTask)[]).filter(
					(key) =>
						!['createdAt', 'updatedAt', 'changedSinceGenerated', ...ignore].includes(key) &&
						JSON.stringify(task[key]) !== JSON.stringify(was[key])
				);
				if (fields.length > 0) result[task.title] = fields;
			}
			for (const task of before) {
				if (!after.some((other) => other.id === task.id)) result[task.title] = 'gone';
			}
			return result;
		}

		const snapshot = (store: TaskStore) => store.all.map((task) => ({ ...task }));
		const byTitle = (store: TaskStore, title: string) =>
			store.all.find((task) => task.title === title && !task.completedAt)!;

		/**
		 * Once the answer is in, the store should hold what the server has, except for
		 * `generatedFromTaskId` after a Completed Occurrence is deleted: the database sets it to
		 * `null` on the next Occurrence (foreign key `on delete set null`), but the answer doesn't
		 * list that Task. No client code reads `generatedFromTaskId` and a reload clears it, so the
		 * server's answers aren't widened for it.
		 */
		function expectInSyncExceptGeneratedFrom(store: TaskStore, listId: string) {
			const without = (tasks: SerializedTask[]) =>
				tasks.map((task) => ({ ...task, generatedFromTaskId: null }));
			expect(without(store.all)).toEqual(without(serverTasks(listId)));
		}

		it('complete: the next Occurrence and its Subtasks come only with the answer', async () => {
			const list = createList(scope(), { name: 'Groceries' });
			plants(list.id);
			const { store } = setup(list.id);

			const done = store.complete(byTitle(store, 'Water plants').id);
			const optimistic = snapshot(store);
			await done;

			// Server only: the next Occurrence (the Task, and its Subtask reopened with shifted dates).
			// `completedAt` is the browser's clock until the answer replaces it.
			expect(drift(optimistic, store, ['completedAt'])).toEqual({
				'Water plants (next)': 'new',
				'Fill can (next)': 'new'
			});
			expectInSyncWithServer(store, list.id);
		});

		it('reopen: the next Occurrence gives way until the answer says so', async () => {
			const list = createList(scope(), { name: 'Groceries' });
			const { task } = plants(list.id);
			completeTask(scope(), task.id);
			const { store } = setup(list.id);
			expect(store.openTasks(list.id)).toHaveLength(1);

			const done = store.reopen(task.id);
			const optimistic = snapshot(store);
			await done;

			// Server only: the next Occurrence (unchanged by the User) and its Subtask are removed,
			// the reopened one takes their place. Both are on screen until the answer arrives.
			expect(optimistic.filter((t) => !t.completedAt && !t.parentId)).toHaveLength(2);
			expect(drift(optimistic, store)).toEqual({ 'Water plants': 'gone', 'Fill can': 'gone' });
			expect(store.get(task.id)).toMatchObject({ completedAt: null, seriesId: task.seriesId });
			expect(store.openTasks(list.id)).toHaveLength(1);
			expectInSyncWithServer(store, list.id);
		});

		it('reopen: when the next Occurrence was edited, the Task comes back as a one-off', async () => {
			const list = createList(scope(), { name: 'Groceries' });
			const { task } = plants(list.id);
			completeTask(scope(), task.id);
			const next = getListTasks(scope(), list.id).find((t) => !t.completedAt && !t.parentId)!;
			updateTask(scope(), next.id, { title: 'Water the plants' });
			const { store } = setup(list.id);

			const done = store.reopen(task.id);
			const optimistic = snapshot(store);
			await done;

			// Server only: the reopened Occurrence loses its Recurrence and series.
			expect(drift(optimistic, store)).toEqual({ 'Water plants': ['recurrence', 'seriesId'] });
			expect(store.get(task.id)).toMatchObject({ recurrence: null, seriesId: null });
			expectInSyncWithServer(store, list.id);
		});

		it('skip: the next Occurrence comes with the answer, and Undo puts the skipped one back', async () => {
			const list = createList(scope(), { name: 'Groceries' });
			const { task } = plants(list.id);
			const { store, toasts, port } = setup(list.id);
			const before = snapshot(store);

			const done = store.remove(task.id, asked('occurrence'));
			const optimistic = snapshot(store);
			await done;

			expect(optimistic).toEqual([]);
			// Server only: the next Occurrence and its Subtask.
			expect(drift(optimistic, store)).toEqual({
				'Water plants (next)': 'new',
				'Fill can (next)': 'new'
			});
			expectInSyncWithServer(store, list.id);

			// Undo restores the skipped Occurrence (same ids) and removes the next one it replaced.
			toasts.act(toasts.actionable!.id);
			await port.idle();
			expect(store.all.map((t) => t.id).sort()).toEqual(before.map((t) => t.id).sort());
			expect(drift(before, store)).toEqual({});
			expect(port.requests.at(-1)?.body).toMatchObject({ replaces: expect.any(String) });
			expectInSyncWithServer(store, list.id);
		});

		it('delete: ending the Recurrence removes the Task and its Subtasks as on the server', async () => {
			const list = createList(scope(), { name: 'Groceries' });
			const { task } = plants(list.id);
			const { store } = setup(list.id);

			const done = store.remove(task.id, asked('future'));
			const optimistic = snapshot(store);
			await done;

			expect(drift(optimistic, store)).toEqual({});
			expect(store.all).toEqual([]);
			expectInSyncWithServer(store, list.id);
		});

		it('delete: a Completed Occurrence leaves a stale generatedFromTaskId on the next one', async () => {
			const list = createList(scope(), { name: 'Groceries' });
			const { task } = plants(list.id);
			completeTask(scope(), task.id);
			const { store } = setup(list.id);

			await store.remove(task.id, noScope);

			// Known drift (see `expectInSyncExceptGeneratedFrom`).
			const next = store.all.find((t) => !t.completedAt && !t.parentId)!;
			expect(next.generatedFromTaskId).toBe(task.id);
			expect(serverTasks(list.id).find((t) => t.id === next.id)?.generatedFromTaskId).toBeNull();
			expectInSyncExceptGeneratedFrom(store, list.id);
		});

		it('delete-completed: the same, for the Completed Occurrences of a List', async () => {
			const list = createList(scope(), { name: 'Groceries' });
			const { task } = plants(list.id);
			completeTask(scope(), task.id);
			const { store } = setup(list.id);

			const done = store.deleteCompleted(list.id);
			const optimistic = snapshot(store);
			await done;

			// Known drift (see `expectInSyncExceptGeneratedFrom`): the next Occurrence keeps pointing at
			// the deleted Task until the page is reloaded. Nothing else differs.
			const next = store.all.find((t) => !t.completedAt && !t.parentId)!;
			expect(drift(optimistic, store)).toEqual({});
			expect(next.generatedFromTaskId).toBe(task.id);
			expectInSyncExceptGeneratedFrom(store, list.id);
		});

		it('update with applyTo future: a date change moves the rule’s weekday on the server', async () => {
			const list = createList(scope(), { name: 'Groceries' });
			const { task } = plants(list.id);
			const { store, port } = setup(list.id);

			const done = store.update(
				task.id,
				{ planned: { kind: 'date', date: '2026-11-10' } },
				asked('future')
			);
			const optimistic = snapshot(store);
			await done;

			expect(port.requests[0].body).toMatchObject({ applyTo: 'future' });
			// Server only: the Recurrence follows the driving date (Monday [1] → Tuesday [2]).
			expect(drift(optimistic, store)).toEqual({ 'Water plants': ['recurrence'] });
			expect(store.get(task.id)?.recurrence).toMatchObject({ weekdays: [2] });
			expectInSyncWithServer(store, list.id);
		});

		it('update with applyTo occurrence: the series template is the server’s to keep', async () => {
			const list = createList(scope(), { name: 'Groceries' });
			const { task } = plants(list.id);
			const { store, port } = setup(list.id);

			const done = store.update(task.id, { title: 'Water ferns' }, asked('occurrence'));
			const optimistic = snapshot(store);
			await done;

			expect(port.requests[0].body).toMatchObject({ applyTo: 'occurrence' });
			// Server only: the template keeps the old title for later Occurrences.
			expect(drift(optimistic, store)).toEqual({ 'Water ferns': ['seriesTemplate'] });
			expectInSyncWithServer(store, list.id);
		});

		it('add a Subtask to a recurring Task with applyTo occurrence: the parent’s template changes', async () => {
			const list = createList(scope(), { name: 'Groceries' });
			const { task } = plants(list.id);
			const { store, port } = setup(list.id);

			const id = store.add(list.id, 'Wipe leaves', task.id, asked('occurrence'));
			const optimistic = snapshot(store);
			await port.idle();

			expect(port.requests[0].body).toMatchObject({ applyTo: 'occurrence' });
			expectAgreement(
				optimistic.find((t) => t.id === id)!,
				store.get(id)
			);
			// Server only: the parent now carries a template that leaves this Subtask out of later
			// Occurrences.
			expect(drift(optimistic, store)).toEqual({ 'Water plants': ['seriesTemplate'] });
			expectInSyncWithServer(store, list.id);
		});

		it('add a Subtask to a recurring Task with applyTo future: nothing differs but the timestamps', async () => {
			const list = createList(scope(), { name: 'Groceries' });
			const { task } = plants(list.id);
			const { store, port } = setup(list.id);

			store.add(list.id, 'Wipe leaves', task.id, asked('future'));
			const optimistic = snapshot(store);
			await port.idle();

			expect(port.requests[0].body).toMatchObject({ applyTo: 'future' });
			expect(drift(optimistic, store)).toEqual({});
			expectInSyncWithServer(store, list.id);
		});

		it('update: a Recurrence without weekdays gets the driving date’s weekday from the server', async () => {
			const list = createList(scope(), { name: 'Groceries' });
			const task = seed(list.id, 'Water plants');
			const { store } = setup(list.id);

			const done = store.update(
				task.id,
				{
					planned: { kind: 'date', date: '2026-11-09' },
					recurrence: {
						frequency: 'weekly',
						interval: 1,
						anchor: 'schedule',
						end: { kind: 'never' }
					}
				},
				noScope
			);
			const optimistic = snapshot(store);
			await done;

			// Server only: the weekday (2026-11-09 is a Monday) and the new series.
			expect(optimistic[0].recurrence).not.toHaveProperty('weekdays');
			expect(drift(optimistic, store)).toEqual({ 'Water plants': ['recurrence', 'seriesId'] });
			expect(store.get(task.id)?.recurrence).toMatchObject({ weekdays: [1] });
			expectInSyncWithServer(store, list.id);
		});
	});
});
