import { describe, expect, it } from 'vitest';
import { moveChanges, moveError, stepMove, type TaskMove } from './moves';
import { byCustomOrder } from './tasks';
import { InvalidInputError } from './validation';

type T = {
	id: string;
	listId: string;
	parentId: string | null;
	position: string;
	completedAt: string | null;
	recurrence: object | null;
};

const task = (id: string, position: string, extra: Partial<T> = {}): T => ({
	id,
	listId: 'inbox',
	parentId: null,
	position,
	completedAt: null,
	recurrence: null,
	...extra
});

/** Applies a move and lists the ids of (list, parent) in Custom Order. */
function after(tasks: T[], id: string, move: TaskMove): T[] {
	const changes = moveChanges(tasks, id, move);
	return tasks.map((t) => {
		const change = changes.find((c) => c.id === t.id);
		return change ? { ...t, ...change } : t;
	});
}

const order = (tasks: T[], listId: string, parentId: string | null = null) =>
	tasks
		.filter((t) => t.listId === listId && t.parentId === parentId)
		.sort(byCustomOrder)
		.map((t) => t.id);

const top = (listId = 'inbox') => ({ listId, parentId: null });

describe('moveChanges: reordering within a List', () => {
	const tasks = [task('a', 'a0'), task('b', 'a1'), task('c', 'a2')];

	it('moves a Task before another', () => {
		expect(order(after(tasks, 'c', { ...top(), before: 'a' }), 'inbox')).toEqual(['c', 'a', 'b']);
		expect(order(after(tasks, 'c', { ...top(), before: 'b' }), 'inbox')).toEqual(['a', 'c', 'b']);
	});

	it('moves a Task after another', () => {
		expect(order(after(tasks, 'a', { ...top(), after: 'c' }), 'inbox')).toEqual(['b', 'c', 'a']);
		expect(order(after(tasks, 'a', { ...top(), after: 'b' }), 'inbox')).toEqual(['b', 'a', 'c']);
	});

	it('without a neighbour, puts a Task at the top of the List', () => {
		expect(order(after(tasks, 'c', top()), 'inbox')).toEqual(['c', 'a', 'b']);
	});

	it('needs a neighbour among the new siblings, and only one', () => {
		const withSubtask = [...tasks, task('s', 'a0', { parentId: 'a' })];

		expect(moveError(tasks, 'a', { ...top(), before: 'a' })).toMatch(/next to itself/);
		expect(moveError(withSubtask, 'b', { ...top(), before: 's' })).toMatch(/Unknown neighbour/);
		expect(moveError(tasks, 'a', { ...top(), before: 'b', after: 'c' })).toMatch(/not both/);
		expect(moveError(tasks, 'a', { ...top('work'), before: 'b' })).toMatch(/Unknown neighbour/);
	});

	it('keeps the key when the Task is already in that place', () => {
		const spread = [task('a', 'a1'), task('b', 'a8'), task('c', 'a9')];

		expect(moveChanges(spread, 'b', { ...top(), after: 'a' })[0].position).toBe('a8');
		expect(moveChanges(spread, 'b', { ...top(), before: 'c' })[0].position).toBe('a8');
		expect(moveChanges(spread, 'a', top())[0].position).toBe('a1');
	});

	it('changes only the moved Task', () => {
		expect(moveChanges(tasks, 'c', { ...top(), before: 'b' })).toEqual([
			{ id: 'c', listId: 'inbox', parentId: null, position: 'a0V' }
		]);
	});
});

describe('moveChanges: between Lists', () => {
	const tasks = [
		task('party', 'a0'),
		task('cake', 'a0', { parentId: 'party' }),
		task('candles', 'a1', { parentId: 'party', completedAt: '2026-11-01T00:00:00.000Z' }),
		task('milk', 'a1'),
		task('report', 'a0', { listId: 'work' }),
		task('slides', 'a1', { listId: 'work' })
	];

	it('moves a Task to another List, with all of its Subtasks', () => {
		const moved = after(tasks, 'party', { ...top('work'), after: 'report' });

		expect(order(moved, 'work')).toEqual(['report', 'party', 'slides']);
		expect(order(moved, 'work', 'party')).toEqual(['cake', 'candles']);
		expect(order(moved, 'inbox')).toEqual(['milk']);
		expect(moved.filter((t) => t.listId === 'inbox').map((t) => t.id)).toEqual(['milk']);
	});

	it('puts a Task at the top of the other List without a neighbour', () => {
		expect(order(after(tasks, 'milk', top('work')), 'work')).toEqual(['milk', 'report', 'slides']);
	});

	it('makes a Subtask a top-level Task of the other List, or a Subtask of a Task there', () => {
		expect(order(after(tasks, 'cake', top('work')), 'work')).toEqual(['cake', 'report', 'slides']);

		const nested = after(tasks, 'cake', { listId: 'work', parentId: 'report' });
		expect(order(nested, 'work', 'report')).toEqual(['cake']);
		expect(order(nested, 'inbox', 'party')).toEqual(['candles']);
	});
});

