import { describe, expect, it } from 'vitest';
import { moveToIndex, positionForMove, sortLists } from './lists';
import { InvalidInputError } from './validation';

const lists = [
	{ id: 'a', position: 'a0' },
	{ id: 'b', position: 'a1' },
	{ id: 'c', position: 'a2' }
];

function order(moved: string, move: Parameters<typeof positionForMove>[2]) {
	const position = positionForMove(lists, moved, move);
	return sortLists(lists.map((l) => (l.id === moved ? { ...l, position } : l))).map((l) => l.id);
}

describe('positionForMove', () => {
	it('moves a List before another', () => {
		expect(order('c', { before: 'a' })).toEqual(['c', 'a', 'b']);
		expect(order('c', { before: 'b' })).toEqual(['a', 'c', 'b']);
	});

	it('moves a List after another', () => {
		expect(order('a', { after: 'c' })).toEqual(['b', 'c', 'a']);
		expect(order('a', { after: 'b' })).toEqual(['b', 'a', 'c']);
	});

	it('rejects the List itself and unknown targets', () => {
		expect(() => positionForMove(lists, 'a', { before: 'a' })).toThrow(InvalidInputError);
		expect(() => positionForMove(lists, 'a', { after: 'x' })).toThrow(InvalidInputError);
	});
});

describe('moveToIndex', () => {
	it('describes a move to an index in the new order', () => {
		expect(moveToIndex(lists, 2, 0)).toEqual({ before: 'a' });
		expect(moveToIndex(lists, 0, 1)).toEqual({ after: 'b' });
		expect(moveToIndex(lists, 0, 2)).toEqual({ after: 'c' });
		expect(moveToIndex(lists, 1, 0)).toEqual({ before: 'a' });
	});

	it('returns null for no-ops and clamps', () => {
		expect(moveToIndex(lists, 1, 1)).toBeNull();
		expect(moveToIndex(lists, 0, -1)).toBeNull();
		expect(moveToIndex(lists, 2, 9)).toBeNull();
		expect(moveToIndex(lists, 0, 9)).toEqual({ after: 'c' });
	});
});
