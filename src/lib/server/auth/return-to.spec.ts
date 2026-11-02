import { describe, expect, it } from 'vitest';
import { loginUrl, sanitizeReturnTo } from './return-to';

describe('sanitizeReturnTo', () => {
	it.each(['/', '/lists/123', '/lists/123?sort=due#task-4', '/a%20b'])('keeps %s', (path) => {
		expect(sanitizeReturnTo(path)).toBe(path);
	});

	it.each([
		null,
		'',
		'https://evil.example',
		'http:evil.example',
		'javascript:alert(1)',
		'//evil.example',
		'//evil.example/path',
		'/\\evil.example',
		'\\\\evil.example',
		'/\t/evil.example',
		'/\n/evil.example',
		'lists/123',
		'/auth/login',
		'/auth/callback?code=x',
		'/x/../auth/logout',
		'/' + 'a'.repeat(3000)
	])('replaces %j with /', (value) => {
		expect(sanitizeReturnTo(value)).toBe('/');
	});

	it('normalises dot segments', () => {
		expect(sanitizeReturnTo('/a/../b')).toBe('/b');
	});
});

describe('loginUrl', () => {
	it('encodes the return path', () => {
		expect(loginUrl('/lists/1?x=1&y=2')).toBe('/auth/login?returnTo=%2Flists%2F1%3Fx%3D1%26y%3D2');
	});

	it('leaves out the default', () => {
		expect(loginUrl('/')).toBe('/auth/login');
	});
});
