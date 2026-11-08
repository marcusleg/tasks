import type { RequestEvent } from '@sveltejs/kit';
import type { Handle } from '@sveltejs/kit/hooks';
import { describe, expect, it } from 'vitest';
import { m } from '#lib/paraglide/messages.js';
import { getLocale } from '#lib/paraglide/runtime.js';
import type { LanguagePreference } from '#lib/language.js';
import { createLanguageHandle, resolveLanguage, withLanguage } from './language';

describe('resolveLanguage', () => {
	describe('Automatic', () => {
		it.each([
			['de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7', 'de', 'de-DE'],
			['de', 'de', 'de'],
			['de-AT', 'de', 'de-AT'],
			['en-US,en;q=0.9,de;q=0.8', 'en', 'en-US'],
			['en-GB', 'en', 'en-GB'],
			// German is preferred over English by its weight, not its position.
			['en;q=0.5, de-CH;q=0.8', 'de', 'de-CH'],
			// Languages we don't speak are skipped; the first one we do decides.
			['fr-FR,fr;q=0.9,de;q=0.8,en;q=0.7', 'de', 'de'],
			['fr-FR,fr;q=0.9,en-GB;q=0.8,de;q=0.7', 'en', 'en-GB'],
			// Case and whitespace don't matter; tags are canonicalized.
			[' DE-at ; Q=0.9 ', 'de', 'de-AT']
		])('%s → %s, dates as %s', (header, language, dateLocale) => {
			expect(resolveLanguage(header)).toEqual({ language, dateLocale });
		});

		it.each([
			['nothing', null],
			['an empty header', ''],
			['only unsupported languages', 'fr-FR,fr;q=0.9,es;q=0.8'],
			['a wildcard', '*'],
			['German refused with q=0', 'de;q=0,fr'],
			['an invalid weight on German', 'de;q=abc'],
			['a malformed tag', 'de_DE!!'],
			['garbage', ';;;,,,q=1']
		])('is English for %s', (_, header) => {
			expect(resolveLanguage(header)).toEqual({ language: 'en', dateLocale: 'en' });
		});
	});

	describe('a chosen Language', () => {
		it.each<[LanguagePreference, string]>([
			['de', 'en-US,en;q=0.9'],
			['de', 'de-AT'],
			['en', 'de-AT,de;q=0.9'],
			['en', 'en-GB']
		])('%s wins over Accept-Language %s, and dates use the bare Language', (choice, header) => {
			expect(resolveLanguage(header, choice)).toEqual({ language: choice, dateLocale: choice });
		});

		it('is "automatic" by default', () => {
			expect(resolveLanguage('de-AT', 'automatic')).toEqual(resolveLanguage('de-AT'));
		});
	});
});

describe('withLanguage', () => {
	it('renders messages in that Language, outside any request too', () => {
		expect(m.shell_sign_out()).toBe('Sign out');
		expect(withLanguage('de', () => m.shell_sign_out())).toBe('Abmelden');
		expect(withLanguage('de', () => getLocale())).toBe('de');
		expect(getLocale()).toBe('en');
	});

	it('is overridden by an explicit locale on the message', () => {
		expect(withLanguage('de', () => m.shell_sign_out({}, { locale: 'en' }))).toBe('Sign out');
	});
});

describe('language handle', () => {
	async function request(
		headers: Record<string, string>,
		preference: () => LanguagePreference | Promise<LanguagePreference> = () => 'automatic'
	) {
		const event = {
			request: new Request('http://localhost/', { headers }),
			locals: {} as App.Locals
		} as RequestEvent;
		let rendered: { locale: string; message: string; html?: string } | undefined;
		const resolve: Parameters<Handle>[0]['resolve'] = async (_, options) => {
			// Stands in for SvelteKit rendering the page.
			await Promise.resolve();
			rendered = {
				locale: getLocale(),
				message: m.shell_sign_out(),
				html: await options?.transformPageChunk?.({
					html: '<html lang="%lang%"><body>',
					done: true
				})
			};
			return new Response('page');
		};
		const handle = createLanguageHandle({ preference });
		await handle({ event, resolve });
		return { locals: event.locals, rendered: rendered! };
	}

	it('renders a German-preferring browser in German, with <html lang="de">', async () => {
		const { locals, rendered } = await request({ 'accept-language': 'de-AT,de;q=0.9,en;q=0.5' });

		expect(locals.language).toBe('de');
		expect(locals.dateLocale).toBe('de-AT');
		expect(rendered).toEqual({
			locale: 'de',
			message: 'Abmelden',
			html: '<html lang="de"><body>'
		});
	});

	it('renders everyone else in English, with <html lang="en">', async () => {
		const { locals, rendered } = await request({ 'accept-language': 'fr-FR' });

		expect(locals.language).toBe('en');
		expect(rendered).toEqual({
			locale: 'en',
			message: 'Sign out',
			html: '<html lang="en"><body>'
		});
	});

	it('lets a stored choice override Accept-Language', async () => {
		const { locals, rendered } = await request(
			{ 'accept-language': 'en-US' },
			async () => 'de' as const
		);

		expect(locals).toMatchObject({ language: 'de', dateLocale: 'de' });
		expect(rendered.message).toBe('Abmelden');
	});

	it('keeps concurrent requests apart', async () => {
		const [de, en] = await Promise.all([
			request({ 'accept-language': 'de' }),
			request({ 'accept-language': 'en' })
		]);

		expect(de.rendered.message).toBe('Abmelden');
		expect(en.rendered.message).toBe('Sign out');
	});
});
