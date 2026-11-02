/**
 * What the main page needs for the multi-List columns layout: the Tasks of every visible List plus
 * the focused List (the one in the URL, or the last-viewed one), which is the only one shown on
 * narrow screens and may be hidden on wide ones.
 */
import { serializeList, type SerializedList } from '#lib/domain/lists.js';
import { serializeTask, type SerializedTask } from '#lib/domain/tasks.js';
import { getLists } from './lists.js';
import type { UserScope } from './scope.js';
import { getTasksOfLists } from './tasks.js';

export interface ColumnsData {
	/** The focused List; `null` when the User has no Lists. */
	list: SerializedList | null;
	tasks: SerializedTask[];
}

export function loadColumns(scope: UserScope, focusId: string | undefined): ColumnsData {
	const all = getLists(scope);
	const focus = all.find((list) => list.id === focusId) ?? all[0];
	const ids = all.filter((list) => list.visible || list.id === focus?.id).map((list) => list.id);
	return {
		list: focus ? serializeList(focus) : null,
		tasks: getTasksOfLists(scope, ids).map(serializeTask)
	};
}
