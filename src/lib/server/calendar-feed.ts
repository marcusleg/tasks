/**
 * Turns a Calendar Link's Tasks into the input of `buildCalendar` (`#lib/domain/ics.ts`).
 * `toCalendarTasks` is pure; `buildCalendarLinkFeed` reads the User's data.
 */
import { Temporal } from 'temporal-polyfill';
import { buildCalendar, type CalendarTask } from '#lib/domain/ics.js';
import { isDetached } from '#lib/domain/recurring-tasks.js';
import type { Task } from '#lib/domain/tasks.js';
import type { LanguagePreference } from '#lib/language.js';
import { m } from '#lib/paraglide/messages.js';
import { resolveLanguage } from './language.js';
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
 * - A Task with a Recurrence passes `{ seriesId, rule, occurrencesSoFar }`. An Occurrence changed
 *   with "This Occurrence" so that it differs from its series template in dates, Title or
 *   Description (`isDetached`) also passes `detached` and the template, which the series is
 *   published from.
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
			url: `${origin}/?task=${task.id}#${task.listId}`,
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
							occurrencesSoFar: task.occurrencesSoFar,
							...(task.seriesTemplate && isDetached(task)
								? {
										detached: true,
										template: {
											title: task.seriesTemplate.title,
											description: task.seriesTemplate.description,
											planned: task.seriesTemplate.planned,
											due: task.seriesTemplate.due
										}
									}
								: {})
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
	link: CalendarLink & { ownerLanguagePreference?: LanguagePreference },
	origin: string,
	now = Temporal.Now.instant()
): string {
	const scope: UserScope = { db, userId: link.userId };
	// A calendar app's Accept-Language says nothing about the owner: only their stored choice counts.
	const { language } = resolveLanguage(null, link.ownerLanguagePreference);
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
		labels: {
			due: (title) => m.feed_due({ title }, { locale: language }),
			list: (name) => m.feed_list({ name }, { locale: language }),
			subtaskOf: (title) => m.feed_subtask_of({ title }, { locale: language })
		},
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
