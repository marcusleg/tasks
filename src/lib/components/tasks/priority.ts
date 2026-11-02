import type { Priority } from '#lib/domain/tasks.js';

export const PRIORITY_LABELS: Record<Priority, string> = {
	high: 'High',
	medium: 'Medium',
	low: 'Low'
};

/** Pickers list the levels from none up, like the marker's filled bars. */
export const PRIORITY_CHOICES: Array<{ value: Priority | null; label: string }> = [
	{ value: null, label: 'None' },
	{ value: 'low', label: 'Low' },
	{ value: 'medium', label: 'Medium' },
	{ value: 'high', label: 'High' }
];

export function priorityName(priority: Priority | null): string {
	return priority ? `${PRIORITY_LABELS[priority]} priority` : 'No priority';
}
