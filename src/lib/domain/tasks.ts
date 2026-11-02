/**
 * The Task model shared by server and browser (see CONTEXT.md → Task, Subtask, Completed,
 * Recurrence, Occurrence).
 *
 * The server works with {@link Task} (dates as `PlannedDate`/`DueDate`, Recurrence as a
 * `RecurrenceRule`); JSON responses and page data carry {@link SerializedTask}, which the browser
 * keeps as is and parses only where it needs the date or rule values.
 */
import {
	parseDueDate,
	parsePlannedDate,
	serializeDueDate,
	serializePlannedDate,
	type DueDate,
	type PlannedDate,
	type SerializedDueDate,
	type SerializedPlannedDate
} from './dates';
import { comparePositions } from './lists';
import {
	parseRecurrence,
	serializeRecurrence,
	type RecurrenceRule,
	type SerializedRecurrence
} from './recurrence';
import { freeText, requiredText } from './validation';

export const PRIORITIES = ['high', 'medium', 'low'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const MAX_TITLE_LENGTH = 1000;
export const MAX_DESCRIPTION_LENGTH = 20_000;

/**
 * What future Occurrences inherit when the current Occurrence was edited with "This Occurrence"
 * only (#17). Opaque JSON here; #17 defines its shape (e.g. the Title, Description, Priority and
 * the rule-based Planned/Due Dates the next Occurrence steps from). `null` means the current
 * Occurrence is itself the template.
 */
export type SeriesTemplate = Record<string, unknown>;

export interface Task {
	id: string;
	listId: string;
	/** The parent Task of a Subtask, `null` for a top-level Task. Nesting is one level deep. */
	parentId: string | null;
	title: string;
	/** Plain text; never interpreted as HTML or Markdown. Empty when there is none. */
	description: string;
	/** Fractional-index key within the List and parent: the Task's place in Custom Order. */
	position: string;
	planned: PlannedDate;
	due: DueDate;
	priority: Priority | null;
	/** When the Task was Completed; `null` while it's open. */
	completedAt: Date | null;
	/** True for a Subtask that was Completed by its parent's completion (#7), so Reopen restores it. */
	completedByCascade: boolean;
	recurrence: RecurrenceRule | null;
	/** Shared by all Occurrences of one Recurrence; `null` for non-recurring Tasks. */
	seriesId: string | null;
	/** How many Occurrences the series has had, including this one (the first is 1). */
	occurrencesSoFar: number;
	/** The Occurrence whose completion created this one (#16). */
	generatedFromTaskId: string | null;
	/** Whether the User changed this Occurrence since it was generated (decides Reopen, #16). */
	changedSinceGenerated: boolean;
	seriesTemplate: SeriesTemplate | null;
	createdAt: Date;
	updatedAt: Date;
}

/** JSON shape of a {@link Task}: dates and Recurrence in their serialized forms, timestamps as ISO strings. */
export type SerializedTask = Omit<
	Task,
	'planned' | 'due' | 'recurrence' | 'completedAt' | 'createdAt' | 'updatedAt'
> & {
	planned: SerializedPlannedDate;
	due: SerializedDueDate;
	recurrence: SerializedRecurrence | null;
	completedAt: string | null;
	createdAt: string;
	updatedAt: string;
};

/**
 * What a Task mutation changed: Tasks created or updated (e.g. a completion that also closes
 * Subtasks, or creates the next Occurrence), and ids of Tasks that are gone.
 */
export interface TaskChanges {
	upserted: SerializedTask[];
	deleted: string[];
}

export function serializeTask(task: Task): SerializedTask {
	return {
		...task,
		planned: serializePlannedDate(task.planned),
		due: serializeDueDate(task.due),
		recurrence: task.recurrence && serializeRecurrence(task.recurrence),
		completedAt: task.completedAt?.toISOString() ?? null,
		createdAt: task.createdAt.toISOString(),
		updatedAt: task.updatedAt.toISOString()
	};
}

/** The inverse of {@link serializeTask}. Throws on malformed dates or Recurrence. */
export function parseTask(json: SerializedTask): Task {
	return {
		...json,
		planned: parsePlannedDate(json.planned),
		due: parseDueDate(json.due),
		recurrence: json.recurrence && parseRecurrence(json.recurrence),
		completedAt: json.completedAt === null ? null : new Date(json.completedAt),
		createdAt: new Date(json.createdAt),
		updatedAt: new Date(json.updatedAt)
	};
}

export function isPriority(value: unknown): value is Priority {
	return PRIORITIES.includes(value as Priority);
}

/** A valid Title: trimmed, non-empty. Throws `InvalidInputError`. */
export function parseTitle(value: unknown): string {
	return requiredText(value, 'Title', MAX_TITLE_LENGTH);
}

/** A valid Description (may be empty). Throws `InvalidInputError`. */
export function parseDescription(value: unknown): string {
	return freeText(value, 'Description', MAX_DESCRIPTION_LENGTH);
}

type Sortable = Pick<SerializedTask, 'id' | 'position'>;

/** Custom Order: by position, then id so equal keys still sort deterministically. */
export function byCustomOrder(a: Sortable, b: Sortable): number {
	return comparePositions(a.position, b.position) || comparePositions(a.id, b.id);
}

type Listed = Pick<SerializedTask, 'id' | 'position' | 'listId' | 'parentId' | 'completedAt'>;

/** The open top-level Tasks of a List, in Custom Order. */
export function openTasksOf<T extends Listed>(tasks: Iterable<T>, listId: string): T[] {
	return [...tasks]
		.filter((task) => task.listId === listId && task.parentId === null && !task.completedAt)
		.sort(byCustomOrder);
}

/** The Completed top-level Tasks of a List, most recently Completed first. */
export function completedTasksOf<T extends Listed>(tasks: Iterable<T>, listId: string): T[] {
	return [...tasks]
		.filter((task) => task.listId === listId && task.parentId === null && task.completedAt)
		.sort(
			(a, b) =>
				comparePositions(b.completedAt as string, a.completedAt as string) || byCustomOrder(a, b)
		);
}
