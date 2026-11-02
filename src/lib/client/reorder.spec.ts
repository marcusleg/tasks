import { describe, expect, it } from 'vitest';
import { dropIndex } from './reorder';

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
