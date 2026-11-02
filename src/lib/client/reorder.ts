/** Pure helpers for drag-and-drop: List entries in the sidebar, Tasks in the List columns. */
import type { TaskMove } from '#lib/domain/moves.js';

/**
 * Where a dragged entry lands: the number of the *other* entries whose vertical midpoint is above
 * the pointer. That is the entry's index once the move is done.
 */
export function dropIndex(otherMidpoints: number[], pointerY: number): number {
	return otherMidpoints.filter((mid) => mid < pointerY).length;
}

/** A row of a List column as shown: a top-level Task (`parentId` null) or an open Subtask. */
export interface Row {
	id: string;
	parentId: string | null;
}

/** 0 for a top-level Task, 1 for a Subtask. */
export type Depth = 0 | 1;

/**
 * Where a Task dropped into a List column goes. `rows` are the column's other rows, top to
 * bottom; `slot` is where among them it was dropped (see {@link dropIndex}), and `wanted` the
 * depth the pointer asks for (dragged to the right to nest, to the left to promote). Returns the
 * depth it actually gets and the move to make.
 */
export function dropMove(
	listId: string,
	rows: readonly Row[],
	slot: number,
	wanted: Depth
): { depth: Depth; move: TaskMove } {
	const above = rows[slot - 1];
	const below = rows[slot];
	// Between a parent and its Subtasks, or between two Subtasks, only a Subtask fits; at the very
	// top only a top-level Task does.
	const canBeTopLevel = below === undefined || below.parentId === null;
	const depth: Depth = above && (wanted === 1 || !canBeTopLevel) ? 1 : 0;

	if (above && depth === 1) {
		const parentId = above.parentId ?? above.id;
		const move: TaskMove = { listId, parentId };
		if (below?.parentId === parentId) move.before = below.id;
		else if (above.parentId === parentId) move.after = above.id;
		return { depth, move };
	}
	if (below) return { depth, move: { listId, parentId: null, before: below.id } };
	if (above) return { depth, move: { listId, parentId: null, after: above.parentId ?? above.id } };
	return { depth, move: { listId, parentId: null } };
}
