/** Pure helpers for dragging List entries in the sidebar. */

/**
 * Where a dragged entry lands: the number of the *other* entries whose vertical midpoint is above
 * the pointer. That is the entry's index once the move is done.
 */
export function dropIndex(otherMidpoints: number[], pointerY: number): number {
	return otherMidpoints.filter((mid) => mid < pointerY).length;
}
