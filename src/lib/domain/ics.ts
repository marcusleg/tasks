/**
 * iCalendar (RFC 5545) generation for Calendar Links (see CONTEXT.md and ADR 0001). Pure: no DB or
 * HTTP; the caller picks the Tasks and serves the result as `text/calendar; charset=utf-8`.
 *
 * Each {@link CalendarTask} becomes up to two VEVENTs, one per set date:
 * - Planned: SUMMARY is the title. Date-only → all-day (`VALUE=DATE`, DTEND the next day); timed →
 *   `TZID` wall-clock start and DTEND = start + Duration in elapsed time (DURATION instead when
 *   that end is a repeated wall-clock time, which DTEND would read as the earlier instance).
 * - Due: SUMMARY is `Due: <title>`. Date-only → all-day; timed → zero-length, as `DURATION:PT0S`.
 *   RFC 5545 requires DTEND to be later than DTSTART, so DTEND = DTSTART would be invalid; a
 *   DURATION also makes a fixed length a one-option change (`dueEventMinutes`, e.g. 1).
 * - When both dates are the same day (date-only) or the same wall-clock time in the same zone,
 *   only the Due event is published.
 * - UID is `<id>-planned@tasks` / `<id>-due@tasks`, where id is the Recurrence's `seriesId` for a
 *   series and the Task id otherwise; DTSTAMP is `now`. DESCRIPTION lists the List, the parent
 *   (for a dated Subtask), the Task description, undated Subtasks as a ☐/☑ checklist and the deep
 *   link, which is also the URL property.
 *
 * Recurring Tasks: the current Occurrence's events carry the RRULEs from `toRRules` (completion-
 * anchored rules as their on-time projection), under the series UIDs, so a calendar replaces the
 * series when an Occurrence is completed. A detached Occurrence (changed by "This Occurrence") is
 * published as one-off events under its Task id, followed by the series from `nextOccurrence` of
 * its template (stepped from an on-time completion for completion-anchored rules), with the
 * template's Title and Description, or alone when the Recurrence has ended.
 *
 * Subtasks: the caller lists undated Subtasks in their parent's `undatedSubtasks`, and passes each
 * dated Subtask as a CalendarTask of its own with `parentTitle` set. Completed Tasks and
 * recurring Subtasks of a Completed parent are left out by the caller.
 *
 * Formatting: CRLF line endings, TEXT escaping, and lines folded at 75 octets between code points.
 * VTIMEZONEs: see `vtimezone.ts`.
 */
import { Temporal } from 'temporal-polyfill';
import { toZonedDateTime, type DueDate, type PlannedDate } from './dates';
import {
	nextOccurrence,
	stepDriver,
	toRRules,
	type OccurrenceDates,
	type RecurrenceRule,
	type RRules
} from './recurrence';
import { vtimezone } from './vtimezone';

export const DEFAULT_PRODID = '-//marcusleg//Tasks//EN';

export type CalendarTask = {
	/** The Task's stable id. */
	id: string;
	title: string;
	/** Plain text. */
	description: string;
	listName: string;
	/** Deep link back to the Task in the app. */
	url: string;
	planned: PlannedDate;
	due: DueDate;
	/** Listed as a checklist in the description. */
	undatedSubtasks: { title: string; completed: boolean }[];
	/** The parent's title, for a dated Subtask (published as its own CalendarTask). */
	parentTitle?: string;
	/** Set when the Task is the current Occurrence of a Recurrence. */
	recurrence?: CalendarRecurrence;
};

