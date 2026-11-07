import { describe, expect, it, vi } from 'vitest';
import type { SerializedRecurrence } from '#lib/domain/recurrence.js';
import type { SerializedTask } from '#lib/domain/tasks.js';
import {
	ScopedTasks,
	seriesTarget,
	type ApplyTo,
	type Scope,
	type ScopedStore,
	type ScopeQuestion
} from './occurrence-scope.svelte';

const RULE = { frequency: 'daily', interval: 1 } as unknown as SerializedRecurrence;

function task(id: string, fields: Partial<SerializedTask> = {}): SerializedTask {
	return {
		id,
		listId: 'list',
		parentId: null,
		title: id,
		completedAt: null,
		recurrence: null,
		...fields
	} as SerializedTask;
}

/** A prompt that answers from a script and records what it was asked. */
function fakePrompt(...answers: (ApplyTo | null)[]) {
	const asked: ScopeQuestion[] = [];
	return {
		asked,
		ask: vi.fn(async (question: ScopeQuestion) => {
			asked.push(question);
			return answers.shift() ?? null;
		})
	};
}

/** A store that records the scope each change was sent with. */
function fakeStore(...tasks: SerializedTask[]) {
	const byId = new Map(tasks.map((t) => [t.id, t]));
	const sent: { call: string; id: string; applyTo: ApplyTo | undefined }[] = [];
	const store: ScopedStore = {
		get: (id) => (id ? byId.get(id) : undefined),
		add: (_listId, title, _parentId, scope: Scope) => {
			sent.push({ call: 'add', id: title, applyTo: scope.applyTo });
			return 'new-id';
		},
		update: async (id, _patch, scope) => {
			sent.push({ call: 'update', id, applyTo: scope.applyTo });
			return true;
		},
		remove: async (id, scope) => {
			sent.push({ call: 'remove', id, applyTo: scope.applyTo });
			return true;
		}
	};
	return { store, sent };
}

const recurring = task('series', { recurrence: RULE });
const subtask = task('sub', { parentId: 'series' });
const plain = task('plain');

describe('seriesTarget', () => {
	it('targets an open recurring Task, or the open recurring parent of a Subtask', () => {
		expect(seriesTarget(recurring, undefined)).toEqual({ series: recurring });
		expect(seriesTarget(subtask, recurring)).toEqual({ series: recurring, subtask });
	});

	it('targets nothing for a plain Task, a Completed one, or a Subtask of a Completed parent', () => {
		expect(seriesTarget(plain, undefined)).toBeNull();
		expect(seriesTarget({ ...recurring, completedAt: 'x' }, undefined)).toBeNull();
		expect(seriesTarget(subtask, { ...recurring, completedAt: 'x' })).toBeNull();
		expect(seriesTarget(undefined, undefined)).toBeNull();
	});
});

describe('ScopedTasks.update', () => {
	it('does not ask about a Task that does not recur, and sends no scope', async () => {
		const prompt = fakePrompt();
		const { store, sent } = fakeStore(plain);
		await new ScopedTasks(prompt, store).update(
			'plain',
			{ priority: 'high' },
			{ discard: vi.fn() }
		);

		expect(prompt.ask).not.toHaveBeenCalled();
		expect(sent).toEqual([{ call: 'update', id: 'plain', applyTo: undefined }]);
	});

	it('asks about a recurring Task and sends the answer', async () => {
		const prompt = fakePrompt('occurrence');
		const { store, sent } = fakeStore(recurring);
		await new ScopedTasks(prompt, store).update('series', { title: 'x' }, { discard: vi.fn() });

		expect(prompt.asked).toEqual([
			{ action: 'edit', seriesTitle: 'series', subtaskTitle: undefined, remembersFor: undefined }
		]);
		expect(sent).toEqual([{ call: 'update', id: 'series', applyTo: 'occurrence' }]);
	});

	it('asks about a Subtask of a recurring Task, naming both', async () => {
		const prompt = fakePrompt('future');
		const { store, sent } = fakeStore(recurring, subtask);
		await new ScopedTasks(prompt, store).update('sub', { title: 'x' }, { discard: vi.fn() });

		expect(prompt.asked[0]).toMatchObject({ seriesTitle: 'series', subtaskTitle: 'sub' });
		expect(sent).toEqual([{ call: 'update', id: 'sub', applyTo: 'future' }]);
	});

	it('does not ask about a Completed recurring Task', async () => {
		const prompt = fakePrompt();
		const { store, sent } = fakeStore({ ...recurring, completedAt: 'x' });
		await new ScopedTasks(prompt, store).update('series', { title: 'x' }, { discard: vi.fn() });

		expect(prompt.ask).not.toHaveBeenCalled();
		expect(sent).toHaveLength(1);
	});

	it('discards on cancel and sends nothing', async () => {
		const prompt = fakePrompt(null);
		const { store, sent } = fakeStore(recurring);
		const discard = vi.fn();
		await new ScopedTasks(prompt, store).update('series', { title: 'x' }, { discard });

		expect(discard).toHaveBeenCalledOnce();
		expect(sent).toEqual([]);
	});

	it('does not discard when the change goes through', async () => {
		const prompt = fakePrompt('future');
		const { store } = fakeStore(recurring);
		const discard = vi.fn();
		await new ScopedTasks(prompt, store).update('series', { title: 'x' }, { discard });

		expect(discard).not.toHaveBeenCalled();
	});

	it('evaluates a patch function after the answer, and sends nothing when it returns null', async () => {
		const prompt = fakePrompt('future');
		const { store, sent } = fakeStore(recurring);
		const patch = vi.fn(() => null);
		await new ScopedTasks(prompt, store).update('series', patch, { discard: vi.fn() });

		expect(prompt.ask).toHaveBeenCalledOnce();
		expect(patch).toHaveBeenCalledOnce();
		expect(sent).toEqual([]);
	});

	it('asks again every time without a panel to remember', async () => {
		const prompt = fakePrompt('occurrence', 'future');
		const { store, sent } = fakeStore(recurring);
		const scopes = new ScopedTasks(prompt, store);
		await scopes.update('series', { priority: 'low' }, { discard: vi.fn() });
		await scopes.update('series', { priority: 'high' }, { discard: vi.fn() });

		expect(prompt.ask).toHaveBeenCalledTimes(2);
		expect(sent.map((s) => s.applyTo)).toEqual(['occurrence', 'future']);
		expect(scopes.chosen).toEqual({});
	});
});

