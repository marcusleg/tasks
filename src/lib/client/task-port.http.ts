/** The production {@link TaskPort}: the JSON endpoints, and SvelteKit's `invalidate` to reload. */
import { invalidate } from '$app/navigation';
import { TASKS_DEPENDENCY } from '#lib/dependencies.js';
import { api } from './api.js';
import type { TaskPort } from './task-port.js';

export const httpTaskPort: TaskPort = {
	createTask: (input) => api.createTask(input),
	updateTask: (id, patch, applyTo) => api.updateTask(id, patch, applyTo),
	completeTask: (id, timeZone) => api.completeTask(id, timeZone),
	reopenTask: (id) => api.reopenTask(id),
	deleteTask: (id, options) => api.deleteTask(id, options),
	undo: (undoId) => api.undo(undoId),
	restoreTasks: (tasks, replaces) => api.restoreTasks(tasks, replaces),
	moveTask: (id, move) => api.moveTask(id, move),
	deleteCompletedTasks: (listId) => api.deleteCompletedTasks(listId),
	reload: () => invalidate(TASKS_DEPENDENCY)
};
