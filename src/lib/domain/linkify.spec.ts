import { describe, expect, it } from 'vitest';
import { linkify } from './linkify';

const link = (text: string, href = text) => ({ kind: 'link', text, href });
const text = (value: string) => ({ kind: 'text', text: value });

describe('linkify', () => {
	it('keeps text without URLs as one text segment', () => {
		expect(linkify('Buy milk\nand eggs')).toEqual([text('Buy milk\nand eggs')]);
	});

	it('returns nothing for empty text', () => {
		expect(linkify('')).toEqual([]);
	});

	it('links http and https URLs in the middle of text', () => {
		expect(linkify('See https://example.com/a?b=1#c and http://x.org now')).toEqual([
			text('See '),
			link('https://example.com/a?b=1#c'),
			text(' and '),
			link('http://x.org', 'http://x.org/'),
			text(' now')
		]);
	});

	it('links www. addresses with https', () => {
		expect(linkify('www.example.com')).toEqual([
			link('www.example.com', 'https://www.example.com/')
		]);
	});

	it('leaves trailing punctuation out of the link', () => {
		expect(linkify('Go to https://example.com/page.')).toEqual([
			text('Go to '),
			link('https://example.com/page'),
			text('.')
		]);
		expect(linkify('(see https://example.com/a)!')).toEqual([
			text('(see '),
			link('https://example.com/a'),
			text(')!')
		]);
	});

	it('keeps balanced brackets that belong to the URL', () => {
		expect(linkify('https://en.wikipedia.org/wiki/Foo_(bar)')).toEqual([
			link('https://en.wikipedia.org/wiki/Foo_(bar)')
		]);
	});

	it('never links other schemes', () => {
		expect(linkify('javascript:alert(1) data:text/html,<b>x</b> ftp://x.org')).toEqual([
			text('javascript:alert(1) data:text/html,<b>x</b> ftp://x.org')
		]);
	});

	it('stops URLs at angle brackets and quotes, so markup stays text', () => {
		expect(linkify('<a href="https://evil.example">x</a>')).toEqual([
			text('<a href="'),
			link('https://evil.example', 'https://evil.example/'),
			text('">x</a>')
		]);
		expect(linkify('<https://example.com>')).toEqual([
			text('<'),
			link('https://example.com', 'https://example.com/'),
			text('>')
		]);
	});

	it('handles several URLs on several lines', () => {
		const segments = linkify('a https://a.example\nb https://b.example');

		expect(segments.filter((s) => s.kind === 'link').map((s) => s.text)).toEqual([
			'https://a.example',
			'https://b.example'
		]);
		expect(segments.map((s) => s.text).join('')).toBe('a https://a.example\nb https://b.example');
	});
});
