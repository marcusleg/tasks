/**
 * Rules for Subtasks (CONTEXT.md → Subtask, Completed, Reopen), shared by the server and the
 * browser's optimistic store. Generic over the timestamp type, so they work on `Task` (Dates) and
 * `SerializedTask` (ISO strings) alike.
 */
import { generateKeyBetween } from 'fractional-indexing';
import { comparePositions } from './lists';
import { byCustomOrder } from './tasks';

/** The fields the completion rules read. */
export interface Completable<C> {
	id: string;
	parentId: string | null;
	completedAt: C | null;
	completedByCascade: boolean;
}

/** The fields of a would-be parent that the nesting rule reads. */
export interface Nestable {
	id: string;
	parentId: string | null;
	completedAt: unknown;
}

/**
 * Why a Task can't become a Subtask of `parent`, or `null` if it can. Nesting is one level deep:
 * a Subtask can't have Subtasks, and a Task that has Subtasks can't become one. An open Subtask
 * can't go under a Completed Task either, since a Completed Task never has open Subtasks.
 *
 * `child` is an existing Task being moved under `parent`; leave it out for a new Task.
 */
export function nestingError(
	parent: Nestable,
	child?: { id: string; hasSubtasks: boolean }
): string | null {
	const problem = nestingProblem(parent, child);
	return problem && NESTING_MESSAGES[problem];
}

/** Why a Task can't become a Subtask (see {@link nestingProblem}). */
export type NestingProblem =
	'parent-is-subtask' | 'own-subtask' | 'has-subtasks' | 'parent-completed';

export const NESTING_MESSAGES: Record<NestingProblem, string> = {
	'parent-is-subtask': 'A Subtask can’t have Subtasks of its own',
	'own-subtask': 'A Task can’t be its own Subtask',
	'has-subtasks': 'A Task with Subtasks can’t become a Subtask',
	'parent-completed': 'A Completed Task can’t get new Subtasks; reopen it first'
};

/** Like {@link nestingError}, as a code the browser can word in the User's Language. */
export function nestingProblem(
	parent: Nestable,
	child?: { id: string; hasSubtasks: boolean }
): NestingProblem | null {
	if (parent.parentId !== null) return 'parent-is-subtask';
	if (child?.id === parent.id) return 'own-subtask';
	if (child?.hasSubtasks) return 'has-subtasks';
	if (parent.completedAt) return 'parent-completed';
	return null;
}

/** A change to one Task's completion; `completedAt` is left out when it stays as it is. */
export interface CompletionChange<C> {
	id: string;
	completedAt?: C | null;
	completedByCascade: boolean;
}

/**
 * What completing a Task changes: the Task itself, and every open Subtask of it, which is marked
 * as closed by the cascade so that Reopen can restore exactly those.
 */
export function completionChanges<C>(
	tasks: readonly Completable<C>[],
	id: string,
	now: C
): CompletionChange<C>[] {
	const task = tasks.find((candidate) => candidate.id === id);
	if (!task || task.completedAt) return [];
	const subtasks = tasks.filter((candidate) => candidate.parentId === id && !candidate.completedAt);
	return [
		{ id, completedAt: now, completedByCascade: false },
		...subtasks.map((subtask) => ({
			id: subtask.id,
			completedAt: now,
			completedByCascade: true
		}))
	];
}

/**
 * What reopening a Task changes:
 *
 * - For a parent: the parent, and the Subtasks its completion closed (those marked as closed by
 *   the cascade). Subtasks the User completed themselves stay Completed.
 * - For a Subtask: the Subtask, and its parent if that is Completed, since a Completed Task never
 *   has open Subtasks. The parent's other Subtasks stay Completed, and those its completion had
 *   closed lose that mark: their completion now counts as the User's, so a later Reopen of the
 *   parent puts them back as they were just before it was completed again.
 *
 * Reopening an open Task changes nothing.
 */
export function reopenChanges<C>(
	tasks: readonly Completable<C>[],
	id: string
): CompletionChange<C>[] {
	const task = tasks.find((candidate) => candidate.id === id);
	if (!task || !task.completedAt) return [];
	const reopen = (target: Completable<C>): CompletionChange<C> => ({
		id: target.id,
		completedAt: null,
		completedByCascade: false
	});
	const closedByCascade = (parentId: string) =>
		tasks.filter(
			(candidate) =>
				candidate.parentId === parentId && candidate.completedAt && candidate.completedByCascade
		);

	if (task.parentId === null) return [reopen(task), ...closedByCascade(task.id).map(reopen)];

	const parent = tasks.find((candidate) => candidate.id === task.parentId);
	if (!parent?.completedAt) return [reopen(task)];
	const siblings = closedByCascade(parent.id).filter((sibling) => sibling.id !== task.id);
	return [
		reopen(task),
		reopen(parent),
		...siblings.map((sibling) => ({ id: sibling.id, completedByCascade: false }))
	];
}

type Ordered = { id: string; position: string };

/** The Subtasks of a parent, in Custom Order. */
export function subtasksOf<T extends Ordered & { parentId: string | null }>(
	tasks: Iterable<T>,
	parentId: string
): T[] {
	return [...tasks].filter((task) => task.parentId === parentId).sort(byCustomOrder);
}

/**
 * The position of a new Task among its siblings (the other Tasks with the same List and parent):
 * a top-level Task goes to the top of the List, a Subtask to the bottom of its parent's Subtasks,
 * which reads more naturally for a checklist.
 */
export function newTaskPosition(
	siblings: readonly { position: string }[],
	parentId: string | null
): string {
	const positions = siblings.map((sibling) => sibling.position).sort(comparePositions);
	return parentId === null
		? generateKeyBetween(null, positions[0] ?? null)
		: generateKeyBetween(positions.at(-1) ?? null, null);
}

type Listed = Ordered & { listId: string; parentId: string | null; completedAt: string | null };

/**
 * One entry of a List's Completed section: a Completed top-level Task with its Subtasks, or an
 * open parent (shown only by name) with its Completed Subtasks.
 */
export interface CompletedGroup<T> {
	parent: T;
	/** In Custom Order. */
	subtasks: T[];
}

/** A List's Completed section, most recently Completed first. */
export function completedGroupsOf<T extends Listed>(
	tasks: Iterable<T>,
	listId: string
): CompletedGroup<T>[] {
	const inList = [...tasks].filter((task) => task.listId === listId);
	const groups: Array<CompletedGroup<T> & { latest: string }> = [];
	for (const parent of inList) {
		if (parent.parentId !== null) continue;
		const subtasks = subtasksOf(inList, parent.id).filter((subtask) => subtask.completedAt);
		const latest =
			parent.completedAt ??
			subtasks.reduce<string | null>(
				(max, subtask) =>
					max === null || comparePositions(subtask.completedAt as string, max) > 0
						? subtask.completedAt
						: max,
				null
			);
		if (latest !== null) groups.push({ parent, subtasks, latest });
	}
	return groups
		.sort((a, b) => comparePositions(b.latest, a.latest) || byCustomOrder(a.parent, b.parent))
		.map(({ parent, subtasks }) => ({ parent, subtasks }));
}
