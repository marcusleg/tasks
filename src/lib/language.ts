import { baseLocale, isLocale, locales, type Locale } from '#lib/paraglide/runtime.js';

/**
 * A Language the app speaks (CONTEXT.md → Language). One per message file in `messages/`;
 * Paraglide calls it a locale.
 */
export type Language = Locale;

export const LANGUAGES: readonly Language[] = locales;

/** English: the source language, and what everyone gets whose browser asks for nothing we speak. */
export const BASE_LANGUAGE: Language = baseLocale;

export function isLanguage(value: unknown): value is Language {
	return isLocale(value);
}

/** What a User can choose (#74): follow the browser, or always one Language. */
export type LanguagePreference = 'automatic' | Language;

export function isLanguagePreference(value: unknown): value is LanguagePreference {
	return value === 'automatic' || isLanguage(value);
}
