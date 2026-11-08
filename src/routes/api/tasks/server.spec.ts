import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '#lib/server/db/client.js';
import type { User } from '#lib/server/db/schema.js';
import { createList } from '#lib/server/lists.js';
import { completeTask, createTask } from '#lib/server/tasks.js';
import { createTestDb, insertUser } from '#lib/server/testing/index.js';

let db: Db;
vi.mock('#lib/server/db.js', () => ({ getDb: () => db }));

const { POST } = await import('./+server');

let alice: User;

beforeEach(() => {
	db = createTestDb();
	alice = insertUser(db, 'alice');
});

const scope = () => ({ db, userId: alice.id });

function post(body: object) {
	const url = new URL('http://localhost/api/tasks');
	const request = new Request(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
	return POST({ locals: { user: alice }, request, url, params: {} } as unknown as Parameters<
		typeof POST
	>[0]);
}

async function failure(body: object) {
	try {
		await post(body);
	} catch (cause) {
		return cause as { status: number; body: { code?: string } };
	}
	throw new Error('Expected an error');
}

describe('POST /api/tasks errors', () => {
	it('tells a missing List or parent Task from the code', async () => {
		const listId = createList(scope(), { name: 'Chores' }).id;

		const noList = await failure({ listId: crypto.randomUUID(), title: 'A' });
		expect([noList.status, noList.body.code]).toEqual([404, 'task_or_list_not_found']);

		const noParent = await failure({ listId, title: 'A', parentId: crypto.randomUUID() });
		expect([noParent.status, noParent.body.code]).toEqual([404, 'task_or_list_not_found']);
	});

	it('gives a Subtask under a Completed parent the code parent_unavailable', async () => {
		const listId = createList(scope(), { name: 'Chores' }).id;
		const parent = createTask(scope(), { listId, title: 'Parent' })!.upserted[0];
		completeTask(scope(), parent.id);

		const refused = await failure({ listId, title: 'Child', parentId: parent.id });

		expect([refused.status, refused.body.code]).toEqual([400, 'parent_unavailable']);
	});
});
