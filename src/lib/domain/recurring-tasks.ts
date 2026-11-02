/**
 * Rules for recurring Tasks (CONTEXT.md → Recurrence, Occurrence, Reopen) that sit between the
 * pure Recurrence module (`./recurrence`) and the Tasks that carry a rule. Shared by the server and
 * the browser (the Recurrence editor and row icon).
 */
import type { Temporal } from 'temporal-polyfill';
import { localDate, type DateOnly, type TimedDate } from './dates';
import {
	nextOccurrence,
	stepDriver,
	type OccurrenceDates,
	type RecurrenceRule,
	type Weekday
} from './recurrence';

export const NEEDS_A_DATE = 'A recurring Task needs a Planned Date or a Due Date';

/** Whether a Task has a Planned Date or a Due Date, which a recurring Task needs. */
export function hasDate({ planned, due }: OccurrenceDates): boolean {
	return planned.kind !== 'unset' || due.kind !== 'unset';
}

/** The fields of a Task and its family that the exclusivity rule reads. */
export interface RecurrenceRelative {
	id: string;
	parentId: string | null;
	recurrence: unknown;
	completedAt: unknown;
	completedByCascade: boolean;
}

/** Why a Task can't get a Recurrence because of its family (see {@link recurrenceConflict}). */
export type RecurrenceConflict = 'parent-repeats' | 'subtask-repeats';

export const RECURRENCE_CONFLICT_MESSAGES: Record<RecurrenceConflict, string> = {
	'parent-repeats': 'The parent Task repeats, so its Subtasks can’t',
	'subtask-repeats': 'A Subtask of this Task repeats, so it can’t repeat too'
};

/**
 * Whether a Task can't get a Recurrence because a Task and its Subtasks can't both recur: a
 * Subtask whose parent recurs, or a parent with a recurring Subtask. A Subtask counts while it is
 * open, and while its parent's completion has stopped it (Reopening the parent restarts it); a
 * Completed Occurrence of a recurring Subtask doesn't (its next Occurrence does, if any).
 *
 * `family` holds the Task's parent or Subtasks (more Tasks are fine).
 */
export function recurrenceConflict<T extends RecurrenceRelative>(
	task: T,
	family: Iterable<T>
): RecurrenceConflict | null {
	const relatives = [...family];
	if (task.parentId !== null) {
		const parent = relatives.find((candidate) => candidate.id === task.parentId);
		return parent?.recurrence ? 'parent-repeats' : null;
	}
	const recurringSubtask = relatives.some(
		(candidate) =>
			candidate.parentId === task.id &&
			candidate.recurrence &&
			(!candidate.completedAt || candidate.completedByCascade)
	);
	return recurringSubtask ? 'subtask-repeats' : null;
}

/**
 * The rule with the weekdays (weekly) or month day (monthly, yearly) of the driving date filled
 * in when it doesn't name them. The Recurrence module needs them stored to keep the intended
 * weekday and month end once a date has been clamped or moved. Throws when neither date is set.
 */
export function withDrivingDefaults(rule: RecurrenceRule, dates: OccurrenceDates): RecurrenceRule {
	const driver = localDate(dates[stepDriver(dates)] as DateOnly | TimedDate);
	switch (rule.frequency) {
		case 'weekly':
			return rule.weekdays ? rule : { ...rule, weekdays: [driver.dayOfWeek as Weekday] };
		case 'monthly':
		case 'yearly':
			return rule.monthDay ? rule : { ...rule, monthDay: driver.day };
		default:
			return rule;
	}
}

/** The dates of the next Occurrence, and how many calendar days its driving date moved. */
export type OccurrenceStep = OccurrenceDates & { days: number };

/**
 * The step from a recurring Task to its next Occurrence, or `null` when the Recurrence has ended.
 * `days` is how far the driving date moved; the next Occurrence's Subtasks shift by as much.
 */
export function nextOccurrenceStep(
	task: OccurrenceDates & { recurrence: RecurrenceRule; occurrencesSoFar: number },
	completedAt: Temporal.ZonedDateTime
): OccurrenceStep | null {
	const next = nextOccurrence({
		planned: task.planned,
		due: task.due,
		rule: task.recurrence,
		occurrencesSoFar: task.occurrencesSoFar,
		completedAt
	});
	if (!next) return null;
	const driver = stepDriver(task);
	const from = localDate(task[driver] as DateOnly | TimedDate);
	const to = localDate(next[driver] as DateOnly | TimedDate);
	return { ...next, days: from.until(to).days };
}
