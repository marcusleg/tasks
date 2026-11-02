import type { ServerMetadata } from 'openid-client';
import { describe, expect, it } from 'vitest';
import { chooseClientAuth, groupsFromClaim, identityFromClaims, isAllowedToSignIn } from './oidc';

describe('identityFromClaims', () => {
	it('takes name, email and groups from Pocket ID style claims', () => {
		const identity = identityFromClaims('https://id.example.com', 'sub-1', {
			name: 'Alice Example',
			email: 'alice@example.com',
			groups: ['tasks', 'media']
		});

		expect(identity).toEqual({
			issuer: 'https://id.example.com',
			subject: 'sub-1',
			name: 'Alice Example',
			email: 'alice@example.com',
			groups: ['tasks', 'media']
		});
	});

	it('falls back through other name claims, then email, then the subject', () => {
		const issuer = 'https://id.example.com';

		expect(identityFromClaims(issuer, 's', { preferred_username: 'alice' }).name).toBe('alice');
		expect(identityFromClaims(issuer, 's', { given_name: 'Alice', family_name: 'E' }).name).toBe(
			'Alice E'
		);
		expect(identityFromClaims(issuer, 's', { email: 'a@example.com' }).name).toBe('a@example.com');
		expect(identityFromClaims(issuer, 's', { name: '  ' }).name).toBe('s');
		expect(identityFromClaims(issuer, 's', {}).email).toBeNull();
	});
});

describe('groupsFromClaim', () => {
	it('accepts an array of names or a single name', () => {
		expect(groupsFromClaim(['a', 'b', 3])).toEqual(['a', 'b']);
		expect(groupsFromClaim('a')).toEqual(['a']);
		expect(groupsFromClaim(undefined)).toEqual([]);
	});
});

describe('isAllowedToSignIn', () => {
	it('lets everyone in when no group is required', () => {
		expect(isAllowedToSignIn([], undefined)).toBe(true);
	});

	it('requires an exact group match when a group is required', () => {
		expect(isAllowedToSignIn(['tasks'], 'tasks')).toBe(true);
		expect(isAllowedToSignIn(['media', 'Tasks', 'tasks-admins'], 'tasks')).toBe(false);
		expect(isAllowedToSignIn([], 'tasks')).toBe(false);
	});
});

describe('chooseClientAuth', () => {
	function authenticate(methods: string[] | undefined) {
		const body = new URLSearchParams();
		const headers = new Headers();
		const as = {
			issuer: 'https://id.example.com',
			token_endpoint_auth_methods_supported: methods
		} as ServerMetadata;
		chooseClientAuth('s3cret')(as, { client_id: 'tasks' }, body, headers);
		return { body, headers };
	}

	it('uses client_secret_basic when advertised (Pocket ID) or when nothing is advertised', () => {
		for (const methods of [['client_secret_basic', 'client_secret_post', 'none'], undefined]) {
			const { body, headers } = authenticate(methods);

			expect(headers.get('authorization')).toBe(
				`Basic ${Buffer.from('tasks:s3cret').toString('base64')}`
			);
			expect(body.has('client_secret')).toBe(false);
		}
	});

	it('falls back to client_secret_post', () => {
		const { body, headers } = authenticate(['client_secret_post']);

		expect(body.get('client_secret')).toBe('s3cret');
		expect(headers.has('authorization')).toBe(false);
	});

	it('refuses providers without a secret-based method', () => {
		expect(() => authenticate(['private_key_jwt'])).toThrow(/neither client_secret_basic/);
	});
});