describe('moveChanges: nesting and promoting', () => {
	const tasks = [
		task('party', 'a0'),
		task('cake', 'a0', { parentId: 'party' }),
		task('candles', 'a1', { parentId: 'party' }),
		task('milk', 'a1'),
		task('eggs', 'a2')
	];
	const under = (parentId: string) => ({ listId: 'inbox', parentId });

	it('makes a Task a Subtask, at the bottom of its new parent’s Subtasks by default', () => {
		const moved = after(tasks, 'milk', under('party'));

		expect(order(moved, 'inbox', 'party')).toEqual(['cake', 'candles', 'milk']);
		expect(order(moved, 'inbox')).toEqual(['party', 'eggs']);
	});

	it('places a new Subtask next to a sibling Subtask', () => {
		const moved = after(tasks, 'milk', { ...under('party'), before: 'candles' });

		expect(order(moved, 'inbox', 'party')).toEqual(['cake', 'milk', 'candles']);
	});

	it('reorders Subtasks within their parent', () => {
		const moved = after(tasks, 'candles', { ...under('party'), before: 'cake' });

		expect(order(moved, 'inbox', 'party')).toEqual(['candles', 'cake']);
	});

	it('promotes a Subtask to the top level', () => {
		const moved = after(tasks, 'cake', { ...top(), after: 'party' });

		expect(order(moved, 'inbox')).toEqual(['party', 'cake', 'milk', 'eggs']);
		expect(order(moved, 'inbox', 'party')).toEqual(['candles']);
	});

	it('keeps nesting one level deep', () => {
		expect(moveError(tasks, 'milk', under('cake'))).toMatch(/Subtask can’t have Subtasks/);
		expect(moveError(tasks, 'party', under('milk'))).toMatch(/Task with Subtasks/);
		expect(moveError(tasks, 'milk', under('milk'))).toMatch(/its own Subtask/);
		expect(() => moveChanges(tasks, 'party', under('milk'))).toThrow(InvalidInputError);
	});

	it('doesn’t give a recurring parent a recurring Subtask', () => {
		const weekly = { frequency: 'weekly' };
		const recurring = [
			task('chores', 'a0', { recurrence: weekly }),
			task('bins', 'a1', { recurrence: weekly }),
			task('dishes', 'a2')
		];

		expect(moveError(recurring, 'bins', under('chores'))).toMatch(/can’t both recur/);
		expect(moveError(recurring, 'dishes', under('chores'))).toBeNull();
		expect(moveError(recurring, 'chores', under('dishes'))).toBeNull();
	});

	it('needs an open parent in the target List', () => {
		const withOther = [...tasks, task('work', 'a0', { listId: 'work' })];
		const done = [...tasks, task('old', 'a3', { completedAt: '2026-11-01T00:00:00.000Z' })];

		expect(moveError(withOther, 'milk', { listId: 'inbox', parentId: 'work' })).toMatch(
			/same List/
		);
		expect(moveError(tasks, 'milk', under('nope'))).toMatch(/Unknown parent/);
		expect(moveError(done, 'milk', under('old'))).toMatch(/Completed Task can’t get/);
	});

	it('doesn’t move Completed Tasks', () => {
		const done = [...tasks, task('old', 'a3', { completedAt: '2026-11-01T00:00:00.000Z' })];

		expect(moveError(done, 'old', { ...top(), before: 'party' })).toMatch(/Completed/);
	});
});

describe('stepMove: the keyboard alternative', () => {
	const DONE = '2026-11-01T00:00:00.000Z';
	const tasks = [
		task('party', 'a0'),
		task('cake', 'a0', { parentId: 'party' }),
		task('candles', 'a1', { parentId: 'party' }),
		task('old', 'a1', { completedAt: DONE }),
		task('milk', 'a2'),
		task('eggs', 'a3')
	];

	it('moves up and down among the open siblings', () => {
		expect(stepMove(tasks, 'milk', 'up')).toEqual({ ...top(), before: 'party' });
		expect(stepMove(tasks, 'milk', 'down')).toEqual({ ...top(), after: 'eggs' });
		expect(stepMove(tasks, 'candles', 'up')).toEqual({
			listId: 'inbox',
			parentId: 'party',
			before: 'cake'
		});
	});

	it('does nothing at either end', () => {
		expect(stepMove(tasks, 'party', 'up')).toBeNull();
		expect(stepMove(tasks, 'eggs', 'down')).toBeNull();
		expect(stepMove(tasks, 'candles', 'down')).toBeNull();
	});

	it('indents a Task under the open Task above it, at the bottom of its Subtasks', () => {
		expect(stepMove(tasks, 'milk', 'indent')).toEqual({ listId: 'inbox', parentId: 'party' });
		expect(stepMove(tasks, 'party', 'indent')).toBeNull();
		expect(stepMove(tasks, 'cake', 'indent')).toBeNull();
	});

	it('outdents a Subtask to right after its parent', () => {
		expect(stepMove(tasks, 'cake', 'outdent')).toEqual({ ...top(), after: 'party' });
		expect(stepMove(tasks, 'milk', 'outdent')).toBeNull();
	});
});
