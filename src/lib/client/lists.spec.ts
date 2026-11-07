import { beforeEach, describe, expect, it, vi } from 'vitest';
import { serializeList, type SerializedList } from '#lib/domain/lists.js';
import type { Db } from '#lib/server/db/client.js';
import type { User } from '#lib/server/db/schema.js';
import { createList, getLists } from '#lib/server/lists.js';
import { createTestDb, insertUser } from '#lib/server/testing/index.js';
import { inProcessListPort } from '#lib/server/testing/in-process-list-port.js';
import { ListStore } from './lists.svelte';
import { Toasts } from './toasts.svelte';

// The endpoints open the app's database through `getDb`; hand them an in-memory one instead.
let db: Db;
vi.mock('#lib/server/db.js', () => ({ getDb: () => db }));

let user: User;

beforeEach(() => {
	vi.spyOn(console, 'error').mockImplementation(() => {});
	db = createTestDb();
	user = insertUser(db, 'alice');
});

const scope = () => ({ db, userId: user.id });

const serverLists = (): SerializedList[] => getLists(scope()).map(serializeList);

function setup(options: Parameters<typeof inProcessListPort>[1] = {}) {
	const pageData = serverLists();
	const toasts = new Toasts();
	const port = inProcessListPort(user, options);
	const store = new ListStore(() => pageData, toasts, port);
	return { store, toasts, port };
}

const messages = (toasts: Toasts) => toasts.items.map((toast) => toast.message);

describe('ListStore through the in-process adapter', () => {
	it('create: resolves to the new id once the server has the List', async () => {
		createList(scope(), { name: 'Chores' });
		const { store, port } = setup();

		const pending = store.create('  Groceries ');
		expect(store.all.map((list) => list.name)).toEqual(['Chores', 'Groceries']);
		const id = await pending;

		expect(id).toBeDefined();
		expect(store.get(id)?.name).toBe('Groceries');
		expect(store.all).toEqual(serverLists());
		expect(port.reloads).toBe(0);
	});

	it('update and move: the store ends up with what the server has', async () => {
		const a = createList(scope(), { name: 'A' });
		const b = createList(scope(), { name: 'B' });
		const c = createList(scope(), { name: 'C' });
		const { store, port } = setup();

		await store.update(a.id, { name: 'Alpha', sortMode: 'title', visible: false });
		await store.move(c.id, { before: a.id });

		expect(store.all.map((list) => list.id)).toEqual([c.id, a.id, b.id]);
		expect(store.get(a.id)).toMatchObject({ name: 'Alpha', sortMode: 'title', visible: false });
		expect(store.all).toEqual(serverLists());
		expect(port.reloads).toBe(0);
	});

	it('remove: the List is gone on the server too', async () => {
		const a = createList(scope(), { name: 'A' });
		createList(scope(), { name: 'B' });
		const { store } = setup();

		const pending = store.remove(a.id);
		expect(store.get(a.id)).toBeUndefined();

		expect(await pending).toBe(true);
		expect(serverLists().map((list) => list.name)).toEqual(['B']);
	});

	describe('requests', () => {
		it('go out one at a time, in order, even when an earlier one would answer later', async () => {
			const a = createList(scope(), { name: 'A' });
			const b = createList(scope(), { name: 'B' });
			// The rename is slow, so without a queue the later requests would reach the server first.
			const { store, port } = setup({
				beforeRequest: (request) =>
					(request.body as { name?: string }).name
						? new Promise((resolve) => setTimeout(resolve, 30))
						: undefined
			});

			void store.update(a.id, { name: 'Alpha' });
			void store.move(b.id, { before: a.id });
			void store.update(b.id, { visible: false });
			await vi.waitFor(() => expect(port.requests).toHaveLength(3));
			await port.idle();

			expect(port.requests.map((request) => request.body)).toEqual([
				{ name: 'Alpha' },
				{ before: a.id },
				{ visible: false }
			]);
			expect(store.all).toEqual(serverLists());
			expect(store.all.map((list) => list.name)).toEqual(['B', 'Alpha']);
		});

		it('a List renamed right after it was created is created first', async () => {
			const { store, port } = setup({
				// Creating is slow, so without a queue the rename would reach the server first.
				beforeRequest: (request) =>
					request.method === 'POST' ? new Promise((resolve) => setTimeout(resolve, 30)) : undefined
			});

			const created = store.create('Groceries');
			void store.update(store.all[0].id, { name: 'Food' });
			await vi.waitFor(() => expect(port.requests).toHaveLength(2));
			await port.idle();

			expect(await created).toBeDefined();
			expect(port.requests.map((request) => request.method)).toEqual(['POST', 'PATCH']);
			expect(serverLists().map((list) => list.name)).toEqual(['Food']);
		});

		it('a failed request shows a toast and reloads the Lists', async () => {
			const a = createList(scope(), { name: 'A' });
			const { store, toasts, port } = setup();
			// The List is deleted elsewhere, so changing it here fails with a 404.
			db.run(`delete from lists where id = '${a.id}'`);

			expect(await store.update(a.id, { name: 'Alpha' })).toBe(false);

			expect(messages(toasts)).toEqual(["Couldn't save the list. List not found."]);
			expect(port.reloads).toBe(1);
		});

		it('later requests still go out after one has failed', async () => {
			const a = createList(scope(), { name: 'A' });
			const { store, toasts, port } = setup();
			db.run(`delete from lists where id = '${a.id}'`);

			const failed = store.update(a.id, { name: 'Alpha' });
			const created = store.create('B');

			expect(await failed).toBe(false);
			expect(await created).toBeDefined();
			expect(messages(toasts)).toHaveLength(1);
			expect(port.reloads).toBe(1);
			expect(serverLists().map((list) => list.name)).toEqual(['B']);
		});

		it('a failed create resolves to undefined and reloads', async () => {
			const { store, toasts, port } = setup();
			vi.spyOn(port, 'createList').mockRejectedValueOnce(new Error('Nope'));

			expect(await store.create('Groceries')).toBeUndefined();

			expect(messages(toasts)).toEqual(["Couldn't create the list. Nope."]);
			expect(port.reloads).toBe(1);
		});
	});
});
