/**
 * Splits plain text into text and link segments, so a Description can show its URLs as links
 * without ever being interpreted as HTML: components render each segment as a text node or an
 * `<a href>` with the URL as an attribute value, never through `{@html}`.
 */

export type Segment = { kind: 'text'; text: string } | { kind: 'link'; text: string; href: string };

/**
 * `http(s)://…` or `www.…` up to the next whitespace or angle bracket/quote. Trailing punctuation
 * is trimmed afterwards ({@link trimTrailing}).
 */
const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;

const TRAILING_PUNCTUATION = /[.,:;!?]$/;
const PAIRS: Record<string, string> = { ')': '(', ']': '[', '}': '{' };

/** Drops sentence punctuation and unbalanced closing brackets from the end of a URL match. */
function trimTrailing(url: string): string {
	let result = url;
	for (;;) {
		const last = result.at(-1) ?? '';
		if (TRAILING_PUNCTUATION.test(last)) {
			result = result.slice(0, -1);
		} else if (last in PAIRS) {
			const open = result.split(PAIRS[last]).length - 1;
			const close = result.split(last).length - 1;
			if (close <= open) return result;
			result = result.slice(0, -1);
		} else {
			return result;
		}
	}
}

/** The href for a matched URL, or `null` if it doesn't parse as an http(s) URL. */
function toHref(match: string): string | null {
	const candidate = /^www\./i.test(match) ? `https://${match}` : match;
	try {
		const url = new URL(candidate);
		return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
	} catch {
		return null;
	}
}

export function linkify(text: string): Segment[] {
	const segments: Segment[] = [];
	let textStart = 0;

	const pushText = (end: number) => {
		if (end > textStart) segments.push({ kind: 'text', text: text.slice(textStart, end) });
	};

	for (const match of text.matchAll(URL_PATTERN)) {
		const url = trimTrailing(match[0]);
		const href = url && toHref(url);
		if (!href) continue;
		pushText(match.index);
		segments.push({ kind: 'link', text: url, href });
		textStart = match.index + url.length;
	}
	pushText(text.length);
	return segments;
}
