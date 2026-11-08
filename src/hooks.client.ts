import { overwriteGetLocale } from '#lib/paraglide/runtime.js';
import { BASE_LANGUAGE, isLanguage } from '#lib/language.js';

// The server rendered this document in the request's Language and wrote it to <html lang>
// (src/lib/server/language.ts). Messages in the browser use the same one, so hydration matches
// the server-rendered HTML. It changes only with a new document, i.e. a full page load.
const lang = document.documentElement.lang;
const language = isLanguage(lang) ? lang : BASE_LANGUAGE;
overwriteGetLocale(() => language);
