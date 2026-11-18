/**
 * Calendar Links: a secret URL a calendar app subscribes to as a read-only calendar.
 * Open, dated Tasks of the covered Lists are published as iCalendar events (VEVENT, not VTODO:
 * many calendar apps ignore to-dos in subscribed calendars). A repeating Task is one event series
 * with an RRULE, so future occurrences show up before they exist in the app.
 */
import { randomBytes } from 'node:crypto';
import { config } from './config.js';
import { db, now } from './db.js';
import { cleanRule } from './recurrence.js';

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** 32 random bytes (256 bits) as base64url: 43 URL-safe characters. */
export function newCalendarToken() {
  return randomBytes(32).toString('base64url');
}

export function calendarLinkUrl(token) {
  return `${config.publicUrl}/cal/${token}.ics`;
}

/* ---------- iCalendar text ---------- */

function escapeText(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Folds a content line to 75 octets per RFC 5545 (continuation lines start with a space). */
function fold(line) {
  const bytes = Buffer.from(line, 'utf8');
  if (bytes.length <= 75) return line;
  const out = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // don't split a UTF-8 character
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    out.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
    limit = 74;
  }
  return out.join('\r\n ');
}

const compactDate = (key) => key.replace(/-/g, '');
const compactTime = (time) => `${time.replace(':', '')}00`;

function addDay(key) {
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + 1));
  return date.toISOString().slice(0, 10);
}

function stamp(iso) {
  return new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

/** The RRULE for a repeat rule, counting only the occurrences still to come (this one included). */
export function rrule(rule, done = 0, timed = false) {
  const freq = { day: 'DAILY', week: 'WEEKLY', month: 'MONTHLY', year: 'YEARLY' }[rule.freq];
  const parts = [`FREQ=${freq}`];
  if (rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.freq === 'week' && rule.weekdays?.length) parts.push(`BYDAY=${rule.weekdays.map((d) => BYDAY[d]).join(',')}`);
  if (rule.end?.type === 'on') parts.push(`UNTIL=${compactDate(rule.end.date)}${timed ? 'T235959' : ''}`);
  if (rule.end?.type === 'after') parts.push(`COUNT=${Math.max(1, rule.end.count - done)}`);
  return `RRULE:${parts.join(';')}`;
}

/** Builds the calendar for one link: only the owner's Tasks, in the Lists it covers. */
export function buildFeed(link) {
  const lists = link.all_lists
    ? db.prepare('SELECT id, title FROM lists WHERE user_id = ? ORDER BY position').all(link.user_id)
    : db
        .prepare('SELECT l.id, l.title FROM lists l JOIN calendar_link_lists cl ON cl.list_id = l.id WHERE cl.link_id = ? AND l.user_id = ? ORDER BY l.position')
        .all(link.id, link.user_id);
  const listNames = new Map(lists.map((l) => [l.id, l.title]));
  const tasks = lists.length
    ? db.prepare(`SELECT * FROM tasks WHERE user_id = ? AND list_id IN (${lists.map(() => '?').join(',')})`).all(link.user_id, ...lists.map((l) => l.id))
    : [];
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const host = new URL(config.publicUrl).host;
  const dtstamp = stamp(now());

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//${escapeText(config.appName)}//Self-hosted Tasks//EN`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(link.name)}`,
    `NAME:${escapeText(link.name)}`,
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H'
  ];

  for (const task of tasks) {
    if (task.completed_at || !task.due_date) continue;
    const parent = task.parent_id ? byId.get(task.parent_id) : null;
    if (task.parent_id && (!parent || parent.completed_at)) continue;

    const description = [];
    if (task.notes) description.push(task.notes);
    const undated = tasks.filter((s) => s.parent_id === task.id && !s.due_date).sort((a, b) => a.position - b.position);
    if (undated.length) {
      if (description.length) description.push('');
      for (const s of undated) description.push(`${s.completed_at ? '☑' : '☐'} ${s.title}`);
    }
    if (description.length) description.push('');
    if (parent) description.push(`Subtask of: ${parent.title}`);
    description.push(`List: ${listNames.get(task.list_id) ?? ''}`);
    if (task.priority) description.push(`Priority: ${task.priority[0].toUpperCase()}${task.priority.slice(1)}`);

    const rule = task.parent_id ? null : (() => { try { return cleanRule(JSON.parse(task.repeat_rule)); } catch { return null; } })();
    const uid = `${rule ? task.series_id || task.id : task.id}@${host}`;
    const ev = ['BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${dtstamp}`, `LAST-MODIFIED:${stamp(task.updated_at)}`];
    if (task.due_time) {
      // Floating local time (no time zone): shown at that clock time wherever the calendar is.
      ev.push(`DTSTART:${compactDate(task.due_date)}T${compactTime(task.due_time)}`);
      ev.push(`DTEND:${compactDate(task.due_date)}T${compactTime(task.due_time)}`);
    } else {
      ev.push(`DTSTART;VALUE=DATE:${compactDate(task.due_date)}`);
      ev.push(`DTEND;VALUE=DATE:${compactDate(addDay(task.due_date))}`);
    }
    if (rule) ev.push(rrule(rule, task.repeat_done || 0, !!task.due_time));
    ev.push(`SUMMARY:${escapeText(`Due: ${task.title || 'Untitled task'}`)}`);
    ev.push(`DESCRIPTION:${escapeText(description.join('\n'))}`);
    ev.push(`URL:${config.publicUrl}/`);
    ev.push('TRANSP:TRANSPARENT');
    if (task.priority) ev.push(`PRIORITY:${{ high: 1, medium: 5, low: 9 }[task.priority]}`);
    ev.push('END:VEVENT');
    lines.push(...ev);
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

/** A file name for the feed: the link's name as a lowercase ASCII slug. */
export function feedFilename(name) {
  const slug = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return `${slug || 'calendar'}.ics`;
}

/** Handler for GET /cal/<token>.ics (public: the token is the secret). */
export function serveFeed(c) {
  const file = c.req.param('file') || '';
  const token = file.endsWith('.ics') ? file.slice(0, -4) : '';
  if (!TOKEN_PATTERN.test(token)) return c.text('Not found', 404);
  const link = db.prepare('SELECT * FROM calendar_links WHERE token = ?').get(token);
  if (!link) return c.text('Not found', 404);
  db.prepare('UPDATE calendar_links SET last_accessed_at = ? WHERE id = ?').run(now(), link.id);
  c.header('Content-Type', 'text/calendar; charset=utf-8');
  c.header('Content-Disposition', `inline; filename="${feedFilename(link.name)}"`);
  c.header('Cache-Control', 'no-cache, private');
  c.header('X-Robots-Tag', 'noindex');
  return c.body(buildFeed(link));
}
