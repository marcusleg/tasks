/**
 * VTIMEZONE components (RFC 5545 §3.6.5) generated from the time zone database via Temporal, so
 * that calendars without their own copy of an IANA zone still resolve TZID times correctly.
 *
 * Strategy: list every transition from the year before the first date used in the zone to ten
 * years after the last one as an explicit observance (DTSTART only). When the transitions at the
 * end of that range follow a steady yearly rule (two transitions a year on the nth or last weekday
 * of a month at a fixed time, for at least {@link MIN_RULE_YEARS} years), that tail is published as
 * two RRULE observances instead, so recurring events keep the right offset beyond the range.
 * Irregular zones (e.g. Morocco) are explicit only and keep their last offset after the range.
 */
import { Temporal } from 'temporal-polyfill';

/** Years covered before the first and after the last date used in a zone. */
const YEARS_BEFORE = 1;
const YEARS_AFTER = 10;
/** Onset of the opening observance; nothing is published before the covered range anyway. */
const OPENING_ONSET = Temporal.PlainDateTime.from('1970-01-01T00:00');
/** How many consecutive years a pattern must hold to be published as an RRULE. */
const MIN_RULE_YEARS = 8;
const WEEKDAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

type Transition = {
	/** Wall-clock time of the transition in the offset before it, as RFC 5545 requires. */
	onset: Temporal.PlainDateTime;
	/** UTC offsets before and after, in nanoseconds. */
	from: number;
	to: number;
};

function formatLocal(dateTime: Temporal.PlainDateTime): string {
	return dateTime.toString({ smallestUnit: 'second' }).replace(/[-:]/g, '');
}

/** A UTC offset as `±HHMM`, or `±HHMMSS` when it has seconds. */
function formatOffset(nanoseconds: number): string {
	const total = Math.round(nanoseconds / 1e9);
	const abs = Math.abs(total);
	const pad = (value: number) => String(value).padStart(2, '0');
	const seconds = abs % 60;
	const hhmm = `${pad(Math.floor(abs / 3600))}${pad(Math.floor(abs / 60) % 60)}`;
	return `${total < 0 ? '-' : '+'}${hhmm}${seconds ? pad(seconds) : ''}`;
}

/**
 * An observance starting at `transition`, optionally repeating by `rrule`. Without a DST flag in
 * the tz data, a transition to a larger offset counts as daylight time; calendars only rely on the
 * offsets.
 */
function observance(
	transition: Transition,
	{
		kind = transition.to > transition.from ? 'DAYLIGHT' : 'STANDARD',
		rrule
	}: { kind?: string; rrule?: string } = {}
): string[] {
	return [
		`BEGIN:${kind}`,
		`DTSTART:${formatLocal(transition.onset)}`,
		...(rrule ? [`RRULE:${rrule}`] : []),
		`TZOFFSETFROM:${formatOffset(transition.from)}`,
		`TZOFFSETTO:${formatOffset(transition.to)}`,
		`END:${kind}`
	];
}

/**
 * temporal-polyfill only looks about three years ahead for the next transition, so a longer quiet
 * spell (e.g. Morocco 2028–2032) reads as "no more transitions". The scan resumes this far on.
 */
const SEARCH_STEP = { years: 2 };

function transitionsBetween(
	start: Temporal.ZonedDateTime,
	end: Temporal.ZonedDateTime
): Transition[] {
	const transitions: Transition[] = [];
	let cursor = start;
	while (Temporal.ZonedDateTime.compare(cursor, end) < 0) {
		const next = cursor.getTimeZoneTransition('next');
		if (!next) {
			cursor = cursor.add(SEARCH_STEP);
			continue;
		}
		if (Temporal.ZonedDateTime.compare(next, end) >= 0) break;
		const onset = next
			.toInstant()
			.toZonedDateTimeISO('UTC')
			.toPlainDateTime()
			.add({ nanoseconds: cursor.offsetNanoseconds });
		transitions.push({ onset, from: cursor.offsetNanoseconds, to: next.offsetNanoseconds });
		cursor = next;
	}
	return transitions;
}

