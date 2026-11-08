/** Calendar Links as shared by server and browser (CONTEXT.md → Calendar Link). */
import { m } from '#lib/paraglide/messages.js';
import { requiredText } from './validation';

export const MAX_CALENDAR_LINK_NAME_LENGTH = 100;

/** A valid Calendar Link name: trimmed, non-empty. Throws `InvalidInputError`. */
export function parseCalendarLinkName(value: unknown): string {
	return requiredText(value, 'Calendar Link name', MAX_CALENDAR_LINK_NAME_LENGTH);
}

/** JSON shape of a Calendar Link, as the settings page and its API use it. */
export interface SerializedCalendarLink {
	id: string;
	name: string;
	/** Covers every List, including ones created later. */
	allLists: boolean;
	/** The covered Lists when `allLists` is false; empty otherwise. */
	listIds: string[];
	/** The full, secret `.ics` URL. */
	url: string;
	createdAt: string;
	lastAccessedAt: string | null;
}

/** "never", or how long ago in the given date locale, e.g. "5 minutes ago". */
export function formatLastAccessed(
	lastAccessedAt: string | null,
	dateLocale: string,
	now = new Date()
): string {
	if (lastAccessedAt === null) return m.settings_calendar_link_never_accessed();
	const seconds = Math.round((new Date(lastAccessedAt).getTime() - now.getTime()) / 1000);
	const units: [Intl.RelativeTimeFormatUnit, number][] = [
		['day', 86_400],
		['hour', 3600],
		['minute', 60]
	];
	const format = new Intl.RelativeTimeFormat(dateLocale, { numeric: 'auto' });
	for (const [unit, size] of units) {
		if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
	}
	return m.settings_calendar_link_accessed_just_now();
}
