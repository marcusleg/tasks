/**
 * Typed browser client for the JSON endpoints under `/api/` (ADR 0003). Every mutation goes
 * through here; pages get their initial data from `load` functions.
 */
import { resolve } from '$app/paths';
import { apiErrorMessage } from './api-errors.js';
import type { SerializedCalendarLink } from '#lib/domain/calendar-links.js';
import type { LanguagePreference } from '#lib/language.js';
import type { SerializedList, SortMode } from '#lib/domain/lists.js';
import type { SerializedDueDate, SerializedPlannedDate } from '#lib/domain/dates.js';
import type { TaskMove } from '#lib/domain/moves.js';
import type { SerializedRecurrence } from '#lib/domain/recurrence.js';
import type { ApplyTo } from '#lib/domain/recurring-tasks.js';
import type { Priority, TaskChanges } from '#lib/domain/tasks.js';

/**
 * A failed request. `message` is what to show: the translation of the server's error code if it
 * sent one (`./api-errors`), otherwise the server's own text.
 */
export class ApiError extends Error {
	constructor(
		readonly status: number,
		message: string,
		/** The server's error code, if the error is one a User can run into. */
		readonly code?: string
	) {
		super(message);
		this.name = 'ApiError';
	}
}

/** The requests below are all changes. Reloading page data holds back while any are on their way. */
export const mutations = { inFlight: 0, started: 0 };

async function request<T>(method: string, path: string, body?: object): Promise<T> {
	mutations.inFlight++;
	mutations.started++;
	try {
		return await send<T>(method, path, body);
	} finally {
		mutations.inFlight--;
	}
}

async function send<T>(method: string, path: string, body?: object): Promise<T> {
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
		const body: { message?: string; code?: string } | null = await response
			.json()
			.catch(() => null);
		throw new ApiError(
			response.status,
			apiErrorMessage(body?.code) ?? body?.message ?? `Request failed (${response.status})`,
			body?.code
		);
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
	/** A Recurrence (the server fills in the driving date's weekday or month day), or `null`. */
	recurrence?: SerializedRecurrence | null;
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
		/** For a Subtask of a recurring Task: This Occurrence only, or all future ones too. */
		applyTo?: ApplyTo;
	}) => request<TaskChanges>('POST', resolve('/api/tasks'), input),
	/** `applyTo`: which Occurrences of a recurring Task (or its Subtasks) the change reaches. */
	updateTask: (id: string, patch: TaskPatch, applyTo?: ApplyTo) =>
		request<TaskChanges>('PATCH', task(id), { ...patch, applyTo }),
	/**
	 * `timeZone` is the browser's, for completion-anchored Recurrences. `undo` is for
	 * {@link api.undo}.
	 */
	completeTask: (id: string, timeZone: string) =>
		request<TaskChanges & { undo: string | null }>(
			'POST',
			resolve('/api/tasks/[id]/complete', { id }),
			{ timeZone }
		),
	reopenTask: (id: string) =>
		request<TaskChanges>('POST', resolve('/api/tasks/[id]/reopen', { id }), {}),
	/**
	 * `undo` is for {@link api.undo}. `applyTo` "occurrence" skips a recurring Task's current
	 * Occurrence; `timeZone` is the browser's, for completion-anchored Recurrences.
	 */
	deleteTask: (id: string, options: { applyTo?: ApplyTo; timeZone?: string } = {}) => {
		const query = new URLSearchParams();
		if (options.applyTo) query.set('applyTo', options.applyTo);
		if (options.timeZone) query.set('timeZone', options.timeZone);
		const search = query.size > 0 ? `?${query}` : '';
		return request<TaskChanges & { undo: string | null }>('DELETE', `${task(id)}${search}`);
	},
	/** Puts back the state before the action whose answer carried this `undo` (ADR 0004). */
	undo: (undoId: string) => request<TaskChanges>('POST', resolve('/api/undo'), { undoId }),
	moveTask: (id: string, move: TaskMove) =>
		request<TaskChanges & { undo: string | null }>(
			'POST',
			resolve('/api/tasks/[id]/move', { id }),
			move
		),

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
		request<void>('DELETE', resolve('/api/calendar-links/[id]', { id })),

	/** Chooses the User's Language. It shows from the next full page load. */
	setLanguagePreference: (languagePreference: LanguagePreference) =>
		request<{ languagePreference: LanguagePreference }>(
			'PUT',
			resolve('/api/language-preference'),
			{ languagePreference }
		)
};
