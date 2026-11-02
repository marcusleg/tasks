/**
 * Which parents have their Subtasks collapsed in the List, remembered per browser in
 * `localStorage`. Nothing is collapsed during server rendering; call {@link load} once mounted.
 */
import { SvelteSet } from 'svelte/reactivity';

const KEY = 'tasks:collapsed-subtasks';
/** Keeps the stored list from growing forever with ids of deleted Tasks. */
const MAX_REMEMBERED = 500;

function read(): string[] {
	try {
		const ids: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]');
		return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
	} catch {
		return [];
	}
}

export class CollapsedSubtasks {
	#ids = new SvelteSet<string>();

	/** Reads the stored state. Browser only. */
	load(): void {
		for (const id of read()) this.#ids.add(id);
	}

	has(parentId: string): boolean {
		return this.#ids.has(parentId);
	}

	toggle(parentId: string): void {
		const collapse = !this.#ids.has(parentId);
		if (collapse) this.#ids.add(parentId);
		else this.#ids.delete(parentId);
		// Re-read before writing, so other columns or tabs don't lose their changes.
		const stored = read().filter((id) => id !== parentId);
		if (collapse) stored.push(parentId);
		try {
			localStorage.setItem(KEY, JSON.stringify(stored.slice(-MAX_REMEMBERED)));
		} catch {
			// Storage full or unavailable: the state just isn't remembered.
		}
	}
}
