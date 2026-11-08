import { afterEach, describe, expect, it } from 'vitest';
import { API_ERROR_CODES } from '#lib/domain/error-codes.js';
import { m } from '#lib/paraglide/messages.js';
import { overwriteGetLocale } from '#lib/paraglide/runtime.js';
import { apiErrorMessage } from './api-errors';

afterEach(() => overwriteGetLocale(() => 'en'));

describe('apiErrorMessage', () => {
	it('translates every known code, in both Languages', () => {
		for (const locale of ['en', 'de'] as const) {
			overwriteGetLocale(() => locale);
			const texts = API_ERROR_CODES.map((code) => apiErrorMessage(code));
			for (const text of texts) {
				expect(text).toBeTruthy();
				expect(text).not.toBe(m.api_error_unknown());
			}
			expect(new Set(texts).size).toBe(API_ERROR_CODES.length);
		}
	});

	it('speaks the Language of the moment', () => {
		overwriteGetLocale(() => 'de');
		expect(apiErrorMessage('undo_unavailable')).toBe('Das lässt sich nicht mehr rückgängig machen');
	});

	it('answers an unknown code with the generic message, never the code', () => {
		expect(apiErrorMessage('from_a_newer_server')).toBe('Something went wrong on the server');
		expect(apiErrorMessage('toString')).toBe('Something went wrong on the server');
		overwriteGetLocale(() => 'de');
		expect(apiErrorMessage('from_a_newer_server')).toBe('Auf dem Server ist etwas schiefgelaufen');
	});

	it('has nothing to say about an answer without a code', () => {
		expect(apiErrorMessage(undefined)).toBeUndefined();
		expect(apiErrorMessage(null)).toBeUndefined();
	});
});
