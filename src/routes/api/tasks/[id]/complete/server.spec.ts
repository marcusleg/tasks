import type { RequestEvent } from '@sveltejs/kit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TaskChanges } from '#lib/domain/tasks.js';
import type { Db } from '#lib/server/db/client.js';
import type { User } from '#lib/server/db/schema.js';
import { createList } from '#lib/server/lists.js';
import { createTask, getTask } from '#lib/server/tasks.js';
import { createTestDb, insertUser } from '#lib/server/testing/index.js';

// The endpoints open the app's database through `getDb`; hand them an in-memory one instead.
let db: Db;
vi.mock('#lib/server/db.js', () => ({ getDb: () => db }));

const { POST } = await import('./+server');
const { POST: undoPost } = await import('../../../undo/+server');

let alice: User;

beforeEach(() => {
	db = createTestDb();
	alice = insertUser(db, 'alice');
});

function post(handler: typeof POST | typeof undoPost, id: string, body: object) {
	const url = new URL(`http://localhost/api/tasks/${id}/complete`);
	const request = new Request(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
	return (handler as (event: RequestEvent) => Promise<Response>)({
		locals: { user: alice },
		request,
		url,
		params: { id }
	} as unknown as RequestEvent);
}

function milk() {
	const scope = { db, userId: alice.id };
	const listId = createList(scope, { name: 'Chores' }).id;
	return { scope, task: createTask(scope, { listId, title: 'Milk' })!.upserted[0] };
}

describe('POST /api/tasks/[id]/complete', () => {
	it('answers with an undo that POST /api/undo takes', async () => {
		const { scope, task } = milk();

		const answer = (await (await post(POST, task.id, {})).json()) as TaskChanges & {
			undo: string | null;
		};
		expect(answer.undo).toEqual(expect.any(String));
		expect(getTask(scope, task.id)?.completedAt).not.toBeNull();

		const undone = await post(undoPost, task.id, { undoId: answer.undo });
		expect(undone.status).toBe(200);
		expect(getTask(scope, task.id)?.completedAt).toBeNull();
	});

	it('answers undo null when nothing changed', async () => {
		const { task } = milk();
		await post(POST, task.id, {});

		const again = (await (await post(POST, task.id, {})).json()) as { undo: string | null };

		expect(again.undo).toBeNull();
	});
});
