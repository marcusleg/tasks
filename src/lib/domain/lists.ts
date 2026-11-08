/**
 * The List model shared by server and browser (see CONTEXT.md → List, Sort Mode).
 */
import { generateKeyBetween } from 'fractional-indexing';
import { InvalidInputError, requiredText } from './validation';

export const SORT_MODES = ['custom', 'planned', 'due', 'priority', 'title'] as const;
/** How a List is displayed; `custom` is Custom Order. */
export type SortMode = (typeof SORT_MODES)[number];

export const MAX_LIST_NAME_LENGTH = 100;

export interface List {
	id: string;
	name: string;
	/** Fractional-index key (`fractional-indexing`); Lists sort by it with plain string comparison. */
	position: string;
	sortMode: SortMode;
	/** Whether the List's column is shown in the multi-List layout (#10). */
	visible: boolean;
	createdAt: Date;
	updatedAt: Date;
}

/** JSON shape of a {@link List}, as sent to the browser: timestamps as ISO strings. */
export type SerializedList = Omit<List, 'createdAt' | 'updatedAt'> & {
	createdAt: string;
	updatedAt: string;
};

export function serializeList(list: List): SerializedList {
	return {
		...list,
		createdAt: list.createdAt.toISOString(),
		updatedAt: list.updatedAt.toISOString()
	};
}

export function isSortMode(value: unknown): value is SortMode {
	return SORT_MODES.includes(value as SortMode);
}

/** A valid List name: trimmed, non-empty. Throws `InvalidInputError`. */
export function parseListName(value: unknown): string {
	return requiredText(value, 'List name', MAX_LIST_NAME_LENGTH);
}

/**
 * Orders fractional-index keys (List and Task positions). Keys must be compared by code unit,
 * like SQLite's default collation, never with `localeCompare`.
 */
export function comparePositions(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

export function sortLists<T extends Pick<List, 'position' | 'id'>>(lists: T[]): T[] {
	return [...lists].sort(
		(a, b) => comparePositions(a.position, b.position) || comparePositions(a.id, b.id)
	);
}

/** Where to put a List: right before or right after another List. */
export type ListMove = { before: string } | { after: string };

/**
 * The position that puts List `id` before or after the List named in `move`, among `lists`.
 * Only the new key changes; no other List is touched. Throws `InvalidInputError` if the target
 * is missing or is the List itself.
 */
export function positionForMove<T extends Pick<List, 'position' | 'id'>>(
	lists: T[],
	id: string,
	move: ListMove
): string {
	const targetId = 'before' in move ? move.before : move.after;
	if (targetId === id) throw new InvalidInputError('A List can’t be moved next to itself');
	const others = sortLists(lists).filter((list) => list.id !== id);
	const index = others.findIndex((list) => list.id === targetId);
	if (index === -1) throw new InvalidInputError('Unknown target List');

	const [lower, upper] =
		'before' in move ? [others[index - 1], others[index]] : [others[index], others[index + 1]];
	try {
		return generateKeyBetween(lower?.position ?? null, upper?.position ?? null);
	} catch {
		throw new InvalidInputError('Lists have invalid positions');
	}
}

/**
 * The move that takes the List at `from` to index `to` in `ordered` (as an index in the order
 * after the move), or `null` when it would stay where it is.
 */
export function moveToIndex(ordered: { id: string }[], from: number, to: number): ListMove | null {
	const target = Math.max(0, Math.min(ordered.length - 1, to));
	if (from < 0 || from >= ordered.length || target === from) return null;
	const others = ordered.filter((_, i) => i !== from);
	return target === 0 ? { before: others[0].id } : { after: others[target - 1].id };
}
