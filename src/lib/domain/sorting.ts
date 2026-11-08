/**
 * Sort Modes (CONTEXT.md → Sort Mode): how a List's Tasks are displayed. A Sort Mode is only a
 * view; Custom Order is never changed, and it breaks every tie.
 */
import { parseDueDate, parsePlannedDate } from './dates';
import { compareTaskDates } from './date-display';
import type { SortMode } from './lists';
import { byCustomOrder, PRIORITIES, type SerializedTask } from './tasks';

export type SortableTask = Pick<
	SerializedTask,
	'id' | 'position' | 'title' | 'planned' | 'due' | 'priority'
>;

const collators = new Map<string, Intl.Collator>();

/** Compares Titles the way `locale` does (umlauts, accents), ignoring case; numbers by value. */
function titleCollator(locale: string | undefined): Intl.Collator {
	const key = locale ?? '';
	let collator = collators.get(key);
	if (!collator) {
		collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
		collators.set(key, collator);
	}
	return collator;
}

function priorityRank(task: SortableTask): number {
	return task.priority === null ? PRIORITIES.length : PRIORITIES.indexOf(task.priority);
}

/**
 * Tasks that are siblings (the open top-level Tasks of a List, or one parent's Subtasks), in the
 * order `mode` asks for. Tasks without the sort key go last; ties fall back to Custom Order.
 * `timeZone` is the viewer's: dated modes order by the viewer's day. `locale` is the User's date
 * locale: Titles sort the way their Language does (undefined: the runtime's). Returns a new array.
 */
export function sortTasks<T extends SortableTask>(
	tasks: readonly T[],
	mode: SortMode,
	timeZone: string,
	locale?: string
): T[] {
	const collator = titleCollator(locale);
	const compare = (a: T, b: T): number => {
		switch (mode) {
			case 'planned':
				return compareTaskDates(parsePlannedDate(a.planned), parsePlannedDate(b.planned), timeZone);
			case 'due':
				return compareTaskDates(parseDueDate(a.due), parseDueDate(b.due), timeZone);
			case 'priority':
				return priorityRank(a) - priorityRank(b);
			case 'title':
				return collator.compare(a.title, b.title);
			default:
				return 0;
		}
	};
	return [...tasks].sort((a, b) => compare(a, b) || byCustomOrder(a, b));
}
