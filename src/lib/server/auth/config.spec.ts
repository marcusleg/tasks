import { describe, expect, it } from 'vitest';
import { parseAuthConfig } from './config';

const complete = {
	ORIGIN: 'https://tasks.example.com',
	OIDC_ISSUER: 'https://id.example.com',
	OIDC_CLIENT_ID: 'tasks',
	OIDC_CLIENT_SECRET: 'secret'
};

describe('parseAuthConfig', () => {
	it('names every missing required variable', () => {
		expect(() => parseAuthConfig({ OIDC_ISSUER: 'https://id.example.com' })).toThrow(
			/Missing required environment variables: ORIGIN, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET\./
		);
	});

	it('derives the redirect URI and Secure cookies from an https ORIGIN', () => {
		const config = parseAuthConfig(complete);

		expect(config.redirectUri).toBe('https://tasks.example.com/auth/callback');
		expect(config.secureCookies).toBe(true);
		expect(config.allowedGroup).toBeUndefined();
	});

	it('does not set Secure for a plain http ORIGIN', () => {
		expect(parseAuthConfig({ ...complete, ORIGIN: 'http://localhost:5173' }).secureCookies).toBe(
			false
		);
	});

	it('keeps the optional group restriction', () => {
		expect(parseAuthConfig({ ...complete, OIDC_ALLOWED_GROUP: 'tasks' }).allowedGroup).toBe(
			'tasks'
		);
	});
});
