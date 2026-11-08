/** The words the Occurrence scope question and the detail panel's note use, in the current Language. */
import type { ApplyTo } from '#lib/domain/recurring-tasks.js';
import { m } from '#lib/paraglide/messages.js';
import type { ScopeGroup } from './occurrence-scope.svelte.js';

/** "Further date changes in this panel follow your choice." */
export function scopeFollows(group: ScopeGroup): string {
	switch (group) {
		case 'details':
			return m.scope_follows_details();
		case 'dates':
			return m.scope_follows_dates();
		case 'subtasks':
			return m.scope_follows_subtasks();
	}
}

/** What the panel remembers: "Date changes apply to this occurrence only." */
export function scopeNote(group: ScopeGroup, applyTo: ApplyTo): string {
	const only = applyTo === 'occurrence';
	switch (group) {
		case 'details':
			return only ? m.scope_note_details_occurrence() : m.scope_note_details_future();
		case 'dates':
			return only ? m.scope_note_dates_occurrence() : m.scope_note_dates_future();
		case 'subtasks':
			return only ? m.scope_note_subtasks_occurrence() : m.scope_note_subtasks_future();
	}
}
