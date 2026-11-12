/**
 * What the main page needs for the List columns: the Tasks of every visible List, plus those of the
 * focused List when the page is a link to one (`/lists/[id]`), which shows even if it is a Hidden
 * List. `/` has no focused List.
 */
import { serializeList, type SerializedList } from '#lib/domain/lists.js';
import { serializeTask, type SerializedTask } from '#lib/domain/tasks.js';
import { getLists } from './lists.js';
import type { UserScope } from './scope.js';
import { getTasksOfLists } from './tasks.js';

export interface ColumnsData {
	/** The focused List; `null` on `/`. */
	list: SerializedList | null;
	tasks: SerializedTask[];
}

export function loadColumns(scope: UserScope, focusId?: string): ColumnsData {
	const all = getLists(scope);
	const focus = focusId === undefined ? undefined : all.find((list) => list.id === focusId);
	const ids = all.filter((list) => list.visible || list.id === focus?.id).map((list) => list.id);
	return {
		list: focus ? serializeList(focus) : null,
		tasks: getTasksOfLists(scope, ids).map(serializeTask)
	};
}
