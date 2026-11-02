/**
 * Typed browser client for the JSON endpoints under `/api/` (ADR 0003). Every mutation goes
 * through here; pages get their initial data from `load` functions.
 */
import { resolve } from '$app/paths';
import type { SerializedCalendarLink } from '#lib/domain/calendar-links.js';
import type { SerializedList, SortMode } from '#lib/domain/lists.js';
import type { SerializedDueDate, SerializedPlannedDate } from '#lib/domain/dates.js';
import type { Priority, TaskChanges } from '#lib/domain/tasks.js';

export class ApiError extends Error {
	constructor(
		readonly status: number,
		message: string
	) {
		super(message);
		this.name = 'ApiError';
	}
}

async function request<T>(method: string, path: string, body?: object): Promise<T> {
	const response = await fetch(path, {
		method,
		headers: {
			accept: 'application/json',
			...(body === undefined ? {} : { 'content-type': 'application/json' })
		},
		body: body === undefined ? undefined : JSON.stringify(body)
	});

	if (response.status === 401) {
		// The session ended (expired, or signed out elsewhere): sign in again and come back.
		const returnTo = location.pathname + location.search;
		location.assign(`${resolve('/auth/login')}?returnTo=${encodeURIComponent(returnTo)}`);
		throw new ApiError(401, 'Not signed in');
	}
	if (!response.ok) {
		const message = await response
			.json()
			.then((json: { message?: string }) => json.message)
			.catch(() => undefined);
		throw new ApiError(response.status, message ?? `Request failed (${response.status})`);
	}
	return (response.status === 204 ? undefined : await response.json()) as T;
}

/** The Task fields a PATCH can change. */
export interface TaskPatch {
	title?: string;
	description?: string;
	planned?: SerializedPlannedDate;
	due?: SerializedDueDate;
	priority?: Priority | null;
}

const list = (id: string) => resolve('/api/lists/[id]', { id });
const task = (id: string) => resolve('/api/tasks/[id]', { id });

export const api = {
	createList: (input: { id: string; name: string }) =>
		request<{ list: SerializedList }>('POST', resolve('/api/lists'), input),
	updateList: (
		id: string,
		patch: {
			name?: string;
			sortMode?: SortMode;
			visible?: boolean;
			before?: string;
			after?: string;
		}
	) => request<{ list: SerializedList }>('PATCH', list(id), patch),
	deleteList: (id: string) => request<void>('DELETE', list(id)),
	deleteCompletedTasks: (listId: string) =>
		request<TaskChanges>('DELETE', resolve('/api/lists/[id]/completed-tasks', { id: listId })),

	createTask: (input: {
		id: string;
		listId: string;
		title: string;
		description?: string;
		parentId?: string | null;
		planned?: SerializedPlannedDate;
		due?: SerializedDueDate;
		priority?: Priority | null;
	}) => request<TaskChanges>('POST', resolve('/api/tasks'), input),
	updateTask: (id: string, patch: TaskPatch) => request<TaskChanges>('PATCH', task(id), patch),
	completeTask: (id: string) =>
		request<TaskChanges>('POST', resolve('/api/tasks/[id]/complete', { id }), {}),
	reopenTask: (id: string) =>
		request<TaskChanges>('POST', resolve('/api/tasks/[id]/reopen', { id }), {}),
	deleteTask: (id: string) => request<TaskChanges>('DELETE', task(id)),

	createCalendarLink: (input: { name: string; allLists?: boolean; listIds?: string[] }) =>
		request<{ calendarLink: SerializedCalendarLink }>(
			'POST',
			resolve('/api/calendar-links'),
			input
		),
	updateCalendarLink: (
		id: string,
		patch: { name?: string; allLists?: boolean; listIds?: string[] }
	) =>
		request<{ calendarLink: SerializedCalendarLink }>(
			'PATCH',
			resolve('/api/calendar-links/[id]', { id }),
			patch
		),
	deleteCalendarLink: (id: string) =>
		request<void>('DELETE', resolve('/api/calendar-links/[id]', { id }))
};