export type CalendarRecurrence = {
	/** Stable id shared by every Occurrence of the Recurrence; the series' UIDs derive from it. */
	seriesId: string;
	rule: RecurrenceRule;
	/** How many Occurrences the series has had, including this one (the first is 1). */
	occurrencesSoFar: number;
	/**
	 * Whether this Occurrence was moved off the rule by editing "This Occurrence". It is then
	 * published as a one-off event under the Task id, followed by the series from the next
	 * Occurrence on (RFC 5545 leaves a DTSTART that doesn't match the rule undefined).
	 */
	detached?: boolean;
	/**
	 * What the series makes of this Occurrence (its series template), when that differs from the
	 * Task: a detached Occurrence's series is stepped from these dates and carries this Title and
	 * Description. Defaults to the Task's own.
	 */
	template?: OccurrenceDates & { title: string; description: string };
};

export type BuildCalendarInput = {
	/** The Calendar Link's name, shown by calendar apps as the calendar's name. */
	calendarName: string;
	tasks: CalendarTask[];
	/** The time the calendar is generated, published as each event's DTSTAMP. */
	now: Temporal.Instant;
	prodId?: string;
	/**
	 * Length of a timed Due Date's event in minutes. 0 (the default) publishes a zero-length event
	 * as `DURATION:PT0S`; a positive value suits calendars that hide zero-length events.
	 */
	dueEventMinutes?: number;
	/**
	 * Publish monthly series on the 29th or 30th with the exact RFC 5545 rule
	 * (`BYMONTHDAY=28,29[,30];BYSETPOS=-1`), which clamps to short months like the app. Off by
	 * default: Proton Calendar rejects multi-value BYMONTHDAY and ical.js (Thunderbird) misexpands
	 * it, so a single `BYMONTHDAY=29`/`30` is published instead, skipping months without that day.
	 */
	exactMonthEnd?: boolean;
};

type Options = {
	now: Temporal.Instant;
	dueEventMinutes: number;
	exactMonthEnd: boolean;
	/** Zones used so far, with the first and last local date used in each. */
	zones: Map<string, { first: Temporal.PlainDate; last: Temporal.PlainDate }>;
};

function useZone(options: Options, zone: string, date: Temporal.PlainDate) {
	const used = options.zones.get(zone);
	options.zones.set(zone, {
		first: used && Temporal.PlainDate.compare(used.first, date) < 0 ? used.first : date,
		last: used && Temporal.PlainDate.compare(used.last, date) > 0 ? used.last : date
	});
}

function formatDate(date: Temporal.PlainDate): string {
	return date.toString().replaceAll('-', '');
}

function formatUtc(instant: Temporal.Instant): string {
	return instant.toString({ smallestUnit: 'second' }).replace(/[-:]/g, '');
}

type EventKind = 'planned' | 'due';

/**
 * Escapes a TEXT value (RFC 5545 §3.3.11): backslash, semicolon, comma and line breaks. Other
 * control characters are not allowed in content lines (§3.1) and are dropped; tabs are kept.
 */
function text(value: string): string {
	return (
		value
			.replace(/[\\;,]/g, (char) => `\\${char}`)
			.replace(/\r\n?|\n/g, '\\n')
			// eslint-disable-next-line no-control-regex
			.replace(/[\x00-\x08\x0a-\x1f\x7f]/g, '')
	);
}

function description(task: CalendarTask): string {
	const header = [`List: ${task.listName}`];
	if (task.parentTitle !== undefined) header.push(`Subtask of: ${task.parentTitle}`);
	const checklist = task.undatedSubtasks.map(
		(subtask) => `${subtask.completed ? '☑' : '☐'} ${subtask.title}`
	);
	const sections = [header.join('\n'), task.description.trim(), checklist.join('\n'), task.url];
	return sections.filter((section) => section !== '').join('\n\n');
}

function formatLocal(dateTime: Temporal.PlainDateTime): string {
	return dateTime.toString({ smallestUnit: 'second' }).replace(/[-:]/g, '');
}

