/**
 * iCalendar (RFC 5545) generation for Calendar Links. Pure: no DB or HTTP.
 */
import { Temporal } from 'temporal-polyfill';
import { toZonedDateTime, type DueDate, type PlannedDate } from './dates';

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
};

type Options = { now: Temporal.Instant; dueEventMinutes: number };

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

function event(
	task: CalendarTask,
	kind: EventKind,
	date: PlannedDate | DueDate,
	options: Options
): string[] {
	const times = timing(kind, date, options);
	if (!times) return [];
	return [
		'BEGIN:VEVENT',
		`UID:${task.id}-${kind}@tasks`,
		`DTSTAMP:${formatUtc(options.now)}`,
		...times,
		`SUMMARY:${text(kind === 'due' ? `Due: ${task.title}` : task.title)}`,
		`DESCRIPTION:${text(description(task))}`,
		`URL:${task.url}`,
		'END:VEVENT'
	];
}

/** Whether the Planned and Due Dates are the same date, or the same time in the same zone. */
function sameDate(planned: PlannedDate, due: DueDate): boolean {
	if (planned.kind === 'date' && due.kind === 'date') return planned.date.equals(due.date);
	if (planned.kind === 'timed' && due.kind === 'timed') {
		return planned.timeZone === due.timeZone && planned.dateTime.equals(due.dateTime);
	}
	return false;
}

function taskEvents(task: CalendarTask, options: Options): string[] {
	const planned = sameDate(task.planned, task.due)
		? []
		: event(task, 'planned', task.planned, options);
	return [...planned, ...event(task, 'due', task.due, options)];
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

export function buildCalendar(input: BuildCalendarInput): string {
	const options: Options = { now: input.now, dueEventMinutes: input.dueEventMinutes ?? 0 };
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		`PRODID:${input.prodId ?? DEFAULT_PRODID}`,
		'CALSCALE:GREGORIAN',
		'METHOD:PUBLISH',
		`X-WR-CALNAME:${text(input.calendarName)}`,
		'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
		'X-PUBLISHED-TTL:PT1H',
		...input.tasks.flatMap((task) => taskEvents(task, options)),
		'END:VCALENDAR'
	];
	return lines.map((line) => `${fold(line)}\r\n`).join('');
}
