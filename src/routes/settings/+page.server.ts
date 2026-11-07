import { CALENDAR_LINKS_DEPENDENCY } from '#lib/dependencies.js';
import { getAuthConfig } from '#lib/server/auth/config.js';
import { getCalendarLinks, serializeCalendarLink } from '#lib/server/calendar-links.js';
import { userScope } from '#lib/server/scope.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals, depends }) => {
	depends(CALENDAR_LINKS_DEPENDENCY);
	const { origin } = getAuthConfig();
	return {
		calendarLinks: getCalendarLinks(userScope(locals)).map((link) =>
			serializeCalendarLink(link, origin)
		)
	};
};
