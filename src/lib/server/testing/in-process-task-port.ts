/**
 * A {@link TaskPort} for specs that calls the real `/api/tasks` endpoint handlers in-process,
 * for one signed-in User (see `in-process-endpoints.ts`, including the `getDb` mock it needs).
 */
import type { TaskPort } from '#lib/client/task-port.js';
import type { User } from '#lib/server/db/schema.js';
import {
	inProcessEndpoints,
	type Handler,
	type InProcessEndpoints,
	type SentRequest
} from './in-process-endpoints.js';
import { POST as createTask } from '../../../routes/api/tasks/+server.js';
import {
	DELETE as deleteTask,
	PATCH as updateTask
} from '../../../routes/api/tasks/[id]/+server.js';
import { POST as completeTask } from '../../../routes/api/tasks/[id]/complete/+server.js';
import { POST as moveTask } from '../../../routes/api/tasks/[id]/move/+server.js';
import { POST as reopenTask } from '../../../routes/api/tasks/[id]/reopen/+server.js';
import { POST as restoreTasks } from '../../../routes/api/tasks/restore/+server.js';
import { POST as undo } from '../../../routes/api/undo/+server.js';
import { DELETE as deleteCompletedTasks } from '../../../routes/api/lists/[id]/completed-tasks/+server.js';

export type { SentRequest };

export type InProcessTaskPort = TaskPort &
	Pick<InProcessEndpoints, 'requests' | 'reloads' | 'idle'>;

export function inProcessTaskPort(
	user: User,
	options: Parameters<typeof inProcessEndpoints>[1] = {}
): InProcessTaskPort {
	const endpoints = inProcessEndpoints(user, options);
	const { call } = endpoints;

	return {
		get requests() {
			return endpoints.requests;
		},
		get reloads() {
			return endpoints.reloads;
		},
		idle: () => endpoints.idle(),
		reload: () => endpoints.reload(),
		createTask: (input) => call(createTask as Handler, 'POST', '/api/tasks', {}, input),
		updateTask: (id, patch, applyTo) =>
			call(updateTask as Handler, 'PATCH', `/api/tasks/${id}`, { id }, { ...patch, applyTo }),
		completeTask: (id, timeZone) =>
			call(completeTask as Handler, 'POST', `/api/tasks/${id}/complete`, { id }, { timeZone }),
		reopenTask: (id) => call(reopenTask as Handler, 'POST', `/api/tasks/${id}/reopen`, { id }, {}),
		deleteTask: (id, { applyTo, timeZone }) => {
			const query = new URLSearchParams();
			if (applyTo) query.set('applyTo', applyTo);
			if (timeZone) query.set('timeZone', timeZone);
			const search = query.size > 0 ? `?${query}` : '';
			return call(deleteTask as Handler, 'DELETE', `/api/tasks/${id}${search}`, { id });
		},
		undo: (undoId) => call(undo as Handler, 'POST', '/api/undo', {}, { undoId }),
		restoreTasks: (tasks, replaces) =>
			call(
				restoreTasks as Handler,
				'POST',
				'/api/tasks/restore',
				{},
				{
					tasks,
					...(replaces && { replaces })
				}
			),
		moveTask: (id, move) =>
			call(moveTask as Handler, 'POST', `/api/tasks/${id}/move`, { id }, move),
		deleteCompletedTasks: (listId) =>
			call(deleteCompletedTasks as Handler, 'DELETE', `/api/lists/${listId}/completed-tasks`, {
				id: listId
			})
	};
}