/** A yearly transition pattern: one per year, same offsets, month, weekday and time. */
type YearlyPattern = {
	/** The earliest transition of the pattern. */
	first: Transition;
	/** BYDAY ordinals that fit every year seen: the nth weekday of the month, and/or -1 (last). */
	ordinals: number[];
	years: number;
};

function patternKey({ onset, from, to }: Transition): string {
	return [from, to, onset.month, onset.dayOfWeek, onset.toPlainTime().toString()].join('|');
}

function ordinals(onset: Temporal.PlainDateTime): number[] {
	const nth = Math.ceil(onset.day / 7);
	return onset.day + 7 > onset.daysInMonth ? [nth, -1] : [nth];
}

/**
 * Splits `transitions` into the explicit head and, when the tail follows a steady yearly rule,
 * the two patterns of that tail.
 */
function splitYearlyTail(transitions: Transition[]): {
	explicit: Transition[];
	patterns: YearlyPattern[];
} {
	const patterns = new Map<string, YearlyPattern>();
	let index = transitions.length - 1;
	for (; index >= 0; index--) {
		const transition = transitions[index];
		const key = patternKey(transition);
		const pattern = patterns.get(key);
		if (!pattern) {
			if (patterns.size === 2) break;
			patterns.set(key, { first: transition, ordinals: ordinals(transition.onset), years: 1 });
			continue;
		}
		const fitting = pattern.ordinals.filter((n) => ordinals(transition.onset).includes(n));
		if (fitting.length === 0 || transition.onset.year !== pattern.first.onset.year - 1) break;
		patterns.set(key, { first: transition, ordinals: fitting, years: pattern.years + 1 });
	}
	const tail = [...patterns.values()];
	if (tail.length !== 2 || tail.some((pattern) => pattern.years < MIN_RULE_YEARS)) {
		return { explicit: transitions, patterns: [] };
	}
	tail.sort((a, b) => Temporal.PlainDateTime.compare(a.first.onset, b.first.onset));
	return { explicit: transitions.slice(0, index + 1), patterns: tail };
}

function yearlyRule({ first, ordinals }: YearlyPattern): string {
	// "Last" is the more common tz rule when both fit every year seen.
	const ordinal = ordinals.includes(-1) ? -1 : ordinals[0];
	const weekday = WEEKDAY_CODES[first.onset.dayOfWeek - 1];
	return `FREQ=YEARLY;BYMONTH=${first.onset.month};BYDAY=${ordinal}${weekday}`;
}

/**
 * The VTIMEZONE for `zone`, covering from the start of the year before `first` to the end of the
 * tenth year after `last` (see the module comment). It opens with the offset in effect at the start
 * of that range; a zone without transitions in the range has only that STANDARD component.
 */
export function vtimezone(
	zone: string,
	first: Temporal.PlainDate,
	last: Temporal.PlainDate
): string[] {
	const yearStart = (year: number) =>
		Temporal.PlainDate.from({ year, month: 1, day: 1 }).toZonedDateTime(zone);
	const start = yearStart(first.year - YEARS_BEFORE);
	const transitions = transitionsBetween(start, yearStart(last.year + YEARS_AFTER + 1));
	const { explicit, patterns } = splitYearlyTail(transitions);
	// The opening observance stands for the offset in effect at the start of the range. It is
	// daylight time when the first transition goes back to a smaller offset.
	const opening = observance(
		{ onset: OPENING_ONSET, from: start.offsetNanoseconds, to: start.offsetNanoseconds },
		{
			kind:
				transitions.length > 0 && transitions[0].to < transitions[0].from ? 'DAYLIGHT' : 'STANDARD'
		}
	);
	return [
		'BEGIN:VTIMEZONE',
		`TZID:${zone}`,
		...opening,
		...explicit.flatMap((transition) => observance(transition)),
		...patterns.flatMap((pattern) => observance(pattern.first, { rrule: yearlyRule(pattern) })),
		'END:VTIMEZONE'
	];
}
