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
	undatedSubtasks: { title: string; completed: boolean }[];
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
		`SUMMARY:${kind === 'due' ? `Due: ${task.title}` : task.title}`,
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

export function buildCalendar(input: BuildCalendarInput): string {
	const options: Options = { now: input.now, dueEventMinutes: input.dueEventMinutes ?? 0 };
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		`PRODID:${input.prodId ?? DEFAULT_PRODID}`,
		'CALSCALE:GREGORIAN',
		'METHOD:PUBLISH',
		`X-WR-CALNAME:${input.calendarName}`,
		'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
		'X-PUBLISHED-TTL:PT1H',
		...input.tasks.flatMap((task) => taskEvents(task, options)),
		'END:VCALENDAR'
	];
	return lines.map((line) => `${line}\r\n`).join('');
}