/** DTSTART and DTEND (or DURATION) of an event, or `null` for an unset date. */
function timing(kind: EventKind, date: PlannedDate | DueDate, options: Options): string[] | null {
	switch (date.kind) {
		case 'unset':
			return null;
		case 'date':
			return [
				`DTSTART;VALUE=DATE:${formatDate(date.date)}`,
				`DTEND;VALUE=DATE:${formatDate(date.date.add({ days: 1 }))}`
			];
		case 'timed': {
			useZone(options, date.timeZone, date.dateTime.toPlainDate());
			const zone = `TZID=${date.timeZone}`;
			const start = `DTSTART;${zone}:${formatLocal(date.dateTime)}`;
			if (kind === 'due' || !('durationMinutes' in date)) {
				return [
					start,
					`DURATION:PT${options.dueEventMinutes === 0 ? '0S' : `${options.dueEventMinutes}M`}`
				];
			}
			const end = toZonedDateTime(date).add({ minutes: date.durationMinutes });
			const endWallClock = end.toPlainDateTime();
			// A repeated wall-clock time (DST overlap) reads as its earlier instance, which would cut
			// the event short; DURATION is exact.
			const readBack = endWallClock.toZonedDateTime(date.timeZone, {
				disambiguation: 'compatible'
			});
			return readBack.equals(end)
				? [start, `DTEND;${zone}:${formatLocal(endWallClock)}`]
				: [start, `DURATION:PT${date.durationMinutes}M`];
		}
	}
}

/**
 * Replaces the clamped month-day pattern `BYMONTHDAY=28,…,N;BYSETPOS=-1` with plain
 * `BYMONTHDAY=N` (see `exactMonthEnd`). The intended day N is the last one listed.
 */
function withoutSetPos(rrule: string): string {
	return rrule.replace(/BYMONTHDAY=28(?:,(\d+))+;BYSETPOS=-1/, 'BYMONTHDAY=$1');
}

/**
 * The events of one Occurrence, or of a series starting at it when `rrules` is given; `task`
 * supplies the Title and Description.
 */
type Publication = { uidBase: string; dates: OccurrenceDates; rrules?: RRules; task: CalendarTask };

function event(kind: EventKind, publication: Publication, options: Options): string[] {
	const { task } = publication;
	const times = timing(kind, publication.dates[kind], options);
	if (!times) return [];
	const exactRrule = publication.rrules?.[kind];
	const rrule = exactRrule && !options.exactMonthEnd ? withoutSetPos(exactRrule) : exactRrule;
	return [
		'BEGIN:VEVENT',
		`UID:${publication.uidBase}-${kind}@tasks`,
		`DTSTAMP:${formatUtc(options.now)}`,
		...times,
		...(rrule ? [`RRULE:${rrule}`] : []),
		`SUMMARY:${text(kind === 'due' ? `Due: ${task.title}` : task.title)}`,
		`DESCRIPTION:${text(description(task))}`,
		`URL:${task.url}`,
		'END:VEVENT'
	];
}

/** Whether the Planned and Due Dates are the same date, or the same time in the same zone. */
function sameDate({ planned, due }: OccurrenceDates): boolean {
	if (planned.kind === 'date' && due.kind === 'date') return planned.date.equals(due.date);
	if (planned.kind === 'timed' && due.kind === 'timed') {
		return planned.timeZone === due.timeZone && planned.dateTime.equals(due.dateTime);
	}
	return false;
}

/**
 * When an Occurrence would be completed on time: at its driving date (in its zone, or for a
 * date-only value in UTC, whose calendar date is all that counts).
 */
function onTimeCompletion(dates: OccurrenceDates): Temporal.ZonedDateTime {
	const driver = dates[stepDriver(dates)];
	if (driver.kind === 'timed') return toZonedDateTime(driver);
	if (driver.kind === 'date') return driver.date.toZonedDateTime('UTC');
	throw new Error('A recurring Task needs at least one date');
}

function series(
	task: CalendarTask,
	uidBase: string,
	dates: OccurrenceDates,
	recurrence: CalendarRecurrence
): Publication {
	const { rule, occurrencesSoFar } = recurrence;
	return { task, uidBase, dates, rrules: toRRules(rule, { ...dates, occurrencesSoFar }) };
}

