/**
 * How a server error code (`#lib/domain/error-codes`) becomes a message in the User's Language.
 * An answer without a code (a hand-made request's error) keeps the server's English text; a code
 * this browser doesn't know, e.g. from a newer server, gets a generic message, never the raw code.
 */
import type { ApiErrorCode } from '#lib/domain/error-codes.js';
import { m } from '#lib/paraglide/messages.js';

const MESSAGES: Record<ApiErrorCode, () => string> = {
	calendar_link_list_not_found: m.api_error_calendar_link_list_not_found,
	calendar_link_not_found: m.api_error_calendar_link_not_found,
	list_not_found: m.api_error_list_not_found,
	recurrence_needs_date: m.api_error_recurrence_needs_date,
	task_not_found: m.api_error_task_not_found,
	task_or_list_not_found: m.api_error_task_or_list_not_found,
	undo_list_gone: m.api_error_undo_list_gone,
	undo_state_changed: m.api_error_undo_state_changed,
	undo_unavailable: m.api_error_undo_unavailable
};

/** The message for an error answer's `code`, or `undefined` when it has none. */
export function apiErrorMessage(code: unknown): string | undefined {
	if (code === undefined || code === null) return undefined;
	const message = Object.hasOwn(MESSAGES, code as string)
		? MESSAGES[code as ApiErrorCode]
		: m.api_error_unknown;
	return message();
}
