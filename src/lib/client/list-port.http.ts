/** The production {@link ListPort}: the JSON endpoints, and SvelteKit's `invalidate` to reload. */
import { invalidate } from '$app/navigation';
import { LISTS_DEPENDENCY } from '#lib/dependencies.js';
import { api } from './api.js';
import type { ListPort } from './list-port.js';

export const httpListPort: ListPort = {
	createList: (input) => api.createList(input),
	updateList: (id, patch) => api.updateList(id, patch),
	deleteList: (id) => api.deleteList(id),
	reload: () => invalidate(LISTS_DEPENDENCY)
};
