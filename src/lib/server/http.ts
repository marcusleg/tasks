/**
 * Helpers for the JSON endpoints under `/api/` (see ADR 0003). Endpoints read a JSON body, call
 * the data-access layer with the User's scope, and answer with JSON. Errors are thrown with
 * SvelteKit's `error()`, so the browser gets `{ message }` with the status.
 */
import { error } from '@sveltejs/kit';
import { InvalidInputError } from '#lib/domain/validation.js';

export type JsonBody = Record<string, unknown>;

/**
 * The request's JSON object body. Requiring `application/json` also keeps cross-site form posts
 * out: browsers can't send that content type to another origin without a CORS preflight, which
 * this app never allows.
 */
export async function readJson(request: Request): Promise<JsonBody> {
	const type = request.headers.get('content-type') ?? '';
	if (!/^application\/json\b/i.test(type)) error(415, 'Expected an application/json body');
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		error(400, 'Malformed JSON');
	}
	if (typeof body !== 'object' || body === null || Array.isArray(body)) {
		error(400, 'Expected a JSON object');
	}
	return body as JsonBody;
}

/** A string field, or `undefined` when absent. 400 for any other type. */
export function optionalString(body: JsonBody, key: string): string | undefined {
	const value = body[key];
	if (value === undefined) return undefined;
	if (typeof value !== 'string') error(400, `${key} must be a string`);
	return value;
}

export function requiredString(body: JsonBody, key: string): string {
	const value = optionalString(body, key);
	if (value === undefined) error(400, `${key} is required`);
	return value;
}

export function optionalBoolean(body: JsonBody, key: string): boolean | undefined {
	const value = body[key];
	if (value === undefined) return undefined;
	if (typeof value !== 'boolean') error(400, `${key} must be true or false`);
	return value;
}

/** Turns domain validation failures and id clashes into 400 and 409 responses. */
export function withInputErrors<T>(run: () => T): T {
	try {
		return run();
	} catch (cause) {
		if (cause instanceof InvalidInputError) error(400, cause.message);
		if (isConstraintError(cause, 'SQLITE_CONSTRAINT_PRIMARYKEY')) error(409, 'Id already in use');
		throw cause;
	}
}

function isConstraintError(cause: unknown, code: string): boolean {
	return cause instanceof Error && (cause as Error & { code?: unknown }).code === code;
}

/** The 404 for anything the User doesn't own, whether it exists or not. */
export function notFound(what: string): never {
	error(404, `${what} not found`);
}
