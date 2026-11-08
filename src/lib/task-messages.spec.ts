import { describe, expect, it } from 'vitest';
import { m } from '#lib/paraglide/messages.js';
import { moveProblem } from '#lib/domain/moves.js';

/** Count-based text follows each Language's plural rules (README → Translations). */
describe('count-based messages', () => {
	it('deleting completed Tasks names the count correctly in English', () => {
		const en = (count: number) =>
			m.confirm_delete_completed_message({ count, name: 'Home' }, { locale: 'en' });
		expect(en(0)).toBe('0 completed tasks in “Home” will be deleted. This can’t be undone.');
		expect(en(1)).toBe('1 completed task in “Home” will be deleted. This can’t be undone.');
		expect(en(3)).toBe('3 completed tasks in “Home” will be deleted. This can’t be undone.');
	});

	it('deleting completed Tasks names the count correctly in German', () => {
		const de = (count: number) =>
			m.confirm_delete_completed_message({ count, name: 'Zuhause' }, { locale: 'de' });
		expect(de(0)).toContain('0 erledigte Aufgaben in „Zuhause“ werden gelöscht.');
		expect(de(1)).toContain('1 erledigte Aufgabe in „Zuhause“ wird gelöscht.');
		expect(de(3)).toContain('3 erledigte Aufgaben in „Zuhause“ werden gelöscht.');
	});

	it('Subtask progress agrees with the number of Subtasks', () => {
		const progress = (total: number, locale: 'en' | 'de') =>
			m.subtask_progress({ done: 0, total }, { locale });
		expect(progress(1, 'en')).toBe('0 of 1 subtask completed');
		expect(progress(2, 'en')).toBe('0 of 2 subtasks completed');
		expect(progress(1, 'de')).toBe('0 von 1 Unteraufgabe erledigt');
		expect(progress(2, 'de')).toBe('0 von 2 Unteraufgaben erledigt');
	});
});

describe('moveProblem', () => {
	const task = {
		id: 'a',
		listId: 'l',
		parentId: null,
		position: 'a0',
		completedAt: null,
		completedByCascade: false,
		recurrence: null
	};

	it('gives a code instead of an English sentence', () => {
		expect(moveProblem([task], 'a', { listId: 'l', parentId: 'a' })).toBe('own-subtask');
		expect(moveProblem([task], 'a', { listId: 'l', parentId: null, before: 'a' })).toBe(
			'next-to-itself'
		);
		expect(moveProblem([{ ...task, completedAt: 'x' }], 'a', { listId: 'l', parentId: null })).toBe(
			'completed'
		);
		expect(moveProblem([task], 'a', { listId: 'l', parentId: null })).toBeNull();
	});
});
