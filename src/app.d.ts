// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		interface PageData {
			/** Set by the root layout load once login exists (#4). */
			user?: { name: string } | null;
		}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
