// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			/** The signed-in User, set by the `handle` hook. `null` only on public routes. */
			user: import('#lib/server/db/schema.js').User | null;
			/** The current session, set by the `handle` hook. `null` only on public routes. */
			session: import('#lib/server/db/schema.js').Session | null;
			/**
			 * The signed-in User's chosen Language, read together with the session; `'automatic'` when
			 * nobody is signed in or they never chose one. Input to the language `handle` hook.
			 */
			languagePreference: import('#lib/language.js').LanguagePreference;
			/** The Language this request is rendered in, set by the language `handle` hook. */
			language: import('#lib/language.js').Language;
			/** The locale to write dates and times with (`de-AT`, `en`), set with `language`. */
			dateLocale: string;
		}
		interface PageData {
			/** Set by the root layout load; `null` on public pages such as login. */
			user?: { id: string; name: string; email: string | null } | null;
			/** Set by the root layout load on every page: see `App.Locals`. */
			language: import('#lib/language.js').Language;
			/** Set by the root layout load on every page: see `App.Locals`. */
			dateLocale: string;
		}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
