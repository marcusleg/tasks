import type { RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SerializedTask, TaskChanges } from '#lib/domain/tasks.js';
import type { Db } from '#lib/server/db/client.js';
import type { User } from '#lib/server/db/schema.js';
import { createList, deleteList } from '#lib/server/lists.js';
import { dateOnly } from '#lib/domain/dates.js';
import { parseRecurrence } from '#lib/domain/recurrence.js';
import { completeTask, createTask, getListTasks, getTask, updateTask } from '#lib/server/tasks.js';
import { createTestDb, insertUser } from '#lib/server/testing/index.js';

// The endpoints open the app's database through `getDb`; hand them an in-memory one instead.
let db: Db;
vi.mock('#lib/server/db.js', () => ({ getDb: () => db }));

const { DELETE } = await import('../[id]/+server');
const { POST } = await import('./+server');

let alice: User;
let bob: User;

beforeEach(() => {
	db = createTestDb();
	alice = insertUser(db, 'alice');
	bob = insertUser(db, 'bob');
});

const scope = (user: User) => ({ db, userId: user.id });

function event(
	user: User,
	init: { body?: unknown; params?: Record<string, string>; search?: string }
) {
	const url = new URL(`http://localhost/api/tasks/restore${init.search ?? ''}`);
	const request = new Request(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(init.body ?? {})
	});
	return { locals: { user }, request, url, params: init.params ?? {} } as unknown as RequestEvent;
}

/** The status of an `error()` thrown by a handler, or of its response. */
async function status(run: () => Response | Promise<Response>): Promise<number> {
	try {
		return (await run()).status;
	} catch (cause) {
		const status = (cause as { status?: unknown }).status;
		if (typeof status === 'number') return status;
		throw cause;
	}
}

async function deleteThroughApi(user: User, id: string): Promise<SerializedTask[]> {
	const response = await DELETE(event(user, { params: { id } }) as never);
	const body = (await response.json()) as TaskChanges & { removed: SerializedTask[] };
	expect(body.deleted).toEqual(body.removed.map((task) => task.id));
	return body.removed;
}

/** A Task "Party" with a Completed Subtask "Cake" and an open one "Candles", in "Groceries". */
function party(user: User) {
	const list = createList(scope(user), { name: 'Groceries' });
	const make = (title: string, parentId?: string) =>
		createTask(scope(user), {
			listId: list.id,
			title,
			parentId,
			priority: 'medium'
		})!.upserted[0];
	const parent = make('Party');
	const cake = make('Cake', parent.id);
	make('Candles', parent.id);
	completeTask(scope(user), cake.id);
	return { list, parent };
}

