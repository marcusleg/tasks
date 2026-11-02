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
		}
		interface PageData {
			/** Set by the root layout load; `null` on public pages such as login. */
			user?: { id: string; name: string; email: string | null } | null;
		}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
