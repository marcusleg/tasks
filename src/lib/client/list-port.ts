/**
 * What a {@link ListStore} needs from the outside: the server's List mutations and a reload of
 * the Lists (ADR 0003). In production this is the JSON endpoints (`list-port.http.ts`); specs use
 * an in-process adapter that calls the same endpoints on in-memory SQLite.
 */
import type { SerializedList, SortMode } from '#lib/domain/lists.js';

/** What a PATCH can change: the fields, or a move next to another List (`before` or `after`). */
export interface ListPatch {
	name?: string;
	sortMode?: SortMode;
	visible?: boolean;
	before?: string;
	after?: string;
}

export interface ListPort {
	createList(input: { id: string; name: string }): Promise<{ list: SerializedList }>;
	updateList(id: string, patch: ListPatch): Promise<{ list: SerializedList }>;
	deleteList(id: string): Promise<void>;
	/** Reloads the Lists, so the store's copy matches the server again. */
	reload(): Promise<void>;
}