describe('POST /api/tasks/restore', () => {
	it('restores what DELETE returned: the Task and its Subtasks, as they were', async () => {
		const { list, parent } = party(alice);
		const before = getListTasks(scope(alice), list.id);
		const removed = await deleteThroughApi(alice, parent.id);
		expect(getListTasks(scope(alice), list.id)).toEqual([]);

		const response = await POST(event(alice, { body: { tasks: removed } }) as never);

		expect(response.status).toBe(201);
		const changes = (await response.json()) as TaskChanges;
		expect(changes.deleted).toEqual([]);
		expect(changes.upserted).toHaveLength(3);
		expect(getListTasks(scope(alice), list.id)).toEqual(before);
	});

	it('is scoped to the User: another User gets a 404 and nothing is written', async () => {
		const { parent } = party(alice);
		const removed = await deleteThroughApi(alice, parent.id);

		expect(await status(() => POST(event(bob, { body: { tasks: removed } }) as never))).toBe(404);
		expect(getTask(scope(bob), parent.id)).toBeUndefined();
		expect(getTask(scope(alice), parent.id)).toBeUndefined();
	});

	it('ignores any owner in the body', async () => {
		const { parent } = party(alice);
		const removed = await deleteThroughApi(alice, parent.id);
		const forged = removed.map((task) => ({ ...task, userId: bob.id, user_id: bob.id }));

		await POST(event(alice, { body: { tasks: forged } }) as never);

		expect(getTask(scope(alice), parent.id)).toBeDefined();
		expect(getTask(scope(bob), parent.id)).toBeUndefined();
	});

	it('answers 409 for an id clash, e.g. when restored twice', async () => {
		const { parent } = party(alice);
		const removed = await deleteThroughApi(alice, parent.id);
		await POST(event(alice, { body: { tasks: removed } }) as never);

		expect(await status(() => POST(event(alice, { body: { tasks: removed } }) as never))).toBe(409);
	});

	it('answers 404 when the List was deleted meanwhile', async () => {
		const { list, parent } = party(alice);
		const removed = await deleteThroughApi(alice, parent.id);
		deleteList(scope(alice), list.id);

		expect(await status(() => POST(event(alice, { body: { tasks: removed } }) as never))).toBe(404);
	});

	it('answers 400 for malformed Tasks', async () => {
		const { parent } = party(alice);
		const removed = await deleteThroughApi(alice, parent.id);
		const bad = [{ ...removed[0], priority: 'urgent' }, ...removed.slice(1)];

		expect(await status(() => POST(event(alice, { body: { tasks: bad } }) as never))).toBe(400);
		expect(await status(() => POST(event(alice, { body: {} }) as never))).toBe(400);
		expect(getTask(scope(alice), parent.id)).toBeUndefined();
	});
});

describe('Undo of skipping an Occurrence (DELETE ?applyTo=occurrence, then restore with replaces)', () => {
	function weekly(user: User) {
		const list = createList(scope(user), { name: 'Chores' });
		const task = createTask(scope(user), { listId: list.id, title: 'Water plants' })!.upserted[0];
		updateTask(scope(user), task.id, {
			planned: dateOnly('2026-11-02'),
			recurrence: parseRecurrence({
				frequency: 'weekly',
				interval: 1,
				end: { kind: 'never' },
				anchor: 'schedule'
			})
		});
		return { list, task: getTask(scope(user), task.id)! };
	}

	async function skip(user: User, id: string) {
		const response = await DELETE(
			event(user, { params: { id }, search: '?applyTo=occurrence&timeZone=Europe/Berlin' }) as never
		);
		return (await response.json()) as TaskChanges & {
			removed: SerializedTask[];
			next: string | null;
		};
	}

	it('answers with the next Occurrence, which the restore replaces again', async () => {
		const { list, task } = weekly(alice);
		const skipped = await skip(alice, task.id);
		expect(skipped.upserted.map((t) => t.id)).toEqual([skipped.next]);

		const response = await POST(
			event(alice, { body: { tasks: skipped.removed, replaces: skipped.next } }) as never
		);

		expect(response.status).toBe(201);
		expect(((await response.json()) as TaskChanges).deleted).toEqual([skipped.next]);
		expect(getListTasks(scope(alice), list.id)).toEqual([task]);
	});

	it('answers 409 when the next Occurrence was changed meanwhile, and 400 for a malformed id', async () => {
		const { task } = weekly(alice);
		const skipped = await skip(alice, task.id);
		updateTask(scope(alice), skipped.next!, { title: 'Water the ferns' });

		const restore = (replaces: unknown) =>
			POST(event(alice, { body: { tasks: skipped.removed, replaces } }) as never);
		expect(await status(() => restore(skipped.next))).toBe(409);
		expect(await status(() => restore('not-an-id'))).toBe(400);
		expect(getTask(scope(alice), task.id)).toBeUndefined();
	});

	it('never replaces another User’s Task', async () => {
		const { task } = weekly(alice);
		const skipped = await skip(alice, task.id);

		expect(
			await status(() =>
				POST(event(bob, { body: { tasks: skipped.removed, replaces: skipped.next } }) as never)
			)
		).toBe(404);
		expect(getTask(scope(alice), skipped.next!)).toBeDefined();
	});
});
