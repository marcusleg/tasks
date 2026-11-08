/**
 * The browser's copy of the User's Lists (sidebar, List headers), with optimistic mutations like
 * {@link TaskStore}: each change is applied locally at once, then sent through the shared
 * {@link OptimisticQueue}, one request at a time and in order. Created by the root
 * layout from its `load` data and shared through context.
 */
import { getContext, setContext } from 'svelte';
import { generateKeyBetween } from 'fractional-indexing';
import {
	parseListName,
	positionForMove,
	sortLists,
	type ListMove,
	type SerializedList,
	type SortMode
} from '#lib/domain/lists.js';
import { newId, timestamp } from '#lib/domain/validation.js';
import type { ListPort } from './list-port.js';
import { OptimisticQueue } from './optimistic-queue.js';
import type { Toasts } from './toasts.svelte.js';
import { m } from '#lib/paraglide/messages.js';

export class ListStore {
	readonly #source: () => SerializedList[];
	readonly #queue: OptimisticQueue;
	readonly #port: ListPort;
	#loaded = $derived.by(() => this.#source());
	#lists = $derived<SerializedList[]>(this.#loaded);

	constructor(source: () => SerializedList[], toasts: Toasts, port: ListPort) {
		this.#source = source;
		this.#port = port;
		this.#queue = new OptimisticQueue(toasts, () => port.reload());
	}

	/** The User's Lists in List order. */
	get all(): SerializedList[] {
		return sortLists(this.#lists);
	}

	get(id: string | null | undefined): SerializedList | undefined {
		return this.#lists.find((list) => list.id === id);
	}

	#replace(list: SerializedList): void {
		this.#lists = this.#lists.map((existing) => (existing.id === list.id ? list : existing));
	}

	/**
	 * Creates a List at the end. Resolves to its id once the server has it (so the caller can
	 * navigate to it), or `undefined` if that failed. Throws `InvalidInputError` for a bad name.
	 */
	async create(name: string): Promise<string | undefined> {
		const id = newId();
		const now = timestamp();
		const last = this.all.at(-1);
		this.#lists = [
			...this.#lists,
			{
				id,
				name: parseListName(name),
				position: generateKeyBetween(last?.position ?? null, null),
				sortMode: 'custom',
				visible: true,
				createdAt: now,
				updatedAt: now
			}
		];
		const ok = await this.#queue.send(
			'create the list',
			() => this.#port.createList({ id, name }),
			({ list }) => this.#replace(list)
		);
		return ok ? id : undefined;
	}

	/** Changes a List's name, Sort Mode or visibility. Throws `InvalidInputError` for a bad name. */
	async update(
		id: string,
		patch: { name?: string; sortMode?: SortMode; visible?: boolean }
	): Promise<boolean> {
		const current = this.get(id);
		if (!current) return false;
		const name = patch.name === undefined ? undefined : parseListName(patch.name);
		this.#replace({ ...current, ...patch, ...(name === undefined ? {} : { name }) });
		return this.#queue.send(
			m.toast_what_save_list(),
			() => this.#port.updateList(id, patch),
			({ list }) => this.#replace(list)
		);
	}

	/** Moves a List next to another one. Resolves to whether it worked. */
	async move(id: string, move: ListMove): Promise<boolean> {
		const current = this.get(id);
		if (!current) return false;
		this.#replace({ ...current, position: positionForMove(this.#lists, id, move) });
		return this.#queue.send(
			m.toast_what_move_list(),
			() => this.#port.updateList(id, move),
			({ list }) => this.#replace(list)
		);
	}

	/** Deletes a List (and its Tasks). Resolves once the server has deleted it. */
	async remove(id: string): Promise<boolean> {
		this.#lists = this.#lists.filter((list) => list.id !== id);
		return this.#queue.send(
			m.toast_what_delete_list(),
			() => this.#port.deleteList(id),
			() => {}
		);
	}
}

const KEY = Symbol('list-store');

export function setListStore(store: ListStore): ListStore {
	return setContext(KEY, store);
}

export function getListStore(): ListStore {
	return getContext<ListStore>(KEY);
}
