import { getAuthConfig } from '#lib/server/auth/config.js';
import { getCalendarLinks, serializeCalendarLink } from '#lib/server/calendar-links.js';
import { userScope } from '#lib/server/scope.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const { origin } = getAuthConfig();
	return {
		calendarLinks: getCalendarLinks(userScope(locals)).map((link) =>
			serializeCalendarLink(link, origin)
		)
	};
};
