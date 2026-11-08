/**
 * Stable codes for the few errors a User can run into through the normal UI. The server sends one
 * next to its English `message` (`{ message, code }`, SvelteKit's `error(status, { message, code })`)
 * and the browser shows its own translation (`#lib/client/api-errors`). Everything else, such as a
 * wrong content type or a field of the wrong type, can only come from a hand-made request and
 * stays English with no code.
 */
export const API_ERROR_CODES = [
	// Someone, probably another tab, deleted it meanwhile.
	'calendar_link_not_found',
	'list_not_found',
	'task_not_found',
	'task_or_list_not_found',
	// A Calendar Link names a List that is gone.
	'calendar_link_list_not_found',
	// Clearing the last date of a recurring Task.
	'recurrence_needs_date',
	// Undo (ADR 0004): nothing to undo any more, the List is gone, or the state has moved on.
	'undo_list_gone',
	'undo_state_changed',
	'undo_unavailable'
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export function isApiErrorCode(value: unknown): value is ApiErrorCode {
	return API_ERROR_CODES.includes(value as ApiErrorCode);
}
