/**
 * Rules for recurring Tasks (CONTEXT.md → Recurrence, Occurrence, Reopen) that sit between the
 * pure Recurrence module (`./recurrence`) and the Tasks that carry a rule. Shared by the server and
 * the browser (the Recurrence editor and row icon).
 */
import type { Temporal } from 'temporal-polyfill';
import {
	localDate,
	serializeDueDate,
	serializePlannedDate,
	type DateOnly,
	type TimedDate
} from './dates';
import type { SeriesTemplate, Task } from './tasks';
import {
	nextOccurrence,
	stepDriver,
	type OccurrenceDates,
	type RecurrenceRule,
	type Weekday
} from './recurrence';

export const NEEDS_A_DATE = 'A recurring Task needs a Planned Date or a Due Date';

/**
 * Which Occurrences an edit or a delete of a recurring Task applies to (CONTEXT.md → Occurrence):
 * "This Occurrence" only, or "This and all future" ones.
 */
export type ApplyTo = 'occurrence' | 'future';
export const APPLY_TO: readonly ApplyTo[] = ['occurrence', 'future'];

/** The fields of a Task that a {@link SeriesTemplate} holds, besides the Subtasks. */
export type TemplateFields = Pick<Task, 'title' | 'description' | 'priority' | 'planned' | 'due'>;

/**
 * What the series makes of a Task's current Occurrence: its template, or the Task's own values
 * while it is itself the template.
 */
export function seriesTemplateOf(
	task: TemplateFields & Pick<Task, 'seriesTemplate'>
): SeriesTemplate {
	return (
		task.seriesTemplate ?? {
			title: task.title,
			description: task.description,
			priority: task.priority,
			planned: task.planned,
			due: task.due
		}
	);
}

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

/**
 * Whether the current Occurrence differs from what its series makes of it (its template) in what
 * a calendar shows: its dates, which then no longer lie on the rule after a "This Occurrence"
 * move, or its Title or Description. Calendar Links publish a detached Occurrence on its own,
 * followed by the series from the next Occurrence (`CalendarRecurrence.detached`).
 */
export function isDetached(task: TemplateFields & Pick<Task, 'seriesTemplate'>): boolean {
	const template = task.seriesTemplate;
	if (!template) return false;
	return (
		task.title !== template.title ||
		task.description !== template.description ||
		JSON.stringify(serializePlannedDate(task.planned)) !==
			JSON.stringify(serializePlannedDate(template.planned)) ||
		JSON.stringify(serializeDueDate(task.due)) !== JSON.stringify(serializeDueDate(template.due))
	);
}

/**
 * The rule after a "This and all future" date change moved the series from `from` (where the
 * current Occurrence lies on the rule) to `to`: the weekday of the driving date is replaced by the
 * new one in a weekly rule, and the month day of a monthly or yearly rule becomes the new driving
 * date's day. Daily rules, and moves that keep the driving date, keep the rule as it is. A weekly
 * rule that doesn't list the old weekday is kept too: the moved date wasn't on it to begin with.
 */
export function reanchorRule(
	rule: RecurrenceRule,
	from: OccurrenceDates,
	to: OccurrenceDates
): RecurrenceRule {
	const before = localDate(from[stepDriver(from)] as DateOnly | TimedDate);
	const after = localDate(to[stepDriver(to)] as DateOnly | TimedDate);
	if (before.equals(after)) return rule;
	switch (rule.frequency) {
		case 'weekly': {
			const old = before.dayOfWeek as Weekday;
			const weekdays = rule.weekdays ?? [old];
			if (!weekdays.includes(old)) return rule;
			const moved = new Set([...weekdays.filter((day) => day !== old), after.dayOfWeek as Weekday]);
			return { ...rule, weekdays: [...moved].sort((a, b) => a - b) };
		}
		case 'monthly':
		case 'yearly':
			return { ...rule, monthDay: after.day };
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

const UNITS = {
	daily: ['daily', 'days'],
	weekly: ['weekly', 'weeks'],
	monthly: ['monthly', 'months'],
	yearly: ['yearly', 'years']
} as const;

/** A short label for a Recurrence, e.g. "Repeats weekly" or "Repeats every 10 days after completion". */
export function describeRecurrence(rule: RecurrenceRule): string {
	const [single, plural] = UNITS[rule.frequency];
	const every = rule.interval === 1 ? single : `every ${rule.interval} ${plural}`;
	return `Repeats ${every}${rule.anchor === 'completion' ? ' after completion' : ''}`;
}
