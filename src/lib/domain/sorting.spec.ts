import { describe, expect, it } from 'vitest';
import { sortTasks, type SortableTask } from './sorting';

let n = 0;
function task(over: Partial<SortableTask> & { id: string }): SortableTask {
	n += 1;
	return {
		title: over.id,
		position: String.fromCharCode(96 + n),
		planned: null,
		due: null,
		priority: null,
		...over
	} as SortableTask;
}
const ids = (tasks: SortableTask[]) => tasks.map((t) => t.id);
const due = (date: string) => ({ kind: 'date', date }) as SortableTask['due'];
const dueAt = (dateTime: string, timeZone: string) =>
	({ kind: 'timed', dateTime, timeZone }) as SortableTask['due'];

describe('sortTasks', () => {
	it('custom keeps Custom Order, whatever order the input has', () => {
		const a = task({ id: 'a', position: 'a0' });
		const b = task({ id: 'b', position: 'a1' });
		expect(ids(sortTasks([b, a], 'custom', 'UTC'))).toEqual(['a', 'b']);
	});

	it('does not change the input', () => {
		const list = [task({ id: 'x', position: 'b' }), task({ id: 'y', position: 'a' })];
		sortTasks(list, 'custom', 'UTC');
		expect(ids(list)).toEqual(['x', 'y']);
	});

	it('due: earliest first, undated last in Custom Order', () => {
		const none1 = task({ id: 'none1', position: 'a' });
		const late = task({ id: 'late', position: 'b', due: due('2026-12-01') });
		const none2 = task({ id: 'none2', position: 'c' });
		const early = task({ id: 'early', position: 'd', due: due('2026-11-01') });
		expect(ids(sortTasks([none1, late, none2, early], 'due', 'UTC'))).toEqual([
			'early',
			'late',
			'none1',
			'none2'
		]);
	});

	it('due: date-only comes before timed on the same day', () => {
		const timed = task({ id: 'timed', position: 'a', due: dueAt('2026-11-01T08:00', 'UTC') });
		const day = task({ id: 'day', position: 'b', due: due('2026-11-01') });
		expect(ids(sortTasks([timed, day], 'due', 'UTC'))).toEqual(['day', 'timed']);
	});

	it('due: timed values are ordered by instant in the viewer’s day', () => {
		// 23:30 Berlin on the 1st is the 2nd in Tokyo, after a date-only 2026-11-01 there.
		const berlin = task({
			id: 'berlin',
			position: 'a',
			due: dueAt('2026-11-01T23:30', 'Europe/Berlin')
		});
		const day = task({ id: 'day', position: 'b', due: due('2026-11-01') });
		expect(ids(sortTasks([berlin, day], 'due', 'Europe/Berlin'))).toEqual(['day', 'berlin']);
		expect(ids(sortTasks([berlin, day], 'due', 'Asia/Tokyo'))).toEqual(['day', 'berlin']);
		const later = task({
			id: 'later',
			position: 'c',
			due: dueAt('2026-11-01T20:00', 'America/New_York')
		});
		// 20:00 New York is 01:00 Berlin on the 2nd.
		expect(ids(sortTasks([later, berlin], 'due', 'UTC'))).toEqual(['berlin', 'later']);
	});

	it('planned sorts by Planned Date', () => {
		const b = task({
			id: 'b',
			position: 'a',
			planned: due('2026-11-03') as SortableTask['planned']
		});
		const a = task({
			id: 'a',
			position: 'b',
			planned: due('2026-11-02') as SortableTask['planned']
		});
		expect(ids(sortTasks([b, a], 'planned', 'UTC'))).toEqual(['a', 'b']);
	});

	it('priority: High, Medium, Low, then none; ties in Custom Order', () => {
		const t = [
			task({ id: 'none', position: 'a' }),
			task({ id: 'low', position: 'b', priority: 'low' }),
			task({ id: 'high2', position: 'c', priority: 'high' }),
			task({ id: 'med', position: 'd', priority: 'medium' }),
			task({ id: 'high1', position: 'a0', priority: 'high' })
		];
		expect(ids(sortTasks(t, 'priority', 'UTC'))).toEqual(['high1', 'high2', 'med', 'low', 'none']);
	});

	it('title: case-insensitive and locale-aware', () => {
		const t = [
			task({ id: '1', title: 'banana' }),
			task({ id: '2', title: 'Apple' }),
			task({ id: '3', title: 'Ärger' }),
			task({ id: '4', title: 'cherry' }),
			task({ id: '5', title: 'zebra' })
		];
		expect(sortTasks(t, 'title', 'UTC').map((x) => x.title)).toEqual([
			'Apple',
			'Ärger',
			'banana',
			'cherry',
			'zebra'
		]);
	});

	it('title: equal titles in different case fall back to Custom Order', () => {
		const t = [
			task({ id: 'b', title: 'Milk', position: 'b' }),
			task({ id: 'a', title: 'milk', position: 'a' })
		];
		expect(ids(sortTasks(t, 'title', 'UTC'))).toEqual(['a', 'b']);
	});

	it('sorts Subtasks among themselves when called on a parent’s Subtasks', () => {
		const subs = [
			task({ id: 's1', position: 'a', priority: 'low' }),
			task({ id: 's2', position: 'b', priority: 'high' })
		];
		expect(ids(sortTasks(subs, 'priority', 'UTC'))).toEqual(['s2', 's1']);
	});
});
