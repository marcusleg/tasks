import { describe, expect, it } from 'vitest';
import { dateOnly, unsetDate } from './dates';
import { parseRecurrence } from './recurrence';
import { describeRecurrence, isDetached } from './recurring-tasks';

const rule = (fields: Record<string, unknown>) =>
	parseRecurrence({ interval: 1, end: { kind: 'never' }, anchor: 'schedule', ...fields });

describe('describeRecurrence', () => {
	it.each([
		[{ frequency: 'daily' }, 'Repeats daily'],
		[{ frequency: 'weekly', weekdays: [1, 4] }, 'Repeats weekly'],
		[{ frequency: 'monthly', interval: 3 }, 'Repeats every 3 months'],
		[{ frequency: 'yearly' }, 'Repeats yearly'],
		[
			{ frequency: 'daily', interval: 10, anchor: 'completion' },
			'Repeats every 10 days after completion'
		],
		[{ frequency: 'weekly', anchor: 'completion' }, 'Repeats weekly after completion']
	])('%j reads “%s”', (fields, label) => {
		expect(describeRecurrence(rule(fields))).toBe(label);
	});
});

describe('describeRecurrence in German', () => {
	it.each([
		[{ frequency: 'daily' }, 'Wiederholt sich täglich'],
		[{ frequency: 'weekly', weekdays: [1, 4] }, 'Wiederholt sich wöchentlich'],
		[{ frequency: 'monthly', interval: 3 }, 'Wiederholt sich alle 3 Monate'],
		[{ frequency: 'yearly' }, 'Wiederholt sich jährlich'],
		[
			{ frequency: 'daily', interval: 10, anchor: 'completion' },
			'Wiederholt sich alle 10 Tage, gezählt ab Erledigung'
		]
	])('%j reads “%s”', (fields, label) => {
		expect(describeRecurrence(rule(fields), { locale: 'de' })).toBe(label);
	});
});

describe('isDetached', () => {
	const current = {
		title: 'Water plants',
		description: '',
		priority: null,
		planned: dateOnly('2026-11-02'),
		due: unsetDate
	};

	it('is false while the Occurrence is its own template', () => {
		expect(isDetached({ ...current, seriesTemplate: null })).toBe(false);
	});

	it('is true once its dates differ from the template’s', () => {
		const moved = { ...current, planned: dateOnly('2026-11-03') };
		expect(isDetached({ ...moved, seriesTemplate: current })).toBe(true);
		const due = { ...current, due: dateOnly('2026-11-05') };
		expect(isDetached({ ...due, seriesTemplate: current })).toBe(true);
	});

	it('is true once its Title or Description differ, which the calendar shows', () => {
		expect(isDetached({ ...current, title: 'Ferns', seriesTemplate: current })).toBe(true);
		expect(isDetached({ ...current, description: 'Hi', seriesTemplate: current })).toBe(true);
	});

	it('is false for a change the calendar doesn’t show (Priority, Subtasks)', () => {
		const template = { ...current, subtasks: [] };
		expect(isDetached({ ...current, priority: 'high', seriesTemplate: template })).toBe(false);
	});
});
