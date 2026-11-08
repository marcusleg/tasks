import { json } from '@sveltejs/kit';
import { readJson, requiredString, withInputErrors } from '#lib/server/http.js';
import { setLanguagePreference } from '#lib/server/language-preference.js';
import { userScope } from '#lib/server/scope.js';
import type { RequestHandler } from './$types';

/**
 * Chooses the User's Language: `{ languagePreference: 'automatic' | 'en' | 'de' }` →
 * `{ languagePreference }`. Takes effect from the next page load.
 */
export const PUT: RequestHandler = async ({ locals, request }) => {
	const scope = userScope(locals);
	const body = await readJson(request);
	const value = requiredString(body, 'languagePreference');
	return json({ languagePreference: withInputErrors(() => setLanguagePreference(scope, value)) });
};
