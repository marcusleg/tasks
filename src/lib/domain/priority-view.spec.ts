import { describe, expect, it } from 'vitest';
import { dateOnly, serializeDueDate, serializePlannedDate, unsetDate } from './dates';
import { priorityGroup } from './priority-view';
import { serializeTask, type SerializedTask, type Task } from './tasks';

function task(title: string, extra: Partial<SerializedTask> = {}): SerializedTask {
	const base = {
		id: title,
		listId: 'l',
		parentId: null,
		title,
		description: '',
		position: 'a',
		planned: unsetDate,
		due: unsetDate,
		priority: 'high',
		completedAt: null,
		completedByCascade: false,
		recurrence: null,
		seriesId: null,
		occurrencesSoFar: 1,
		generatedFromTaskId: null,
		changedSinceGenerated: false,
		seriesTemplate: null,
		createdAt: new Date(0),
		updatedAt: new Date(0)
	} as Task;
	return { ...serializeTask(base), ...extra };
}

const planned = (day: string) => serializePlannedDate(dateOnly(day));
const due = (day: string) => serializeDueDate(dateOnly(day));

describe('priorityGroup', () => {
	it('sorts by Planned Date, then Due Date, then Title, undated last', () => {
		const result = priorityGroup(
			[
				task('Undated'),
				task('B', { planned: planned('2027-01-02') }),
				task('Due late', { due: due('2027-03-01') }),
				task('A', { planned: planned('2027-01-02') }),
				task('Early', { planned: planned('2027-01-01') }),
				task('Due soon', { planned: planned('2027-01-02'), due: due('2027-01-05') })
			],
			'high',
			'UTC'
		);
		expect(result.map((t) => t.title)).toEqual([
			'Early',
			'Due soon',
			'A',
			'B',
			'Due late',
			'Undated'
		]);
	});

	it('keeps only open Tasks of the Priority', () => {
		const result = priorityGroup(
			[
				task('Keep'),
				task('Low', { priority: 'low' }),
				task('None', { priority: null }),
				task('Done', { completedAt: '2027-01-01T00:00:00.000Z' })
			],
			'high',
			'UTC'
		);
		expect(result.map((t) => t.title)).toEqual(['Keep']);
	});
});
