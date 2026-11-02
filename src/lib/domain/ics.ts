/**
 * iCalendar (RFC 5545) generation for Calendar Links. Pure: no DB or HTTP.
 */
import { Temporal } from 'temporal-polyfill';
import type { DueDate, PlannedDate } from './dates';

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
};

function formatDate(date: Temporal.PlainDate): string {
	return date.toString().replaceAll('-', '');
}

function formatUtc(instant: Temporal.Instant): string {
	return instant.toString({ smallestUnit: 'second' }).replace(/[-:]/g, '');
}

type EventKind = 'planned' | 'due';

function event(
	task: CalendarTask,
	kind: EventKind,
	date: PlannedDate | DueDate,
	now: Temporal.Instant
): string[] {
	if (date.kind !== 'date') return [];
	return [
		'BEGIN:VEVENT',
		`UID:${task.id}-${kind}@tasks`,
		`DTSTAMP:${formatUtc(now)}`,
		`DTSTART;VALUE=DATE:${formatDate(date.date)}`,
		`DTEND;VALUE=DATE:${formatDate(date.date.add({ days: 1 }))}`,
		`SUMMARY:${kind === 'due' ? `Due: ${task.title}` : task.title}`,
		'END:VEVENT'
	];
}

/** Whether the Planned and Due Dates are the same date, or the same time in the same zone. */
function sameDate(planned: PlannedDate, due: DueDate): boolean {
	if (planned.kind === 'date' && due.kind === 'date') return planned.date.equals(due.date);
	return false;
}

function taskEvents(task: CalendarTask, now: Temporal.Instant): string[] {
	const planned = sameDate(task.planned, task.due) ? [] : event(task, 'planned', task.planned, now);
	return [...planned, ...event(task, 'due', task.due, now)];
}

export function buildCalendar(input: BuildCalendarInput): string {
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		`PRODID:${input.prodId ?? DEFAULT_PRODID}`,
		'CALSCALE:GREGORIAN',
		'METHOD:PUBLISH',
		`X-WR-CALNAME:${input.calendarName}`,
		'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
		'X-PUBLISHED-TTL:PT1H',
		...input.tasks.flatMap((task) => taskEvents(task, input.now)),
		'END:VCALENDAR'
	];
	return lines.map((line) => `${line}\r\n`).join('');
}
