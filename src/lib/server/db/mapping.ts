/**
 * Conversions between database rows and domain values. Rows are trusted only as far as the
 * CHECK constraints go; dates and Recurrence are re-validated through the domain parsers, so a
 * corrupt row fails loudly instead of leaking a malformed value.
 */
import {
	dateOnly,
	timedDueDate,
	timedPlannedDate,
	unsetDate,
	type DueDate,
	type PlannedDate
} from '#lib/domain/dates.js';
import type { List } from '#lib/domain/lists.js';
import {
	parseRecurrence,
	serializeRecurrence,
	type RecurrenceRule
} from '#lib/domain/recurrence.js';
import { parseSeriesTemplate, serializeSeriesTemplate, type Task } from '#lib/domain/tasks.js';
import type { ListRow, NewTaskRow, TaskRow } from './schema.js';

export function toList(row: ListRow): List {
	return {
		id: row.id,
		name: row.name,
		position: row.position,
		sortMode: row.sortMode,
		visible: row.visible,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt
	};
}

type PlannedColumns = Pick<
	TaskRow,
	'plannedDate' | 'plannedDateTime' | 'plannedTimeZone' | 'plannedDurationMinutes'
>;
type DueColumns = Pick<TaskRow, 'dueDate' | 'dueDateTime' | 'dueTimeZone'>;

export function plannedFromColumns(row: PlannedColumns): PlannedDate {
	if (row.plannedDateTime !== null) {
		return timedPlannedDate(
			row.plannedDateTime,
			row.plannedTimeZone as string,
			row.plannedDurationMinutes as number
		);
	}
	if (row.plannedDate !== null) return dateOnly(row.plannedDate);
	return unsetDate;
}

export function dueFromColumns(row: DueColumns): DueDate {
	if (row.dueDateTime !== null) return timedDueDate(row.dueDateTime, row.dueTimeZone as string);
	if (row.dueDate !== null) return dateOnly(row.dueDate);
	return unsetDate;
}

/** The `planned_*` columns for a Planned Date; every column is set, so it can be used in `update`. */
export function plannedColumns(planned: PlannedDate): PlannedColumns {
	const none = { plannedDate: null, plannedDateTime: null, plannedTimeZone: null };
	switch (planned.kind) {
		case 'unset':
			return { ...none, plannedDurationMinutes: null };
		case 'date':
			return { ...none, plannedDate: planned.date.toString(), plannedDurationMinutes: null };
		case 'timed':
			return {
				plannedDate: null,
				plannedDateTime: planned.dateTime.toString({ smallestUnit: 'minute' }),
				plannedTimeZone: planned.timeZone,
				plannedDurationMinutes: planned.durationMinutes
			};
	}
}

/** The `due_*` columns for a Due Date; every column is set, so it can be used in `update`. */
export function dueColumns(due: DueDate): DueColumns {
	switch (due.kind) {
		case 'unset':
			return { dueDate: null, dueDateTime: null, dueTimeZone: null };
		case 'date':
			return { dueDate: due.date.toString(), dueDateTime: null, dueTimeZone: null };
		case 'timed':
			return {
				dueDate: null,
				dueDateTime: due.dateTime.toString({ smallestUnit: 'minute' }),
				dueTimeZone: due.timeZone
			};
	}
}

export function recurrenceColumn(rule: RecurrenceRule | null): Pick<NewTaskRow, 'recurrence'> {
	return { recurrence: rule && serializeRecurrence(rule) };
}

export function toTask(row: TaskRow): Task {
	return {
		id: row.id,
		listId: row.listId,
		parentId: row.parentId,
		title: row.title,
		description: row.description,
		position: row.position,
		planned: plannedFromColumns(row),
		due: dueFromColumns(row),
		priority: row.priority,
		completedAt: row.completedAt,
		completedByCascade: row.completedByCascade,
		recurrence: row.recurrence === null ? null : parseRecurrence(row.recurrence),
		seriesId: row.seriesId,
		occurrencesSoFar: row.occurrencesSoFar,
		generatedFromTaskId: row.generatedFromTaskId,
		changedSinceGenerated: row.changedSinceGenerated,
		seriesTemplate: row.seriesTemplate === null ? null : parseSeriesTemplate(row.seriesTemplate),
		createdAt: row.createdAt,
		updatedAt: row.updatedAt
	};
}

/**
 * The columns for a Task's own fields (everything but ids, timestamps and ownership), e.g. to
 * insert a copy of a Task.
 */
export function taskColumns(
	task: Omit<Task, 'id' | 'listId' | 'createdAt' | 'updatedAt'>
): Omit<NewTaskRow, 'id' | 'userId' | 'listId' | 'createdAt' | 'updatedAt'> {
	return {
		parentId: task.parentId,
		title: task.title,
		description: task.description,
		position: task.position,
		...plannedColumns(task.planned),
		...dueColumns(task.due),
		priority: task.priority,
		completedAt: task.completedAt,
		completedByCascade: task.completedByCascade,
		...recurrenceColumn(task.recurrence),
		seriesId: task.seriesId,
		occurrencesSoFar: task.occurrencesSoFar,
		generatedFromTaskId: task.generatedFromTaskId,
		changedSinceGenerated: task.changedSinceGenerated,
		seriesTemplate: task.seriesTemplate && serializeSeriesTemplate(task.seriesTemplate)
	};
}