function publications(task: CalendarTask): Publication[] {
	const dates: OccurrenceDates = { planned: task.planned, due: task.due };
	const { recurrence } = task;
	if (!recurrence || (dates.planned.kind === 'unset' && dates.due.kind === 'unset')) {
		return [{ task, uidBase: task.id, dates }];
	}
	if (!recurrence.detached) return [series(task, recurrence.seriesId, dates, recurrence)];
	// The series goes on from where the template is, not from the moved Occurrence; completion-
	// anchored rules are projected from completing this Occurrence on time, as toRRules does.
	const { template } = recurrence;
	const next = nextOccurrence({
		...(template ?? dates),
		rule: recurrence.rule,
		occurrencesSoFar: recurrence.occurrencesSoFar,
		completedAt: onTimeCompletion(dates)
	});
	const single: Publication = { task, uidBase: task.id, dates };
	if (!next) return [single];
	const seriesTask = template
		? { ...task, title: template.title, description: template.description }
		: task;
	const occurrencesSoFar = recurrence.occurrencesSoFar + 1;
	return [
		single,
		series(seriesTask, recurrence.seriesId, next, { ...recurrence, occurrencesSoFar })
	];
}

function taskEvents(task: CalendarTask, options: Options): string[] {
	return publications(task).flatMap((publication) => [
		...(sameDate(publication.dates) ? [] : event('planned', publication, options)),
		...event('due', publication, options)
	]);
}

const MAX_LINE_OCTETS = 75;

function utf8Length(codePoint: number): number {
	if (codePoint < 0x80) return 1;
	if (codePoint < 0x800) return 2;
	return codePoint < 0x10000 ? 3 : 4;
}

/**
 * Folds a content line into physical lines of at most 75 octets (RFC 5545 §3.1), each continuation
 * starting with a space. Splits only between code points, so no UTF-8 character is broken.
 */
function fold(line: string): string {
	const physical: string[] = [];
	let current = '';
	let octets = 0;
	for (const char of line) {
		const size = utf8Length(char.codePointAt(0)!);
		if (octets + size > MAX_LINE_OCTETS) {
			physical.push(current);
			current = ' ';
			octets = 1;
		}
		current += char;
		octets += size;
	}
	physical.push(current);
	return physical.join('\r\n');
}

/**
 * The Calendar Link's iCalendar document: a VEVENT for each Planned and Due Date of `tasks` (see
 * the module comment), preceded by a VTIMEZONE for every zone they use.
 */
export function buildCalendar(input: BuildCalendarInput): string {
	const dueEventMinutes = input.dueEventMinutes ?? 0;
	if (!Number.isInteger(dueEventMinutes) || dueEventMinutes < 0) {
		throw new RangeError(`dueEventMinutes must be a whole number ≥ 0, got ${dueEventMinutes}`);
	}
	const options: Options = {
		now: input.now,
		dueEventMinutes,
		exactMonthEnd: input.exactMonthEnd ?? false,
		zones: new Map()
	};
	const events = input.tasks.flatMap((task) => taskEvents(task, options));
	const nowDate = input.now.toZonedDateTimeISO('UTC').toPlainDate();
	const timezones = [...options.zones].flatMap(([zone, { first, last }]) =>
		vtimezone(zone, first, Temporal.PlainDate.compare(last, nowDate) > 0 ? last : nowDate)
	);
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		`PRODID:${text(input.prodId ?? DEFAULT_PRODID)}`,
		'CALSCALE:GREGORIAN',
		'METHOD:PUBLISH',
		`X-WR-CALNAME:${text(input.calendarName)}`,
		'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
		'X-PUBLISHED-TTL:PT1H',
		...timezones,
		...events,
		'END:VCALENDAR'
	];
	return lines.map((line) => `${fold(line)}\r\n`).join('');
}
