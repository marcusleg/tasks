/**
 * Moving Tasks in Custom Order (CONTEXT.md → Custom Order, Subtask, Recurrence), shared by the
 * server and the browser's optimistic store: reordering among siblings, nesting a Task under
 * another one, promoting a Subtask, and moving a Task (with its Subtasks) to another List.
 */
import { generateKeyBetween } from 'fractional-indexing';
import { RECURRENCE_CONFLICT_MESSAGES, recurrenceConflict } from './recurring-tasks';
import { nestingError } from './subtasks';
import { byCustomOrder } from './tasks';
import { InvalidInputError } from './validation';

/**
 * Where a Task goes: a List, a parent (`null` for top level), and right before or after one of
 * its new siblings.
 */
export interface TaskMove {
	listId: string;
	parentId: string | null;
	before?: string;
	after?: string;
}

/** The fields the move rules read. */
export interface Movable {
	id: string;
	listId: string;
	parentId: string | null;
	position: string;
	completedAt: unknown;
	completedByCascade: boolean;
	recurrence: unknown;
}

/** What a move changes for one Task. */
export interface MoveChange {
	id: string;
	listId: string;
	parentId: string | null;
	position: string;
}

/**
 * Why Task `id` can't make `move`, or `null` if it can. `tasks` must hold the Task, its Subtasks,
 * and the Tasks of the target List.
 */
export function moveError(tasks: readonly Movable[], id: string, move: TaskMove): string | null {
	const task = tasks.find((t) => t.id === id);
	if (!task) return 'Unknown Task';
	if (task.completedAt) return 'A Completed Task can’t be moved; reopen it first';
	if (move.parentId !== null) {
		const parent = tasks.find((t) => t.id === move.parentId);
		if (!parent) return 'Unknown parent Task';
		if (parent.listId !== move.listId) return 'A Subtask must be in the same List as its parent';
		const hasSubtasks = tasks.some((t) => t.parentId === id);
		const problem = nestingError(parent, { id, hasSubtasks });
		if (problem) return problem;
		// The same exclusivity rule as setting a Recurrence (`recurrenceConflict`).
		if (task.recurrence) {
			const conflict = recurrenceConflict({ ...task, parentId: move.parentId }, tasks);
			if (conflict) return RECURRENCE_CONFLICT_MESSAGES[conflict];
		}
	}
	if (move.before !== undefined && move.after !== undefined) {
		return 'Give before or after, not both';
	}
	const neighbourId = move.before ?? move.after;
	if (neighbourId !== undefined) {
		if (neighbourId === id) return 'A Task can’t be moved next to itself';
		const neighbour = tasks.find((t) => t.id === neighbourId);
		if (!neighbour || neighbour.listId !== move.listId || neighbour.parentId !== move.parentId) {
			return 'Unknown neighbour';
		}
	}
	return null;
}

/** The changes that carry out `move` for Task `id`. Throws `InvalidInputError` if it isn't allowed. */
export function moveChanges(tasks: readonly Movable[], id: string, move: TaskMove): MoveChange[] {
	const problem = moveError(tasks, id, move);
	if (problem) throw new InvalidInputError(problem);
	const siblings = tasks
		.filter((t) => t.id !== id && t.listId === move.listId && t.parentId === move.parentId)
		.sort(byCustomOrder);
	const task = tasks.find((t) => t.id === id) as Movable;
	const [lower, upper] = bounds(siblings, move);
	const stays =
		task.listId === move.listId &&
		task.parentId === move.parentId &&
		(!lower || byCustomOrder(lower, task) < 0) &&
		(!upper || byCustomOrder(task, upper) < 0);
	const moved: MoveChange = {
		id,
		listId: move.listId,
		parentId: move.parentId,
		position: stays ? task.position : keyBetween(lower, upper)
	};
	// Subtasks follow their parent into another List, keeping their order.
	const subtasks = tasks
		.filter((t) => t.parentId === id && t.listId !== move.listId)
		.map(({ id, parentId, position }) => ({ id, listId: move.listId, parentId, position }));
	return [moved, ...subtasks];
}

type Bound = Movable | undefined;

/**
 * The siblings (the other Tasks of the new List and parent, in Custom Order) that the moved Task
 * goes between. Without a neighbour, a top-level Task goes to the top of the List and a Subtask to
 * the bottom of its parent's Subtasks, like a new Task (`newTaskPosition`).
 */
function bounds(siblings: readonly Movable[], move: TaskMove): [Bound, Bound] {
	const neighbour = move.before ?? move.after;
	if (neighbour === undefined) {
		return move.parentId === null ? [undefined, siblings[0]] : [siblings.at(-1), undefined];
	}
	const index = siblings.findIndex((t) => t.id === neighbour);
	return move.before !== undefined
		? [siblings[index - 1], siblings[index]]
		: [siblings[index], siblings[index + 1]];
}

function keyBetween(lower: Bound, upper: Bound): string {
	try {
		return generateKeyBetween(lower?.position ?? null, upper?.position ?? null);
	} catch {
		throw new InvalidInputError('Tasks have invalid positions');
	}
}

/** A one-step move from the keyboard (Arrow Up/Down, Right to indent, Left to outdent). */
export type Step = 'up' | 'down' | 'indent' | 'outdent';

/**
 * The move that takes Task `id` one step: up or down among its open siblings, under the open Task
 * above it (at the bottom of that one's Subtasks), or out of its parent (right after it). `null`
 * when there is nowhere to go. Whether the move is allowed is {@link moveError}'s business.
 */
export function stepMove(tasks: readonly Movable[], id: string, step: Step): TaskMove | null {
	const task = tasks.find((t) => t.id === id);
	if (!task) return null;
	const { listId, parentId } = task;
	const siblings = tasks
		.filter((t) => t.listId === listId && t.parentId === parentId && !t.completedAt)
		.sort(byCustomOrder);
	const index = siblings.findIndex((t) => t.id === id);
	const previous = siblings[index - 1];
	const next = siblings[index + 1];

	switch (step) {
		case 'up':
			return previous ? { listId, parentId, before: previous.id } : null;
		case 'down':
			return next ? { listId, parentId, after: next.id } : null;
		case 'indent':
			return parentId === null && previous ? { listId, parentId: previous.id } : null;
		case 'outdent':
			return parentId === null ? null : { listId, parentId: null, after: parentId };
	}
}
