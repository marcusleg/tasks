import { m } from '#lib/paraglide/messages.js';

/** Why signing in didn't work, as `?error=` from the callback; the page words it. */
const CALLBACK_ERRORS = ['expired', 'failed', 'denied', 'provider'] as const;

/** A callback error, or `unreachable` when the login action couldn't reach the provider. */
export type LoginError = (typeof CALLBACK_ERRORS)[number] | 'unreachable';

/** The `?error=` value as a `LoginError`; anything unknown counts as `failed`. */
export function parseLoginError(value: string | null): LoginError | null {
	if (value === null) return null;
	return CALLBACK_ERRORS.find((error) => error === value) ?? 'failed';
}

const MESSAGES: Record<LoginError, () => string> = {
	expired: m.auth_login_error_expired,
	failed: m.auth_login_error_failed,
	denied: m.auth_login_error_denied,
	provider: m.auth_login_error_provider,
	unreachable: m.auth_login_error_unreachable
};

/** What the login page says about `error`, in the current Language. */
export function loginErrorMessage(error: LoginError): string {
	return MESSAGES[error]();
}
