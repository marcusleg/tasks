import { isHttpError } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { serializeDueDate, serializePlannedDate } from '#lib/domain/dates.js';
import { serializeRecurrence } from '#lib/domain/recurrence.js';
import { readDatesAndPriority, readRecurrence, readTimeZone } from './task-input';

/** The status and message of the HTTP error `run` throws. */
function httpError(run: () => unknown): { status: number; message: string } {
	try {
		run();
	} catch (cause) {
		if (isHttpError(cause)) return { status: cause.status, message: cause.body.message };
		throw cause;
	}
	throw new Error('Expected an HTTP error');
}

describe('readDatesAndPriority', () => {
	it('leaves out fields the body doesn’t mention', () => {
		expect(readDatesAndPriority({ title: 'Milk' })).toEqual({});
	});

	it('reads null as unset', () => {
		const fields = readDatesAndPriority({ planned: null, due: null, priority: null });

		expect(fields).toEqual({ planned: { kind: 'unset' }, due: { kind: 'unset' }, priority: null });
	});

	it('reads all three shapes of each date unchanged, including the zone', () => {
		const planned = {
			kind: 'timed',
			dateTime: '2026-11-04T09:00',
			timeZone: 'Europe/Berlin',
			durationMinutes: 45
		};
		const due = { kind: 'timed', dateTime: '2026-11-06T17:30', timeZone: 'America/New_York' };

		const timed = readDatesAndPriority({ planned, due });
		const dateOnly = readDatesAndPriority({
			planned: { kind: 'date', date: '2026-11-04' },
			due: { kind: 'date', date: '2026-11-06' }
		});

		expect(serializePlannedDate(timed.planned!)).toEqual(planned);
		expect(serializeDueDate(timed.due!)).toEqual(due);
		expect(serializePlannedDate(dateOnly.planned!)).toEqual({ kind: 'date', date: '2026-11-04' });
		expect(serializeDueDate(dateOnly.due!)).toEqual({ kind: 'date', date: '2026-11-06' });
	});

	it.each([
		['an unknown zone', { kind: 'timed', dateTime: '2026-11-04T09:00', timeZone: 'Mars/Olympus' }],
		[
			'an offset instead of a zone',
			{ kind: 'timed', dateTime: '2026-11-04T09:00', timeZone: '+01:00' }
		],
		['a missing zone', { kind: 'timed', dateTime: '2026-11-04T09:00' }],
		[
			'a Duration',
			{ kind: 'timed', dateTime: '2026-11-04T09:00', timeZone: 'UTC', durationMinutes: 30 }
		],
		['an impossible date', { kind: 'date', date: '2026-02-30' }],
		['seconds', { kind: 'timed', dateTime: '2026-11-04T09:00:00', timeZone: 'UTC' }],
		['an unknown kind', { kind: 'week', date: '2026-11-04' }],
		['a bare string', '2026-11-04']
	])('answers 400 for a Due Date with %s', (_, due) => {
		expect(httpError(() => readDatesAndPriority({ due }))).toMatchObject({
			status: 400,
			message: expect.stringMatching(/^due: /)
		});
	});

	it.each([
		['no Duration', { kind: 'timed', dateTime: '2026-11-04T09:00', timeZone: 'Europe/Berlin' }],
		[
			'a zero Duration',
			{ kind: 'timed', dateTime: '2026-11-04T09:00', timeZone: 'Europe/Berlin', durationMinutes: 0 }
		],
		[
			'an unknown zone',
			{ kind: 'timed', dateTime: '2026-11-04T09:00', timeZone: 'Berlin', durationMinutes: 30 }
		]
	])('answers 400 for a Planned Date with %s', (_, planned) => {
		expect(httpError(() => readDatesAndPriority({ planned }))).toMatchObject({
			status: 400,
			message: expect.stringMatching(/^planned: /)
		});
	});

	it('reads a Priority', () => {
		expect(readDatesAndPriority({ priority: 'high' })).toEqual({ priority: 'high' });
		expect(readDatesAndPriority({ priority: 'low' })).toEqual({ priority: 'low' });
	});

	it.each(['urgent', 'High', 1, ''])('answers 400 for the Priority %j', (priority) => {
		expect(httpError(() => readDatesAndPriority({ priority }))).toMatchObject({ status: 400 });
	});
});

describe('readRecurrence', () => {
	const rule = {
		frequency: 'monthly',
		interval: 2,
		monthDay: 31,
		end: { kind: 'until', date: '2027-06-30' },
		anchor: 'completion'
	};

	it('reads a serialized Recurrence, null, or nothing', () => {
		expect(serializeRecurrence(readRecurrence({ recurrence: rule })!)).toEqual(rule);
		expect(readRecurrence({ recurrence: null })).toBeNull();
		expect(readRecurrence({ title: 'Milk' })).toBeUndefined();
	});

	it.each([
		['an unknown frequency', { ...rule, frequency: 'hourly' }],
		['a zero interval', { ...rule, interval: 0 }],
		['weekdays on a monthly rule', { ...rule, weekdays: [1] }],
		['a bad end', { ...rule, end: { kind: 'count', count: 0 } }],
		['a string', 'weekly']
	])('answers 400 for %s', (_, recurrence) => {
		expect(httpError(() => readRecurrence({ recurrence }))).toMatchObject({
			status: 400,
			message: expect.stringMatching(/^recurrence: /)
		});
	});
});

describe('readTimeZone', () => {
	it('reads an IANA zone, or nothing', () => {
		expect(readTimeZone({ timeZone: 'Europe/Berlin' })).toBe('Europe/Berlin');
		expect(readTimeZone({})).toBeUndefined();
	});

	it.each(['Mars/Olympus', '+01:00', 42])('answers 400 for %j', (timeZone) => {
		expect(httpError(() => readTimeZone({ timeZone }))).toMatchObject({ status: 400 });
	});
});
