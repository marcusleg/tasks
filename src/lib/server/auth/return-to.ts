const DEFAULT_RETURN_TO = '/';
const PLACEHOLDER_ORIGIN = 'http://return-to.invalid';

/**
 * Turns an untrusted `returnTo` value into a same-origin path, or `/`.
 *
 * Only root-relative paths are accepted. Anything that a browser could resolve
 * to another origin is rejected: absolute URLs, protocol-relative `//host`,
 * backslash tricks like `/\host`, and values with control characters (which
 * URL parsers strip, so `/\t/host` would become `//host`). Paths under `/auth/`
 * are rejected as well, so a login can't bounce back into the login flow.
 */
export function sanitizeReturnTo(value: string | null | undefined): string {
	if (!value || value.length > 2048) return DEFAULT_RETURN_TO;
	if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) {
		return DEFAULT_RETURN_TO;
	}
	// eslint-disable-next-line no-control-regex
	if (/[\u0000-\u001f\u007f\\]/.test(value)) return DEFAULT_RETURN_TO;

	let url: URL;
	try {
		url = new URL(value, PLACEHOLDER_ORIGIN);
	} catch {
		return DEFAULT_RETURN_TO;
	}
	if (url.origin !== PLACEHOLDER_ORIGIN) return DEFAULT_RETURN_TO;
	if (url.pathname === '/auth' || url.pathname.startsWith('/auth/')) return DEFAULT_RETURN_TO;

	return url.pathname + url.search + url.hash;
}

/** The login page URL that returns to `path` (a pathname plus search) afterwards. */
export function loginUrl(path: string): string {
	const returnTo = sanitizeReturnTo(path);
	return returnTo === DEFAULT_RETURN_TO
		? '/auth/login'
		: `/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
}
