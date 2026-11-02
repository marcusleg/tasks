import { describe, expect, it } from 'vitest';
import {
	completedGroupsOf,
	completionChanges,
	nestingError,
	newTaskPosition,
	reopenChanges,
	subtasksOf
} from './subtasks';

type T = {
	id: string;
	parentId: string | null;
	completedAt: string | null;
	completedByCascade: boolean;
};

const NOW = '2026-11-02T10:00:00.000Z';
const EARLIER = '2026-11-01T09:00:00.000Z';

const task = (id: string, parentId: string | null = null, completedAt: string | null = null) =>
	({ id, parentId, completedAt, completedByCascade: false }) satisfies T;

describe('completionChanges', () => {
	it('completes the parent and all of its open Subtasks, marking those as closed by the cascade', () => {
		const tasks = [task('party'), task('cake', 'party'), task('candles', 'party'), task('milk')];

		expect(completionChanges(tasks, 'party', NOW)).toEqual([
			{ id: 'party', completedAt: NOW, completedByCascade: false },
			{ id: 'cake', completedAt: NOW, completedByCascade: true },
			{ id: 'candles', completedAt: NOW, completedByCascade: true }
		]);
	});

	it('leaves Subtasks the User already completed as they are', () => {
		const tasks = [task('party'), task('cake', 'party', EARLIER), task('candles', 'party')];

		expect(completionChanges(tasks, 'party', NOW)).toEqual([
			{ id: 'party', completedAt: NOW, completedByCascade: false },
			{ id: 'candles', completedAt: NOW, completedByCascade: true }
		]);
	});

	it('changes nothing for a Task that is already Completed, or unknown', () => {
		const tasks = [task('party', null, EARLIER), task('cake', 'party', EARLIER)];

		expect(completionChanges(tasks, 'party', NOW)).toEqual([]);
		expect(completionChanges(tasks, 'nope', NOW)).toEqual([]);
	});

	it('completing the last open Subtask leaves the parent open', () => {
		const tasks = [task('party'), task('cake', 'party', EARLIER), task('candles', 'party')];

		expect(completionChanges(tasks, 'candles', NOW)).toEqual([
			{ id: 'candles', completedAt: NOW, completedByCascade: false }
		]);
	});
});

describe('reopenChanges', () => {
	const byCascade = (id: string, parentId: string) => ({
		...task(id, parentId, NOW),
		completedByCascade: true
	});

	it('reopens the parent and exactly the Subtasks its completion closed', () => {
		const tasks = [
			task('party', null, NOW),
			task('cake', 'party', EARLIER),
			byCascade('candles', 'party'),
			byCascade('balloons', 'party'),
			task('milk', null, EARLIER)
		];

		expect(reopenChanges(tasks, 'party')).toEqual([
			{ id: 'party', completedAt: null, completedByCascade: false },
			{ id: 'candles', completedAt: null, completedByCascade: false },
			{ id: 'balloons', completedAt: null, completedByCascade: false }
		]);
	});

	it('changes nothing for a Task that is open, or unknown', () => {
		const tasks = [task('party'), task('cake', 'party', EARLIER)];

		expect(reopenChanges(tasks, 'party')).toEqual([]);
		expect(reopenChanges(tasks, 'nope')).toEqual([]);
	});

	it('reopens just the Subtask when its parent is open', () => {
		const tasks = [
			task('party'),
			task('cake', 'party', EARLIER),
			task('candles', 'party', EARLIER)
		];

		expect(reopenChanges(tasks, 'cake')).toEqual([
			{ id: 'cake', completedAt: null, completedByCascade: false }
		]);
	});

	it('reopening a Subtask of a Completed parent reopens the parent too, but not the other Subtasks', () => {
		const tasks = [
			task('party', null, NOW),
			byCascade('cake', 'party'),
			byCascade('candles', 'party'),
			task('balloons', 'party', EARLIER)
		];

		// The other cascade-closed Subtasks stay Completed; their completion now counts as the
		// User's, so a later Reopen of the parent leaves them alone.
		expect(reopenChanges(tasks, 'cake')).toEqual([
			{ id: 'cake', completedAt: null, completedByCascade: false },
			{ id: 'party', completedAt: null, completedByCascade: false },
			{ id: 'candles', completedByCascade: false }
		]);
	});
});

