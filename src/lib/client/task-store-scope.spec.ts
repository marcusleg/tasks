import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SerializedRecurrence } from '#lib/domain/recurrence.js';
import type { SerializedTask } from '#lib/domain/tasks.js';
import { api } from './api.js';
import { ScopedTasks, type ApplyTo, type ScopeQuestion } from './occurrence-scope.svelte';
import { TaskStore } from './tasks.svelte';
import { Toasts } from './toasts.svelte';

vi.mock('$app/navigation', () => ({ invalidate: vi.fn() }));
vi.mock('./api.js', () => {
	const changes = () => Promise.resolve({ upserted: [], deleted: [] });
	return {
		api: {
			createTask: vi.fn(changes),
			updateTask: vi.fn(changes),
			completeTask: vi.fn(changes),
			reopenTask: vi.fn(changes),
			moveTask: vi.fn(changes),
			deleteTask: vi.fn(() =>
				Promise.resolve({ upserted: [], deleted: [], removed: [], next: null })
			)
		}
	};
});

const RULE = { frequency: 'daily', interval: 1, end: { kind: 'never' } } as SerializedRecurrence;

function task(id: string, fields: Partial<SerializedTask> = {}): SerializedTask {
	return {
		id,
		listId: 'list',
		parentId: null,
		title: id,
		description: '',
		position: 'a0',
		planned: { kind: 'date', date: '2027-03-10' },
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
		createdAt: '2027-01-01T00:00:00.000Z',
		updatedAt: '2027-01-01T00:00:00.000Z',
		...fields
	} as SerializedTask;
}

function setup(...tasks: SerializedTask[]) {
	const store = new TaskStore(() => tasks, new Toasts());
	const asked: ScopeQuestion[] = [];
	const answers: (ApplyTo | null)[] = [];
	const prompt = {
		ask: vi.fn(async (question: ScopeQuestion) => {
			asked.push(question);
			return answers.shift() ?? null;
		})
	};
	return { store, prompt, answers, scopes: new ScopedTasks(prompt, store) };
}

const recurring = () => task('series', { recurrence: RULE });

beforeEach(() => {
	vi.clearAllMocks();
});

describe('what the store sends for the scope', () => {
	it('adds a Subtask with the answer, so "This occurrence" does not reach future ones', async () => {
		const { scopes, answers } = setup(recurring());
		answers.push('occurrence');
		await scopes.add('list', 'Fern', 'series');

		expect(api.createTask).toHaveBeenCalledOnce();
		expect(vi.mocked(api.createTask).mock.calls[0][0]).toMatchObject({
			title: 'Fern',
			parentId: 'series',
			applyTo: 'occurrence'
		});
	});

	it('adds a Task that does not recur without an applyTo', async () => {
		const { scopes } = setup(task('plain'));
		await scopes.add('list', 'Fern', 'plain');

		expect(vi.mocked(api.createTask).mock.calls[0][0]).not.toHaveProperty('applyTo');
	});

	it('updates and deletes with the answer', async () => {
		const { scopes, answers } = setup(recurring());
		answers.push('occurrence', 'future');
		await scopes.update('series', { title: 'x' }, { discard: vi.fn() });
		await scopes.remove('series');
		await vi.waitFor(() => expect(api.deleteTask).toHaveBeenCalled());

		expect(vi.mocked(api.updateTask).mock.calls[0][2]).toBe('occurrence');
		expect(vi.mocked(api.deleteTask).mock.calls[0][1]).toMatchObject({ applyTo: 'future' });
	});
});

describe('exemptions, through the real store', () => {
	it('completing a recurring Task is not asked about and is sent once', async () => {
		const { store, prompt } = setup(recurring());
		await store.complete('series');

		expect(prompt.ask).not.toHaveBeenCalled();
		expect(api.completeTask).toHaveBeenCalledOnce();
		expect(vi.mocked(api.completeTask).mock.calls[0]).toHaveLength(2); // id and time zone only
	});

	it('reopening a recurring Task is not asked about and is sent once', async () => {
		const { store, prompt } = setup({ ...recurring(), completedAt: '2027-03-10T00:00:00.000Z' });
		await store.reopen('series');

		expect(prompt.ask).not.toHaveBeenCalled();
		expect(api.reopenTask).toHaveBeenCalledOnce();
		expect(vi.mocked(api.reopenTask).mock.calls[0]).toEqual(['series']);
	});

	it('moving a recurring Task is not asked about and is sent once', async () => {
		const { store, prompt } = setup(recurring(), task('other', { position: 'a1' }));
		await store.move('series', { listId: 'list', parentId: null, after: 'other' });

		expect(prompt.ask).not.toHaveBeenCalled();
		expect(api.moveTask).toHaveBeenCalledOnce();
		expect(vi.mocked(api.moveTask).mock.calls[0][1]).not.toHaveProperty('applyTo');
	});

	it('moving a Subtask of a recurring Task is not asked about either', async () => {
		const { store, prompt } = setup(recurring(), task('sub', { parentId: 'series' }));
		await store.move('sub', { listId: 'list', parentId: null });

		expect(prompt.ask).not.toHaveBeenCalled();
		expect(api.moveTask).toHaveBeenCalledOnce();
	});
});
