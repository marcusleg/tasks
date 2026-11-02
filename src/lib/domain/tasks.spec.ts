import { describe, expect, it } from 'vitest';
import { dateOnly, timedPlannedDate, unsetDate } from './dates';
import { parseSeriesTemplate, serializeSeriesTemplate, type SeriesTemplate } from './tasks';

const template: SeriesTemplate = {
	title: 'Water plants',
	description: 'All of them',
	priority: 'high',
	planned: timedPlannedDate('2026-11-02T09:00', 'Europe/Berlin', 45),
	due: dateOnly('2026-11-04'),
	subtasks: [
		{
			sourceId: 'fern-id',
			title: 'Fern',
			description: '',
			priority: null,
			planned: dateOnly('2026-11-03'),
			due: unsetDate,
			position: 'a0'
		}
	]
};

describe('series template', () => {
	it('serializes to JSON and parses back to the same values', () => {
		const json = JSON.parse(JSON.stringify(serializeSeriesTemplate(template)));

		expect(json).toEqual({
			title: 'Water plants',
			description: 'All of them',
			priority: 'high',
			planned: {
				kind: 'timed',
				dateTime: '2026-11-02T09:00',
				timeZone: 'Europe/Berlin',
				durationMinutes: 45
			},
			due: { kind: 'date', date: '2026-11-04' },
			subtasks: [
				{
					sourceId: 'fern-id',
					title: 'Fern',
					description: '',
					priority: null,
					planned: { kind: 'date', date: '2026-11-03' },
					due: null,
					position: 'a0'
				}
			]
		});
		expect(parseSeriesTemplate(json)).toEqual(template);
	});

	it('keeps “no Subtask template” apart from an empty one', () => {
		const { subtasks: _, ...withoutSubtasks } = template;
		void _;

		expect(parseSeriesTemplate(serializeSeriesTemplate(withoutSubtasks))).toEqual(withoutSubtasks);
		expect(
			parseSeriesTemplate(serializeSeriesTemplate({ ...template, subtasks: [] })).subtasks
		).toEqual([]);
	});

	it.each([
		['not an object', 'x'],
		['an empty Title', { ...serializeSeriesTemplate(template), title: ' ' }],
		['an unknown Priority', { ...serializeSeriesTemplate(template), priority: 'urgent' }],
		['a malformed date', { ...serializeSeriesTemplate(template), due: { kind: 'date' } }],
		['no date at all', { ...serializeSeriesTemplate(template), planned: null, due: null }],
		['Subtasks that aren’t a list', { ...serializeSeriesTemplate(template), subtasks: {} }],
		[
			'a Subtask without a source',
			{
				...serializeSeriesTemplate(template),
				subtasks: [{ ...serializeSeriesTemplate(template).subtasks![0], sourceId: 1 }]
			}
		]
	])('rejects %s', (_, value) => {
		expect(() => parseSeriesTemplate(value)).toThrow();
	});
});
