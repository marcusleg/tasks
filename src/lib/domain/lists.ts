/**
 * The List model shared by server and browser (see CONTEXT.md → List, Sort Mode).
 */
import { requiredText } from './validation';

export const SORT_MODES = ['custom', 'planned', 'due', 'priority', 'title'] as const;
/** How a List is displayed; `custom` is Custom Order. */
export type SortMode = (typeof SORT_MODES)[number];

export const DEFAULT_LIST_NAME = 'My Tasks';
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