type Listed = T & { listId: string; position: string; title: string };

const listed = (
	title: string,
	position: string,
	{
		parent = null,
		completedAt = null
	}: { parent?: string | null; completedAt?: string | null } = {}
): Listed => ({ ...task(title, parent, completedAt), listId: 'l1', position, title });

const titles = (items: { title: string }[]) => items.map((item) => item.title);

describe('subtasksOf', () => {
	it('returns the Subtasks of a parent in Custom Order', () => {
		const tasks = [
			listed('party', 'a0'),
			listed('candles', 'a2', { parent: 'party' }),
			listed('cake', 'a1', { parent: 'party' }),
			listed('milk', 'a1'),
			listed('ham', 'a0', { parent: 'milk' })
		];

		expect(titles(subtasksOf(tasks, 'party'))).toEqual(['cake', 'candles']);
	});
});

describe('newTaskPosition', () => {
	it('puts a new top-level Task first and a new Subtask last among its siblings', () => {
		const siblings = [{ position: 'a1' }, { position: 'a0' }, { position: 'a2' }];

		expect(newTaskPosition(siblings, null) < 'a0').toBe(true);
		expect(newTaskPosition(siblings, 'party') > 'a2').toBe(true);
		expect(newTaskPosition([], null)).toBe('a0');
		expect(newTaskPosition([], 'party')).toBe('a0');
	});
});

describe('completedGroupsOf', () => {
	it('groups each Completed Task with its Subtasks, and Completed Subtasks of open parents under their parent', () => {
		const tasks = [
			listed('party', 'a0'),
			listed('candles', 'a2', { parent: 'party', completedAt: '2026-11-01T10:00:00.000Z' }),
			listed('cake', 'a1', { parent: 'party', completedAt: '2026-11-01T08:00:00.000Z' }),
			listed('balloons', 'a3', { parent: 'party' }),
			listed('trip', 'a1', { completedAt: '2026-11-02T10:00:00.000Z' }),
			listed('passport', 'a0', { parent: 'trip', completedAt: '2026-11-02T10:00:00.000Z' }),
			listed('milk', 'a2', { completedAt: '2026-10-30T10:00:00.000Z' }),
			listed('eggs', 'a3'),
			{ ...listed('elsewhere', 'a4', { completedAt: NOW }), listId: 'l2' }
		];

		const groups = completedGroupsOf(tasks, 'l1');

		// Most recently Completed first; a group of an open parent counts from its latest Subtask.
		expect(
			groups.map((group) => ({
				parent: group.parent.title,
				completed: group.parent.completedAt !== null,
				subtasks: titles(group.subtasks)
			}))
		).toEqual([
			{ parent: 'trip', completed: true, subtasks: ['passport'] },
			{ parent: 'party', completed: false, subtasks: ['cake', 'candles'] },
			{ parent: 'milk', completed: true, subtasks: [] }
		]);
	});
});

describe('nestingError', () => {
	it('allows a new Subtask under an open top-level Task', () => {
		expect(nestingError(task('party'))).toBeNull();
	});

	it('refuses Subtasks of a Subtask', () => {
		expect(nestingError(task('cake', 'party'))).toMatch(/Subtask can’t have Subtasks/);
	});

	it('refuses to make a Task with Subtasks a Subtask, or a Task its own Subtask', () => {
		expect(nestingError(task('party'), { id: 'trip', hasSubtasks: true })).toMatch(
			/Task with Subtasks can’t become a Subtask/
		);
		expect(nestingError(task('party'), { id: 'party', hasSubtasks: false })).toMatch(
			/its own Subtask/
		);
		expect(nestingError(task('party'), { id: 'milk', hasSubtasks: false })).toBeNull();
	});

	it('refuses an open Subtask under a Completed Task', () => {
		expect(nestingError(task('party', null, EARLIER))).toMatch(/Completed Task/);
	});
});
