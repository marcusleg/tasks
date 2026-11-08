import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestEvent } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { overwriteServerAsyncLocalStorage } from '#lib/paraglide/runtime.js';
import {
	BASE_LANGUAGE,
	isLanguage,
	type Language,
	type LanguagePreference
} from '#lib/language.js';

/** The Language a request is rendered in, and the locale its dates and times are written with. */
export interface ResolvedLanguage {
	language: Language;
	/**
	 * A BCP 47 tag for `Intl` date and time formatting. Under Automatic, the browser's own tag for
	 * that Language (`de-AT`, `en-GB`), so regional formats survive; for a chosen Language, the bare
	 * Language (`de`, `en`).
	 */
	dateLocale: string;
}

/**
 * Resolves the Language for a request: the User's chosen Language if they chose one, otherwise
 * the first Language we speak in the browser's `Accept-Language`, by preference (so German when
 * German is preferred over English), otherwise English.
 */
export function resolveLanguage(
	acceptLanguage: string | null,
	preference: LanguagePreference = 'automatic'
): ResolvedLanguage {
	if (preference !== 'automatic') return { language: preference, dateLocale: preference };

	for (const tag of preferredLocales(acceptLanguage)) {
		const language = tag.split('-')[0].toLowerCase();
		if (isLanguage(language)) return { language, dateLocale: tag };
	}
	return { language: BASE_LANGUAGE, dateLocale: BASE_LANGUAGE };
}

/**
 * The tags of an `Accept-Language` header, most preferred first and canonicalized (`de-AT`).
 * Skips what the client refused (`q=0`), wildcards, invalid weights and invalid tags.
 */
function preferredLocales(header: string | null): string[] {
	const ranges: { tag: string; q: number }[] = [];
	for (const part of (header ?? '').split(',')) {
		const [range, ...params] = part.split(';').map((s) => s.trim());
		if (!range || range === '*') continue;

		let q = 1;
		const weight = params.find((p) => /^q\s*=/i.test(p));
		if (weight) {
			const value = weight.replace(/^q\s*=\s*/i, '');
			if (!/^(0(\.\d{0,3})?|1(\.0{0,3})?)$/.test(value)) continue;
			q = Number(value);
		}
		if (q === 0) continue;

		try {
			ranges.push({ tag: Intl.getCanonicalLocales(range)[0], q });
		} catch {
			// Not a language tag.
		}
	}
	// Array.prototype.sort is stable: equal weights keep the header's order.
	return ranges.sort((a, b) => b.q - a.q).map((r) => r.tag);
}

// Paraglide's message functions and `getLocale()` read the Language from this store on the server.
const store = new AsyncLocalStorage<{ locale?: Language }>();
overwriteServerAsyncLocalStorage(store);

/**
 * Runs `fn` with messages (`m.*()`) and `getLocale()` in `language`, also outside a request
 * (e.g. a Calendar Link speaking its owner's Language). Every request already runs this way in
 * its own Language, see `createLanguageHandle`.
 */
export function withLanguage<T>(language: Language, fn: () => T): T {
	return store.run({ locale: language }, fn);
}

/**
 * Calendar Links (`/cal/…`) are fetched by a calendar app, whose `Accept-Language` says nothing
 * about the owner (ADR 0005). They are English unless the feed passes its owner's Language itself.
 */
function isCalendarFeed(pathname: string): boolean {
	return pathname === '/cal' || pathname.startsWith('/cal/');
}

/**
 * The `handle` hook that gives each request its Language: sets `locals.language` and
 * `locals.dateLocale`, renders the page in it, and fills in `<html lang="%lang%">`.
 *
 * `preference` is the User's stored choice. It runs after the auth hook, so `locals.user` is set
 * when someone is signed in. Calendar Links skip all of this and get English.
 */
export function createLanguageHandle(deps: {
	preference: (event: RequestEvent) => LanguagePreference | Promise<LanguagePreference>;
}): Handle {
	return async ({ event, resolve }) => {
		const { language, dateLocale }: ResolvedLanguage = isCalendarFeed(event.url.pathname)
			? { language: BASE_LANGUAGE, dateLocale: BASE_LANGUAGE }
			: resolveLanguage(event.request.headers.get('accept-language'), await deps.preference(event));
		event.locals.language = language;
		event.locals.dateLocale = dateLocale;

		return withLanguage(language, () =>
			resolve(event, {
				// Only the placeholder in app.html: page content is escaped and can't contain this.
				transformPageChunk: ({ html }) =>
					html.replace('<html lang="%lang%"', `<html lang="${language}"`)
			})
		);
	};
}
