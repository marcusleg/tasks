/**
 * Custom `depends()` keys of the `load` functions, for `invalidate()` after a failed optimistic
 * update (see `#lib/client/tasks.svelte.ts`) or to pick up changes made on another device (see
 * `#lib/client/page-refresh.ts`, which reloads every `app:` key).
 */

/** The root layout's Lists. */
export const LISTS_DEPENDENCY = 'app:lists';

/** A page's Tasks. */
export const TASKS_DEPENDENCY = 'app:tasks';

/** The settings page's Calendar Links. */
export const CALENDAR_LINKS_DEPENDENCY = 'app:calendar-links';
