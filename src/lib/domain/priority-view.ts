/**
 * The Priority View (CONTEXT.md → Priority View): every open Task with a Priority, grouped into
 * High, Medium and Low.
 */
import { compareTaskDates } from './date-display';
import { parseDueDate, parsePlannedDate } from './dates';
import { comparePositions } from './lists';
import type { Priority, SerializedTask } from './tasks';

/** Whether a Task belongs in the Priority View: open, with a Priority. */
export function inPriorityView(task: SerializedTask): boolean {
	return task.priority !== null && task.completedAt === null;
}

/**
 * The Tasks of one Priority group: by Planned Date, then Due Date (in the viewer's zone, undated
 * last), then Title.
 */
export function priorityGroup(
	tasks: Iterable<SerializedTask>,
	priority: Priority,
	timeZone: string
): SerializedTask[] {
	return [...tasks]
		.filter((task) => inPriorityView(task) && task.priority === priority)
		.map((task) => ({ task, planned: parsePlannedDate(task.planned), due: parseDueDate(task.due) }))
		.sort(
			(a, b) =>
				compareTaskDates(a.planned, b.planned, timeZone) ||
				compareTaskDates(a.due, b.due, timeZone) ||
				a.task.title.localeCompare(b.task.title, undefined, { sensitivity: 'base' }) ||
				comparePositions(a.task.id, b.task.id)
		)
		.map(({ task }) => task);
}
