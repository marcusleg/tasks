/**
 * What a User's change to a Task or its Subtasks does to the Occurrence around it (CONTEXT.md →
 * Occurrence, Reopen). The mutations in `./tasks` say what the User did; this module knows the two
 * consequences:
 *
 * - **The changed state.** A changed Occurrence no longer gives way to the one before it when that
 *   one is reopened. Field edits and moves mark the Task itself, and any change to a Subtask marks
 *   its parent. Completing or reopening a Task itself doesn't count, and neither does a completed
 *   Subtask's parent being marked once Undo has put the completion back (Undo restores the
 *   parent's changed state exactly).
 * - **The Subtask template of an open recurring parent**, which the next Occurrence's Subtasks come
 *   from once it exists. "This Occurrence" first keeps the Subtasks as they are in it, so future
 *   Occurrences get those rather than the changed ones. "This and all future" also changes the
 *   template, if there is one (otherwise the next Occurrence copies the Subtasks anyway).
 *
 * Keeping has to read the Subtasks before they change and editing needs the written Subtask, so a
 * change has two steps: `begin…` before the write, then the method naming what happened after it.
 * Call both inside the mutation's transaction. Each step's Tasks belong in its change set.
 */
import { and, eq, type SQL } from 'drizzle-orm';
import { seriesTemplateOf, type ApplyTo } from '#lib/domain/recurring-tasks.js';
import {
	byCustomOrder,
	serializeSeriesTemplate,
	type SeriesTemplate,
	type SubtaskTemplate,
	type Task
} from '#lib/domain/tasks.js';
import { toTask } from './db/mapping.js';
import { tasks } from './db/schema.js';
import { ownedBy, type UserScope } from './scope.js';

/**
 * A change under way; each method finishes it and returns the Tasks the bookkeeping wrote.
 * Single-use: call one method, once. Another call would edit the template and return `kept` again.
 */
export interface OccurrenceChange {
	/** `subtask` was created under the parent. */
	added(subtask: Task): Task[];
	/** `task` was written with its new values; it counts as changed too. */
	edited(task: Task): Task[];
	/** The Subtask with this id was deleted. */
	deleted(id: string): Task[];
}

/**
 * Call before writing a change to a Task whose parent is `parentId` (`null` for a top-level Task,
 * whose only bookkeeping is its own changed state).
 *
 * `applyTo` is the scope the User chose. `null` means the change stays out of the Subtask template
 * whichever scope was chosen, like changing a Subtask's own Recurrence.
 */
export function beginOccurrenceChange(
	scope: UserScope,
	parentId: string | null,
	applyTo: ApplyTo | null
): OccurrenceChange {
	const parent = openRecurringParent(scope, parentId);
	const kept = parent && applyTo === 'occurrence' ? keepSubtaskTemplate(scope, parent) : [];
	const finish = (edit: SubtaskTemplateEdit, ...changed: (string | null)[]) => [
		...kept,
		...(parent && applyTo === 'future' ? editSubtaskTemplate(scope, parent, edit) : []),
		...changed.flatMap((id) => markChanged(scope, id))
	];
	return {
		added: (subtask) => finish((subtasks) => [...subtasks, subtaskTemplate(subtask)], parentId),
		edited: (task) =>
			finish(
				(subtasks) =>
					subtasks.map((entry) => (entry.sourceId === task.id ? subtaskTemplate(task) : entry)),
				task.id,
				parentId
			),
		deleted: (id) =>
			finish((subtasks) => subtasks.filter((entry) => entry.sourceId !== id), parentId)
	};
}

/** A move under way. Single-use: call `moved` once. */
export interface OccurrenceMove {
	/** The parents whose Subtask template the move made it keep. */
	readonly kept: Task[];
	/** The Task was written at `to`. Returns the Tasks marked as changed, if it actually moved. */
	moved(to: Pick<Task, 'listId' | 'parentId' | 'position'>): Task[];
}

