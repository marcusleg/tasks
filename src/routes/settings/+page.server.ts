import { CALENDAR_LINKS_DEPENDENCY } from '#lib/dependencies.js';
import { getAuthConfig } from '#lib/server/auth/config.js';
import { getCalendarLinks, serializeCalendarLink } from '#lib/server/calendar-links.js';
import { userScope } from '#lib/server/scope.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, depends }) => {
	depends(CALENDAR_LINKS_DEPENDENCY);
	const { origin } = getAuthConfig();
	return {
		// Read with the session (see `validateSessionToken`), so no extra query.
		languagePreference: locals.languagePreference,
		calendarLinks: getCalendarLinks(userScope(locals)).map((link) =>
			serializeCalendarLink(link, origin)
		)
	};
};
