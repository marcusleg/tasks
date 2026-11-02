/**
 * Custom `depends()` keys of the `load` functions, for `invalidate()` after a failed optimistic
 * update (see `#lib/client/tasks.svelte.ts`).
 */

/** The root layout's Lists. */
export const LISTS_DEPENDENCY = 'app:lists';

/** A page's Tasks. */
export const TASKS_DEPENDENCY = 'app:tasks';