/**
 * Call before moving `task` under `parentId`. A Subtask leaving or joining a recurring Task changes
 * This Occurrence only, so both parents keep their template; moving among the same siblings leaves
 * it alone. A move that changes anything marks the Task and both parents.
 */
export function beginOccurrenceMove(
	scope: UserScope,
	task: Task,
	parentId: string | null
): OccurrenceMove {
	const kept =
		parentId === task.parentId
			? []
			: [task.parentId, parentId].flatMap((id) => {
					const parent = openRecurringParent(scope, id);
					return parent ? keepSubtaskTemplate(scope, parent) : [];
				});
	return {
		kept,
		moved(to) {
			const moved =
				to.listId !== task.listId || to.parentId !== task.parentId || to.position !== task.position;
			if (!moved) return [];
			return [...new Set([task.id, task.parentId, to.parentId])].flatMap((id) =>
				markChanged(scope, id)
			);
		}
	};
}

/**
 * A Subtask of `parentId` was completed or reopened: progress on the current Occurrence rather than
 * a change to the series, so it asks for no scope and leaves the template alone, but it does count
 * as a change for Reopen. Call it only when something actually changed. `null` (a top-level Task)
 * does nothing.
 */
export function recordSubtaskProgress(scope: UserScope, parentId: string | null): Task[] {
	return markChanged(scope, parentId);
}

type SubtaskTemplateEdit = (subtasks: SubtaskTemplate[]) => SubtaskTemplate[];

function owned(scope: UserScope, ...conditions: SQL[]): SQL {
	return and(ownedBy(tasks.userId, scope), ...conditions) as SQL;
}

/** The parent, if it is an open recurring Task: the one whose template a change may reach. */
function openRecurringParent(scope: UserScope, parentId: string | null): Task | undefined {
	if (parentId === null) return undefined;
	const row = scope.db
		.select()
		.from(tasks)
		.where(owned(scope, eq(tasks.id, parentId)))
		.get();
	return row?.recurrence && !row.completedAt ? toTask(row) : undefined;
}

/** Returns the Task if this is what marked it. `null` (no parent) does nothing. */
function markChanged(scope: UserScope, id: string | null): Task[] {
	if (id === null) return [];
	return scope.db
		.update(tasks)
		.set({ changedSinceGenerated: true })
		.where(owned(scope, eq(tasks.id, id), eq(tasks.changedSinceGenerated, false)))
		.returning()
		.all()
		.map(toTask);
}

function subtaskTemplate(subtask: Task): SubtaskTemplate {
	return {
		sourceId: subtask.id,
		title: subtask.title,
		description: subtask.description,
		priority: subtask.priority,
		planned: subtask.planned,
		due: subtask.due,
		position: subtask.position
	};
}

function writeTemplate(scope: UserScope, id: string, template: SeriesTemplate): Task {
	return toTask(
		scope.db
			.update(tasks)
			.set({ seriesTemplate: serializeSeriesTemplate(template) })
			.where(owned(scope, eq(tasks.id, id)))
			.returning()
			.get()
	);
}

/** Returns the parent if its template changed. */
function keepSubtaskTemplate(scope: UserScope, parent: Task): Task[] {
	if (parent.seriesTemplate?.subtasks) return [];
	const subtasks = scope.db
		.select()
		.from(tasks)
		.where(owned(scope, eq(tasks.parentId, parent.id)))
		.all()
		.map(toTask)
		.sort(byCustomOrder)
		.map(subtaskTemplate);
	return [writeTemplate(scope, parent.id, { ...seriesTemplateOf(parent), subtasks })];
}

/** Returns the parent if it has a Subtask template to change. */
function editSubtaskTemplate(scope: UserScope, parent: Task, edit: SubtaskTemplateEdit): Task[] {
	const template = parent.seriesTemplate;
	if (!template?.subtasks) return [];
	return [writeTemplate(scope, parent.id, { ...template, subtasks: edit(template.subtasks) })];
}
