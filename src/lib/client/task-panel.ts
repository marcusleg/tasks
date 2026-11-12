/**
 * The open Task detail panel lives in the URL as `?task=<id>`, so a Task can be linked to (e.g.
 * from a Calendar Link event: `/?task=<taskId>#<listId>`) and Back closes the panel.
 */
import { goto } from '$app/navigation';
import { page } from '$app/state';

export const TASK_PARAM = 'task';

/** The id of the Task whose detail panel is open, if any. */
export function openTaskId(): string | null {
	return page.url.searchParams.get(TASK_PARAM);
}

function withTask(id: string | null): URL {
	const url = new URL(page.url.href);
	if (id) url.searchParams.set(TASK_PARAM, id);
	else url.searchParams.delete(TASK_PARAM);
	return url;
}

/** Opens a Task's detail panel (a new history entry). */
export function openTask(id: string): Promise<void> {
	// The current page with another search param; resolve() is for building paths.
	// eslint-disable-next-line svelte/no-navigation-without-resolve
	return goto(withTask(id), { reset: false });
}

/** Closes the detail panel, replacing the history entry that opened it. */
export function closeTask(): Promise<void> {
	// eslint-disable-next-line svelte/no-navigation-without-resolve
	return goto(withTask(null), { replace: true, reset: false });
}
