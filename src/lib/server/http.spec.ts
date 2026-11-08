import { describe, expect, it } from 'vitest';
import { InvalidInputError } from '#lib/domain/validation.js';
import { notFound, optionalString, withInputErrors } from './http';

/** What SvelteKit's `error()` throws: the status and the body the browser gets. */
function thrown(run: () => unknown): { status: number; body: { message: string; code?: string } } {
	try {
		run();
	} catch (cause) {
		return cause as never;
	}
	throw new Error('Expected an error');
}

describe('errors a User can run into', () => {
	it('carry their code next to the English message', () => {
		const failure = thrown(() => notFound('List', 'list_not_found'));
		expect(failure.status).toBe(404);
		expect(failure.body).toMatchObject({ message: 'List not found', code: 'list_not_found' });

		const invalid = thrown(() =>
			withInputErrors(() => {
				throw new InvalidInputError('A recurring Task needs a date', 'recurrence_needs_date');
			})
		);
		expect(invalid.status).toBe(400);
		expect(invalid.body).toMatchObject({
			message: 'A recurring Task needs a date',
			code: 'recurrence_needs_date'
		});
	});
});

describe('errors only a hand-made request causes', () => {
	it('have no code and keep their message', () => {
		const invalid = thrown(() =>
			withInputErrors(() => {
				throw new InvalidInputError('Title must be text');
			})
		);
		expect(invalid.body).toMatchObject({ message: 'Title must be text' });
		expect(invalid.body).not.toHaveProperty('code');

		const wrongType = thrown(() => optionalString({ name: 3 }, 'name'));
		expect(wrongType.status).toBe(400);
		expect(wrongType.body).toMatchObject({ message: 'name must be a string' });
	});
});
