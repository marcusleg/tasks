import { describe, expect, it } from 'vitest';
import {
	LOGIN_FLOW_TTL_SECONDS,
	sealLoginFlow,
	unsealLoginFlow,
	type LoginFlow
} from './login-flow';

const flow: LoginFlow = {
	state: 'state-123',
	nonce: 'nonce-456',
	codeVerifier: 'verifier-789',
	returnTo: '/lists/1'
};

describe('login flow cookie', () => {
	it('round-trips', () => {
		expect(unsealLoginFlow(sealLoginFlow(flow, 'secret'), 'secret')).toEqual(flow);
	});

	it('is encrypted, not just encoded', () => {
		const sealed = sealLoginFlow(flow, 'secret');

		expect(Buffer.from(sealed, 'base64url').toString('latin1')).not.toContain('verifier-789');
	});

	it('rejects a value sealed with another secret', () => {
		expect(unsealLoginFlow(sealLoginFlow(flow, 'secret'), 'other')).toBeNull();
	});

	it('rejects tampered values', () => {
		const data = Buffer.from(sealLoginFlow(flow, 'secret'), 'base64url');
		data[data.length - 1] ^= 1;

		expect(unsealLoginFlow(data.toString('base64url'), 'secret')).toBeNull();
		expect(unsealLoginFlow('garbage', 'secret')).toBeNull();
		expect(unsealLoginFlow('', 'secret')).toBeNull();
	});

	it('expires', () => {
		const sealedAt = 1_000_000;
		const sealed = sealLoginFlow(flow, 'secret', sealedAt);

		expect(unsealLoginFlow(sealed, 'secret', sealedAt + LOGIN_FLOW_TTL_SECONDS * 1000 - 1)).toEqual(
			flow
		);
		expect(unsealLoginFlow(sealed, 'secret', sealedAt + LOGIN_FLOW_TTL_SECONDS * 1000)).toBeNull();
	});
});