describe('ScopedTasks in a panel (remembers)', () => {
	it('asks once per field group and reuses the answer', async () => {
		const prompt = fakePrompt('occurrence', 'future');
		const { store, sent } = fakeStore(recurring);
		const scopes = new ScopedTasks(prompt, store, { remembers: true });
		const options = { discard: vi.fn() };

		expect(scopes.unanswered('series', 'details')).toBe(true);
		await scopes.update('series', { title: 'a' }, options);
		await scopes.update('series', { priority: 'low' }, options);
		expect(scopes.unanswered('series', 'details')).toBe(false);
		expect(scopes.unanswered('series', 'dates')).toBe(true);
		await scopes.update('series', { title: 'b' }, { ...options, group: 'dates' });

		expect(prompt.asked.map((q) => q.remembersFor)).toEqual([
			'title, details and priority changes',
			'date changes'
		]);
		expect(sent.map((s) => s.applyTo)).toEqual(['occurrence', 'occurrence', 'future']);
		expect(scopes.chosen).toEqual({ details: 'occurrence', dates: 'future' });
	});

	it('treats every change in a Subtask panel as a subtasks change', async () => {
		const prompt = fakePrompt('occurrence');
		const { store, sent } = fakeStore(recurring, subtask);
		const scopes = new ScopedTasks(prompt, store, { remembers: true });
		const options = { discard: vi.fn() };

		await scopes.update('sub', { title: 'a' }, options);
		await scopes.update('sub', { title: 'b' }, { ...options, group: 'dates' });

		expect(prompt.ask).toHaveBeenCalledOnce();
		expect(prompt.asked[0].remembersFor).toBe('subtask changes');
		expect(sent.map((s) => s.applyTo)).toEqual(['occurrence', 'occurrence']);
		expect(scopes.chosen).toEqual({ subtasks: 'occurrence' });
	});

	it('does not remember a cancel', async () => {
		const prompt = fakePrompt(null, 'future');
		const { store, sent } = fakeStore(recurring);
		const scopes = new ScopedTasks(prompt, store, { remembers: true });
		const options = { discard: vi.fn() };

		await scopes.update('series', { title: 'a' }, options);
		expect(scopes.chosen).toEqual({});
		expect(scopes.unanswered('series', 'details')).toBe(true);
		await scopes.update('series', { title: 'a' }, options);

		expect(options.discard).toHaveBeenCalledOnce();
		expect(sent.map((s) => s.applyTo)).toEqual(['future']);
	});

	it('asks again after forget()', async () => {
		const prompt = fakePrompt('occurrence', 'future');
		const { store, sent } = fakeStore(recurring);
		const scopes = new ScopedTasks(prompt, store, { remembers: true });
		const options = { discard: vi.fn() };

		await scopes.update('series', { title: 'a' }, options);
		scopes.forget();
		await scopes.update('series', { title: 'b' }, options);

		expect(sent.map((s) => s.applyTo)).toEqual(['occurrence', 'future']);
	});

	it('has nothing to ask about for a Task that does not recur', () => {
		const { store } = fakeStore(plain);
		expect(
			new ScopedTasks(fakePrompt(), store, { remembers: true }).unanswered('plain', 'dates')
		).toBe(false);
	});

	it('reads the Task when the change is committed, not when the scopes were made', async () => {
		const prompt = fakePrompt('future');
		const tasks = [plain];
		const store: ScopedStore = {
			...fakeStore().store,
			get: (id) => tasks.find((t) => t.id === id)
		};
		const scopes = new ScopedTasks(prompt, store, { remembers: true });
		expect(scopes.unanswered('plain', 'details')).toBe(false);

		tasks[0] = task('plain', { recurrence: RULE });
		expect(scopes.unanswered('plain', 'details')).toBe(true);
	});

	it('queues questions, answering one at a time', async () => {
		const resolvers: ((choice: ApplyTo | null) => void)[] = [];
		const asked: string[] = [];
		const prompt = {
			ask: (question: ScopeQuestion) => {
				asked.push(question.remembersFor ?? '');
				return new Promise<ApplyTo | null>((resolve) => resolvers.push(resolve));
			}
		};
		const { store, sent } = fakeStore(recurring);
		const scopes = new ScopedTasks(prompt, store);
		const options = { discard: vi.fn() };

		const first = scopes.update('series', { title: 'a' }, options);
		const second = scopes.update('series', { title: 'b' }, options);
		expect(resolvers).toHaveLength(2);
		resolvers[0]('occurrence');
		resolvers[1]('future');
		await Promise.all([first, second]);

		expect(sent.map((s) => s.applyTo)).toEqual(['occurrence', 'future']);
	});
});

