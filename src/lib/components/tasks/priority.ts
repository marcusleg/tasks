import { m } from '#lib/paraglide/messages.js';
import type { Priority } from '#lib/domain/tasks.js';

/** The level's name in the User's Language. Functions, not constants: the Language is per request. */
export function priorityLabel(priority: Priority): string {
	switch (priority) {
		case 'high':
			return m.priority_high();
		case 'medium':
			return m.priority_medium();
		case 'low':
			return m.priority_low();
	}
}

/** Names the list of Tasks at a level, for screen readers. */
export function priorityTasksLabel(priority: Priority): string {
	switch (priority) {
		case 'high':
			return m.priority_tasks_high();
		case 'medium':
			return m.priority_tasks_medium();
		case 'low':
			return m.priority_tasks_low();
	}
}

/** What an empty column says. */
export function priorityEmptyText(priority: Priority): string {
	switch (priority) {
		case 'high':
			return m.priority_empty_high();
		case 'medium':
			return m.priority_empty_medium();
		case 'low':
			return m.priority_empty_low();
	}
}

/** Pickers list the levels from none up, like the marker's filled bars. */
export function priorityChoices(): Array<{ value: Priority | null; label: string }> {
	return [
		{ value: null, label: m.priority_none() },
		{ value: 'low', label: m.priority_low() },
		{ value: 'medium', label: m.priority_medium() },
		{ value: 'high', label: m.priority_high() }
	];
}
