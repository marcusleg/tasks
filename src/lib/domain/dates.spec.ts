import { describe, expect, it } from 'vitest';
import {
	InvalidDateError,
	dateOnly,
	localDate,
	parseDueDate,
	parsePlannedDate,
	serializeDueDate,
	serializePlannedDate,
	timedDueDate,
	timedPlannedDate,
	toZonedDateTime
} from './dates';

describe('Planned Date serialization', () => {
	it('round-trips a date-only Planned Date', () => {
		const json = { kind: 'date', date: '2026-11-04' };

		const planned = parsePlannedDate(json);

		expect(planned.kind).toBe('date');
		expect(serializePlannedDate(planned)).toEqual(json);
	});

	it('round-trips a timed Planned Date with its zone and Duration', () => {
		const json = {
			kind: 'timed',
			dateTime: '2026-11-04T09:00',
			timeZone: 'Europe/Berlin',
			durationMinutes: 45
		};

		expect(serializePlannedDate(parsePlannedDate(json))).toEqual(json);
	});

	it('round-trips an unset Planned Date as null', () => {
		const planned = parsePlannedDate(null);

		expect(planned).toEqual({ kind: 'unset' });
		expect(serializePlannedDate(planned)).toBeNull();
	});

	const timed = {
		kind: 'timed',
		dateTime: '2026-11-04T09:00',
		timeZone: 'Europe/Berlin',
		durationMinutes: 30
	};

	it.each([
		['an impossible date', { kind: 'date', date: '2026-02-30' }],
		['a malformed date', { kind: 'date', date: '4.11.2026' }],
		['a date with a time', { kind: 'date', date: '2026-11-04T09:00' }],
		['an unknown kind', { kind: 'someday', date: '2026-11-04' }],
		['a non-object', '2026-11-04'],
		['undefined', undefined],
		['an impossible date-time', { ...timed, dateTime: '2026-11-04T25:00' }],
		['a date-time with seconds', { ...timed, dateTime: '2026-11-04T09:00:30' }],
		['a date-time with an offset', { ...timed, dateTime: '2026-11-04T09:00+01:00' }],
		['an unknown time zone', { ...timed, timeZone: 'Mars/Olympus_Mons' }],
		['an offset instead of a zone', { ...timed, timeZone: '+01:00' }],
		['a missing time zone', { ...timed, timeZone: undefined }],
		['a zero Duration', { ...timed, durationMinutes: 0 }],
		['a negative Duration', { ...timed, durationMinutes: -15 }],
		['a fractional Duration', { ...timed, durationMinutes: 7.5 }],
		['a missing Duration', { ...timed, durationMinutes: undefined }]
	])('rejects %s', (_, json) => {
		expect(() => parsePlannedDate(json)).toThrow(InvalidDateError);
	});

	it('normalizes the case of the time zone', () => {
		const planned = parsePlannedDate({ ...timed, timeZone: 'europe/berlin' });

		expect(serializePlannedDate(planned)).toEqual(timed);
	});
});

describe('Due Date serialization', () => {
	it.each([
		['unset', null],
		['date-only', { kind: 'date', date: '2026-11-04' }],
		['timed', { kind: 'timed', dateTime: '2026-11-04T17:30', timeZone: 'America/New_York' }]
	])('round-trips a %s Due Date', (_, json) => {
		expect(serializeDueDate(parseDueDate(json))).toEqual(json);
	});

	it('rejects a timed Due Date that carries a Duration', () => {
		const json = {
			kind: 'timed',
			dateTime: '2026-11-04T17:30',
			timeZone: 'America/New_York',
			durationMinutes: 30
		};

		expect(() => parseDueDate(json)).toThrow(InvalidDateError);
	});

	it.each([
		['an impossible date', { kind: 'date', date: '2025-02-29' }],
		['an unknown time zone', { kind: 'timed', dateTime: '2026-11-04T17:30', timeZone: 'Nowhere' }]
	])('rejects %s', (_, json) => {
		expect(() => parseDueDate(json)).toThrow(InvalidDateError);
	});
});

describe('constructing dates', () => {
	it('gives a timed Planned Date a 30-minute Duration by default', () => {
		const planned = timedPlannedDate('2026-11-04T09:00', 'Europe/Berlin');

		expect(serializePlannedDate(planned)).toEqual({
			kind: 'timed',
			dateTime: '2026-11-04T09:00',
			timeZone: 'Europe/Berlin',
			durationMinutes: 30
		});
	});

	it('builds date-only and timed Due Dates', () => {
		expect(serializeDueDate(dateOnly('2026-11-04'))).toEqual({ kind: 'date', date: '2026-11-04' });
		expect(serializeDueDate(timedDueDate('2026-11-04T17:00', 'UTC'))).toEqual({
			kind: 'timed',
			dateTime: '2026-11-04T17:00',
			timeZone: 'UTC'
		});
	});

	it('validates like parsing does', () => {
		expect(() => dateOnly('2026-02-29')).toThrow(InvalidDateError);
		expect(() => timedDueDate('2026-11-04T17:00', 'Atlantis')).toThrow(InvalidDateError);
		expect(() => timedPlannedDate('2026-11-04T09:00', 'UTC', 0)).toThrow(InvalidDateError);
	});
});

describe('local date and instant of a date', () => {
	it('is the calendar date itself for a date-only value', () => {
		expect(localDate(dateOnly('2026-11-04')).toString()).toBe('2026-11-04');
	});

	it('is the wall-clock date in its own zone for a timed value', () => {
		const lateEvening = timedDueDate('2026-11-04T23:30', 'America/New_York');

		expect(localDate(lateEvening).toString()).toBe('2026-11-04');
		expect(toZonedDateTime(lateEvening).toInstant().toString()).toBe('2026-11-05T04:30:00Z');
	});

	it('resolves a wall-clock time inside a DST gap forward', () => {
		const inTheGap = timedPlannedDate('2026-03-29T02:30', 'Europe/Berlin');

		expect(toZonedDateTime(inTheGap).toString()).toBe('2026-03-29T03:30:00+02:00[Europe/Berlin]');
	});

	it('resolves an ambiguous wall-clock time to the earlier instant', () => {
		const ambiguous = timedDueDate('2026-11-01T01:30', 'America/New_York');

		expect(toZonedDateTime(ambiguous).offset).toBe('-04:00');
	});
});