describe('ScopedTasks.add', () => {
	it('adds a top-level Task without asking', async () => {
		const prompt = fakePrompt();
		const { store, sent } = fakeStore(recurring);
		const id = await new ScopedTasks(prompt, store).add('list', 'new');

		expect(id).toBe('new-id');
		expect(prompt.ask).not.toHaveBeenCalled();
		expect(sent).toEqual([{ call: 'add', id: 'new', applyTo: undefined }]);
	});

	it('adds a Subtask of a Task that does not recur without asking', async () => {
		const prompt = fakePrompt();
		const { store, sent } = fakeStore(plain);
		await new ScopedTasks(prompt, store).add('list', 'new', 'plain');

		expect(prompt.ask).not.toHaveBeenCalled();
		expect(sent).toHaveLength(1);
	});

	it('asks about a Subtask of a recurring Task, remembered as subtasks changes in a panel', async () => {
		const prompt = fakePrompt('occurrence');
		const { store, sent } = fakeStore(recurring);
		const scopes = new ScopedTasks(prompt, store, { remembers: true });
		await scopes.add('list', 'one', 'series');
		await scopes.add('list', 'two', 'series');

		expect(prompt.ask).toHaveBeenCalledOnce();
		expect(prompt.asked[0]).toMatchObject({
			action: 'edit',
			seriesTitle: 'series',
			remembersFor: 'subtask changes'
		});
		expect(sent.map((s) => s.applyTo)).toEqual(['occurrence', 'occurrence']);
	});

	it('adds nothing on cancel and resolves to null', async () => {
		const prompt = fakePrompt(null);
		const { store, sent } = fakeStore(recurring);
		const id = await new ScopedTasks(prompt, store).add('list', 'new', 'series');

		expect(id).toBeNull();
		expect(sent).toEqual([]);
	});
});

describe('ScopedTasks.remove', () => {
	it('deletes a Task that does not recur without asking', async () => {
		const prompt = fakePrompt();
		const { store, sent } = fakeStore(plain);
		const onConfirmed = vi.fn();

		expect(await new ScopedTasks(prompt, store).remove('plain', onConfirmed)).toBe(true);
		expect(prompt.ask).not.toHaveBeenCalled();
		expect(onConfirmed).toHaveBeenCalledOnce();
		expect(sent).toEqual([{ call: 'remove', id: 'plain', applyTo: undefined }]);
	});

	it('always asks about a recurring Task, even in a panel that remembers', async () => {
		const prompt = fakePrompt('occurrence', 'future');
		const { store, sent } = fakeStore(recurring);
		const scopes = new ScopedTasks(prompt, store, { remembers: true });
		await scopes.remove('series');
		await scopes.remove('series');

		expect(prompt.asked.map((q) => q.action)).toEqual(['delete', 'delete']);
		expect(prompt.asked[0].remembersFor).toBeUndefined();
		expect(sent.map((s) => s.applyTo)).toEqual(['occurrence', 'future']);
		expect(scopes.chosen).toEqual({});
	});

	it('names the Subtask when deleting one of a recurring Task', async () => {
		const prompt = fakePrompt('occurrence');
		const { store } = fakeStore(recurring, subtask);
		await new ScopedTasks(prompt, store).remove('sub');

		expect(prompt.asked[0]).toMatchObject({ seriesTitle: 'series', subtaskTitle: 'sub' });
	});

	it('deletes nothing on cancel', async () => {
		const prompt = fakePrompt(null);
		const { store, sent } = fakeStore(recurring);
		const onConfirmed = vi.fn();

		expect(await new ScopedTasks(prompt, store).remove('series', onConfirmed)).toBe(false);
		expect(onConfirmed).not.toHaveBeenCalled();
		expect(sent).toEqual([]);
	});
});

describe('exemptions', () => {
	it('changing the Recurrence is never asked about', async () => {
		const prompt = fakePrompt();
		const { store, sent } = fakeStore(recurring);
		await new ScopedTasks(prompt, store).setRecurrence('series', null);

		expect(prompt.ask).not.toHaveBeenCalled();
		expect(sent).toEqual([{ call: 'update', id: 'series', applyTo: undefined }]);
	});
});
