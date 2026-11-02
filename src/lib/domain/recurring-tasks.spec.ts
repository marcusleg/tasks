import { describe, expect, it } from 'vitest';
import { parseRecurrence } from './recurrence';
import { describeRecurrence } from './recurring-tasks';

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
