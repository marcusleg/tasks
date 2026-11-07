import type { RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dateOnly } from '#lib/domain/dates.js';
import { parseRecurrence } from '#lib/domain/recurrence.js';
import type { TaskChanges } from '#lib/domain/tasks.js';
import type { Db } from '#lib/server/db/client.js';
import type { User } from '#lib/server/db/schema.js';
import { createList } from '#lib/server/lists.js';
import { createTask, getListTasks, getTask, updateTask } from '#lib/server/tasks.js';
import { createTestDb, insertUser } from '#lib/server/testing/index.js';
import { wholeLists } from '#lib/server/testing/undo.js';

// The endpoints open the app's database through `getDb`; hand them an in-memory one instead.
let db: Db;
vi.mock('#lib/server/db.js', () => ({ getDb: () => db }));

const { DELETE } = await import('../tasks/[id]/+server');
const { POST } = await import('./+server');

let alice: User;
let bob: User;

beforeEach(() => {
	db = createTestDb();
	alice = insertUser(db, 'alice');
	bob = insertUser(db, 'bob');
});

const scope = (user: User) => ({ db, userId: user.id });

function event(user: User, init: { body?: unknown; params?: Record<string, string> }) {
	const url = new URL('http://localhost/api/undo');
	const request = new Request(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(init.body ?? {})
	});
	return { locals: { user }, request, url, params: init.params ?? {} } as unknown as RequestEvent;
}

const undo = (user: User, undoId: unknown) => POST(event(user, { body: { undoId } }) as never);

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

/** A recurring Task whose Subtasks have a template; deletes "Fern" through the endpoint. */
async function deleteFern(user: User) {
	const listId = createList(scope(user), { name: 'Chores' }).id;
	const add = (title: string, parentId?: string) =>
		createTask(scope(user), { listId, title, parentId })!.upserted[0];
	const parent = add('Water plants');
	updateTask(scope(user), parent.id, {
		planned: dateOnly('2026-11-02'),
		recurrence: parseRecurrence({
			frequency: 'weekly',
			interval: 1,
			end: { kind: 'never' },
			anchor: 'schedule'
		})
	});
	const fern = add('Fern', parent.id);
	const cactus = add('Cactus', parent.id);
	updateTask(scope(user), cactus.id, { title: 'Cacti' }, 'occurrence');
	const before = wholeLists(scope(user), listId);

	const response = await DELETE(event(user, { params: { id: fern.id } }) as never);
	const answer = (await response.json()) as TaskChanges & { undo: string };
	expect(answer.undo).toEqual(expect.any(String));
	return { listId, parent, fern, cactus, before, undoId: answer.undo };
}

describe('POST /api/undo', () => {
	it('puts back what DELETE did, and answers with the Subtask and its parent', async () => {
		const { listId, parent, fern, before, undoId } = await deleteFern(alice);

		const response = await undo(alice, undoId);

		expect(response.status).toBe(200);
		expect(wholeLists(scope(alice), listId)).toEqual(before);
		const changes = (await response.json()) as TaskChanges;
		expect(changes.deleted).toEqual([]);
		expect(changes.upserted.map((task) => task.id).sort()).toEqual([parent.id, fern.id].sort());
		const answered = changes.upserted.find((task) => task.id === parent.id);
		expect(answered?.seriesTemplate?.subtasks?.map((entry) => entry.title)).toEqual([
			'Fern',
			'Cactus'
		]);
	});

	it('answers 404 for another User’s action, and leaves it undoable', async () => {
		const { fern, undoId } = await deleteFern(alice);

		expect(await status(() => undo(bob, undoId))).toBe(404);

		expect(getTask(scope(alice), fern.id)).toBeUndefined();
		expect(getTask(scope(bob), fern.id)).toBeUndefined();
		expect((await undo(alice, undoId)).status).toBe(200);
	});

	it('answers 404 the second time', async () => {
		const { undoId } = await deleteFern(alice);
		await undo(alice, undoId);

		expect(await status(() => undo(alice, undoId))).toBe(404);
	});

	it('answers 409 when the state has moved on, and overwrites nothing', async () => {
		const { listId, parent, undoId } = await deleteFern(alice);
		updateTask(scope(alice), parent.id, { title: 'Water it all' });
		const before = getListTasks(scope(alice), listId);

		expect(await status(() => undo(alice, undoId))).toBe(409);

		expect(getListTasks(scope(alice), listId)).toEqual(before);
	});

	it('answers 409 when a deleted Task’s id has been taken by another User', async () => {
		const { fern, undoId } = await deleteFern(alice);
		const bobsList = createList(scope(bob), { name: 'Bob' }).id;
		createTask(scope(bob), { id: fern.id, listId: bobsList, title: 'Bob’s' });

		expect(await status(() => undo(alice, undoId))).toBe(409);

		expect(getTask(scope(bob), fern.id)?.title).toBe('Bob’s');
	});

	it('answers 400 without an id', async () => {
		expect(await status(() => POST(event(alice, { body: {} }) as never))).toBe(400);
		expect(await status(() => undo(alice, 42))).toBe(400);
	});
});
