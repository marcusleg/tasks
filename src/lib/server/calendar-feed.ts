/**
 * Turns a Calendar Link's Tasks into the input of `buildCalendar` (`#lib/domain/ics.ts`).
 * `toCalendarTasks` is pure; `buildCalendarLinkFeed` reads the User's data.
 */
import { Temporal } from 'temporal-polyfill';
import { buildCalendar, type CalendarTask } from '#lib/domain/ics.js';
import type { Task } from '#lib/domain/tasks.js';
import type { Db } from './db/client.js';
import { getLists } from './lists.js';
import type { CalendarLink } from './calendar-links.js';
import type { UserScope } from './scope.js';
import { getTasksOfLists } from './tasks.js';

const isDated = (task: Task) => task.planned.kind !== 'unset' || task.due.kind !== 'unset';

/**
 * Maps Tasks (open and Completed, Subtasks included, of any Lists) to `CalendarTask`s:
 * - Completed Tasks are left out, as are recurring Subtasks of a Completed parent.
 * - Undated Subtasks go into their parent's `undatedSubtasks` checklist (Completed ones as ☑);
 *   open dated Subtasks become CalendarTasks of their own with `parentTitle`.
 * - Tasks without any date are skipped (their dated Subtasks are still published).
 * - A Task with a Recurrence passes `{ seriesId, rule, occurrencesSoFar }`; `detached` stays unset
 *   until "This Occurrence" edits exist (#17).
 */
export function toCalendarTasks(input: {
	tasks: Task[];
	listNames: Map<string, string>;
	origin: string;
}): CalendarTask[] {
	const { tasks, listNames, origin } = input;
	const byId = new Map(tasks.map((task) => [task.id, task]));
	const subtasksOf = new Map<string, Task[]>();
	for (const task of tasks) {
		if (task.parentId === null) continue;
		subtasksOf.set(task.parentId, [...(subtasksOf.get(task.parentId) ?? []), task]);
	}

	const result: CalendarTask[] = [];
	for (const task of tasks) {
		if (task.completedAt !== null || !isDated(task)) continue;
		const parent = task.parentId === null ? undefined : byId.get(task.parentId);
		if (task.parentId !== null) {
			if (!parent) continue;
			if (parent.completedAt !== null && task.recurrence) continue;
		}

		const subtasks = subtasksOf.get(task.id) ?? [];
		result.push({
			id: task.id,
			title: task.title,
			description: task.description,
			listName: listNames.get(task.listId) ?? '',
			url: `${origin}/lists/${task.listId}?task=${task.id}`,
			planned: task.planned,
			due: task.due,
			undatedSubtasks: subtasks
				.filter((subtask) => !isDated(subtask))
				.map((subtask) => ({ title: subtask.title, completed: subtask.completedAt !== null })),
			...(parent ? { parentTitle: parent.title } : {}),
			...(task.recurrence
				? {
						recurrence: {
							seriesId: task.seriesId ?? task.id,
							rule: task.recurrence,
							occurrencesSoFar: task.occurrencesSoFar
						}
					}
				: {})
		});
	}
	return result;
}

/** The iCalendar text for a Calendar Link: only the link owner's Tasks, in the Lists it covers. */
export function buildCalendarLinkFeed(
	db: Db,
	link: CalendarLink,
	origin: string,
	now = Temporal.Now.instant()
): string {
	const scope: UserScope = { db, userId: link.userId };
	const allLists = getLists(scope);
	const covered = link.allLists ? allLists : allLists.filter((l) => link.listIds.includes(l.id));
	const tasks = getTasksOfLists(
		scope,
		covered.map((list) => list.id)
	);
	return buildCalendar({
		calendarName: link.name,
		tasks: toCalendarTasks({
			tasks,
			listNames: new Map(covered.map((list) => [list.id, list.name])),
			origin
		}),
		now
	});
}

/** A file name for the feed: the Calendar Link's name as a lowercase ASCII slug. */
export function feedFilename(name: string): string {
	const slug = name
		.normalize('NFKD')
		.replace(/\p{M}/gu, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 60);
	return `${slug || 'calendar'}.ics`;
}
