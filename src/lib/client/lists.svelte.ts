/**
 * The browser's copy of the User's Lists (sidebar, List headers), with optimistic mutations like
 * {@link TaskStore}. Created by the root layout from its `load` data and shared through context.
 */
import { getContext, setContext } from 'svelte';
import { invalidate } from '$app/navigation';
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
import { LISTS_DEPENDENCY } from '#lib/dependencies.js';
import { api } from './api.js';
import type { Toasts } from './toasts.svelte.js';

export class ListStore {
	readonly #source: () => SerializedList[];
	readonly #toasts: Toasts;
	#loaded = $derived.by(() => this.#source());
	#lists = $derived<SerializedList[]>(this.#loaded);

	constructor(source: () => SerializedList[], toasts: Toasts) {
		this.#source = source;
		this.#toasts = toasts;
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

	async #fail(what: string, cause: unknown): Promise<void> {
		this.#toasts.failed(what, cause);
		await invalidate(LISTS_DEPENDENCY);
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
		try {
			const { list } = await api.createList({ id, name });
			this.#replace(list);
			return id;
		} catch (cause) {
			await this.#fail('create the list', cause);
			return undefined;
		}
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
		try {
			this.#replace((await api.updateList(id, patch)).list);
			return true;
		} catch (cause) {
			await this.#fail('save the list', cause);
			return false;
		}
	}

	/** Moves a List next to another one. Resolves to whether it worked. */
	async move(id: string, move: ListMove): Promise<boolean> {
		const current = this.get(id);
		if (!current) return false;
		this.#replace({ ...current, position: positionForMove(this.#lists, id, move) });
		try {
			this.#replace((await api.updateList(id, move)).list);
			return true;
		} catch (cause) {
			await this.#fail('move the list', cause);
			return false;
		}
	}

	/** Deletes a List (and its Tasks). Resolves once the server has deleted it. */
	async remove(id: string): Promise<boolean> {
		this.#lists = this.#lists.filter((list) => list.id !== id);
		try {
			await api.deleteList(id);
			return true;
		} catch (cause) {
			await this.#fail('delete the list', cause);
			return false;
		}
	}
}

const KEY = Symbol('list-store');

export function setListStore(store: ListStore): ListStore {
	return setContext(KEY, store);
}

export function getListStore(): ListStore {
	return getContext<ListStore>(KEY);
}
