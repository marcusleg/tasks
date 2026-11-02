import { TASKS_DEPENDENCY } from '#lib/dependencies.js';
import { serializeTask } from '#lib/domain/tasks.js';
import { userScope } from '#lib/server/scope.js';
import { getPriorityViewTasks } from '#lib/server/tasks.js';
import type { PageServerLoad } from './$types';

/** The Priority View: open Tasks with a Priority from all Lists (plus parents and Subtasks for context). */
export const load: PageServerLoad = async ({ locals, depends, parent }) => {
	depends(TASKS_DEPENDENCY);
	// The layout sets a new User up first.
	await parent();

	const { tasks, related } = getPriorityViewTasks(userScope(locals));
	return { tasks: [...tasks, ...related].map(serializeTask) };
};
