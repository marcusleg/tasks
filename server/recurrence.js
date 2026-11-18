/**
 * Repeating tasks, shared by the server and the browser (no dependencies).
 *
 * A rule looks like:
 *   { freq: 'day' | 'week' | 'month' | 'year', interval: 1..999,
 *     weekdays: [0..6] (weekly only, 0 = Sunday),
 *     end: { type: 'never' } | { type: 'on', date: 'YYYY-MM-DD' } | { type: 'after', count: 1..999 } }
 * Dates are calendar days 'YYYY-MM-DD'. `done` counts occurrences already completed.
 */

const FREQS = ['day', 'week', 'month', 'year'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function parse(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function format(date) {
  return date.toISOString().slice(0, 10);
}

function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}

/** A clean copy of a rule, or null when it isn't a valid rule. */
export function cleanRule(rule) {
  if (!rule || typeof rule !== 'object' || !FREQS.includes(rule.freq)) return null;
  const interval = Math.min(999, Math.max(1, Math.floor(Number(rule.interval) || 1)));
  const weekdays =
    rule.freq === 'week' && Array.isArray(rule.weekdays)
      ? [...new Set(rule.weekdays.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort()
      : [];
  let end = { type: 'never' };
  if (rule.end?.type === 'on' && typeof rule.end.date === 'string' && DATE.test(rule.end.date)) {
    end = { type: 'on', date: rule.end.date };
  } else if (rule.end?.type === 'after') {
    end = { type: 'after', count: Math.min(999, Math.max(1, Math.floor(Number(rule.end.count) || 1))) };
  }
  const monthDay = Math.floor(Number(rule.monthDay));
  const out = { freq: rule.freq, interval, weekdays, end };
  if ((rule.freq === 'month' || rule.freq === 'year') && monthDay >= 1 && monthDay <= 31) out.monthDay = monthDay;
  return out;
}

/** The rule with its anchor day taken from the due date (so 31st stays 31st after a short month). */
export function anchorRule(rule, dueDate) {
  if (!rule || !dueDate) return rule;
  if (rule.freq === 'month' || rule.freq === 'year') return { ...rule, monthDay: Number(dueDate.slice(8, 10)) };
  return rule;
}

/** The next due date after `from` (the current occurrence's date), ignoring the end condition. */
export function nextDate(rule, from) {
  const d = parse(from);
  const n = rule.interval || 1;
  if (rule.freq === 'day') {
    d.setUTCDate(d.getUTCDate() + n);
    return format(d);
  }
  if (rule.freq === 'week') {
    if (!rule.weekdays?.length) {
      d.setUTCDate(d.getUTCDate() + 7 * n);
      return format(d);
    }
    // Weeks start on Sunday; only every n-th week (counted from `from`'s week) is eligible.
    const startOfWeek = (x) => Math.floor((x.getTime() / 86400000 + 4) / 7); // 1970-01-01 was a Thursday
    const baseWeek = startOfWeek(d);
    const probe = new Date(d);
    for (let i = 0; i < 7 * n + 7; i++) {
      probe.setUTCDate(probe.getUTCDate() + 1);
      if ((startOfWeek(probe) - baseWeek) % n === 0 && rule.weekdays.includes(probe.getUTCDay())) return format(probe);
    }
    d.setUTCDate(d.getUTCDate() + 7 * n);
    return format(d);
  }
  if (rule.freq === 'month') {
    const day = rule.monthDay || d.getUTCDate();
    const total = d.getUTCMonth() + n;
    const y = d.getUTCFullYear() + Math.floor(total / 12);
    const m = ((total % 12) + 12) % 12;
    return format(new Date(Date.UTC(y, m, Math.min(day, daysInMonth(y, m)))));
  }
  // year
  const y = d.getUTCFullYear() + n;
  const m = d.getUTCMonth();
  const day = rule.monthDay || d.getUTCDate();
  return format(new Date(Date.UTC(y, m, Math.min(day, daysInMonth(y, m)))));
}

/**
 * The next occurrence's due date after completing the one due `from`, or null when the series ends.
 * `done` is how many occurrences were completed before this one.
 */
export function nextOccurrence(rule, from, done = 0) {
  if (!rule || !from) return null;
  if (rule.end?.type === 'after' && done + 1 >= rule.end.count) return null;
  const next = nextDate(rule, from);
  if (rule.end?.type === 'on' && next > rule.end.date) return null;
  return next;
}

/** For a weekly rule with chosen weekdays, move a date forward onto the first matching day. */
export function alignStart(rule, date) {
  if (!rule || rule.freq !== 'week' || !rule.weekdays?.length || !date) return date;
  const d = parse(date);
  for (let i = 0; i < 7; i++) {
    if (rule.weekdays.includes(d.getUTCDay())) return format(d);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return date;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const UNIT = { day: ['day', 'days'], week: ['week', 'weeks'], month: ['month', 'months'], year: ['year', 'years'] };

/** Plain-English summary, e.g. "Every 2 weeks on Mon, Thu, until 1 Dec". */
export function describeRule(rule, dueDate, locale) {
  if (!rule) return '';
  const n = rule.interval || 1;
  const [one, many] = UNIT[rule.freq];
  let text = n === 1 ? (rule.freq === 'day' ? 'Daily' : `Every ${one}`) : `Every ${n} ${many}`;
  if (rule.freq === 'day' && n === 1) text = 'Daily';
  if (rule.freq === 'week' && n === 1) text = 'Weekly';
  if (rule.freq === 'month' && n === 1) text = 'Monthly';
  if (rule.freq === 'year' && n === 1) text = 'Yearly';
  if (rule.freq === 'week' && rule.weekdays?.length) {
    text += rule.weekdays.length === 7 ? ' on every day' : ` on ${rule.weekdays.map((d) => DAY_NAMES[d]).join(', ')}`;
  }
  if (rule.freq === 'month' && dueDate) text += ` on day ${Number(dueDate.slice(8, 10))}`;
  if (rule.freq === 'year' && dueDate) {
    text += ` on ${parse(dueDate).toLocaleDateString(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' })}`;
  }
  if (rule.end?.type === 'on') {
    text += `, until ${parse(rule.end.date).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`;
  } else if (rule.end?.type === 'after') {
    text += `, ${rule.end.count} ${rule.end.count === 1 ? 'time' : 'times'}`;
  }
  return text;
}
