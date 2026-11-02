import { describe, expect, it } from 'vitest';
import { dropIndex, dropMove } from './reorder';

describe('dropIndex', () => {
	const mids = [10, 30, 50];

	it('counts the entries above the pointer', () => {
		expect(dropIndex(mids, 0)).toBe(0);
		expect(dropIndex(mids, 20)).toBe(1);
		expect(dropIndex(mids, 49)).toBe(2);
		expect(dropIndex(mids, 500)).toBe(3);
	});

	it('is 0 when there are no other entries', () => {
		expect(dropIndex([], 100)).toBe(0);
	});
});

describe('dropMove', () => {
	// What a column shows: Party (with Cake, Candles), Milk.
	const rows = [
		{ id: 'party', parentId: null },
		{ id: 'cake', parentId: 'party' },
		{ id: 'candles', parentId: 'party' },
		{ id: 'milk', parentId: null }
	];
	const L = 'inbox';

	it('drops at the top level between top-level rows', () => {
		expect(dropMove(L, rows, 0, 0)).toEqual({
			depth: 0,
			move: { listId: L, parentId: null, before: 'party' }
		});
		expect(dropMove(L, rows, 3, 0)).toEqual({
			depth: 0,
			move: { listId: L, parentId: null, before: 'milk' }
		});
		expect(dropMove(L, rows, 4, 0)).toEqual({
			depth: 0,
			move: { listId: L, parentId: null, after: 'milk' }
		});
	});

	it('nests under the row above when dragged to the right', () => {
		// Right below Milk: a Subtask of Milk (at the bottom of any it has).
		expect(dropMove(L, rows, 4, 1)).toEqual({ depth: 1, move: { listId: L, parentId: 'milk' } });
		// Right below Party, before Cake.
		expect(dropMove(L, rows, 1, 1)).toEqual({
			depth: 1,
			move: { listId: L, parentId: 'party', before: 'cake' }
		});
		// Below Candles, the last Subtask of Party.
		expect(dropMove(L, rows, 3, 1)).toEqual({
			depth: 1,
			move: { listId: L, parentId: 'party', after: 'candles' }
		});
	});

	it('stays a Subtask between two Subtasks, whatever the pointer says', () => {
		expect(dropMove(L, rows, 2, 0)).toEqual({
			depth: 1,
			move: { listId: L, parentId: 'party', before: 'candles' }
		});
	});

	it('can’t nest at the very top', () => {
		expect(dropMove(L, rows, 0, 1)).toEqual({
			depth: 0,
			move: { listId: L, parentId: null, before: 'party' }
		});
	});

	it('drops into an empty column at the top level', () => {
		expect(dropMove(L, [], 0, 1)).toEqual({ depth: 0, move: { listId: L, parentId: null } });
	});

	it('after a trailing Subtask, goes after its parent at the top level', () => {
		const short = rows.slice(0, 3);
		expect(dropMove(L, short, 3, 0)).toEqual({
			depth: 0,
			move: { listId: L, parentId: null, after: 'party' }
		});
	});
});
