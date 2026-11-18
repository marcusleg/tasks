/** Date helpers. Due dates are stored as 'YYYY-MM-DD' (local calendar day), times as 'HH:MM'. */
export function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function parseKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function dayDiff(key) {
  const a = parseKey(key);
  const b = parseKey(todayKey());
  return Math.round((a - b) / 86400000);
}

export function addDays(key, n) {
  const d = parseKey(key);
  d.setDate(d.getDate() + n);
  return todayKey(d);
}

const locale = typeof navigator !== 'undefined' ? navigator.language : 'en-US';

export function formatTime(time) {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  const d = new Date(2000, 0, 1, h, m);
  return d.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
}

/** Short label for a due date: Today, Tomorrow, Yesterday, a weekday this week, or a date. */
export function formatDue(key, time) {
  if (!key) return '';
  const diff = dayDiff(key);
  let label;
  if (diff === 0) label = 'Today';
  else if (diff === 1) label = 'Tomorrow';
  else if (diff === -1) label = 'Yesterday';
  else if (diff > 1 && diff < 7) label = parseKey(key).toLocaleDateString(locale, { weekday: 'long' });
  else {
    const d = parseKey(key);
    const sameYear = d.getFullYear() === new Date().getFullYear();
    label = d.toLocaleDateString(locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      ...(sameYear ? {} : { year: 'numeric' })
    });
  }
  return time ? `${label}, ${formatTime(time)}` : label;
}

/** Heading used when a list is sorted by date. */
export function dateGroup(key) {
  if (!key) return 'No date';
  const diff = dayDiff(key);
  if (diff < 0) return 'Past';
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  return parseKey(key).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
}

export function formatCompleted(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return 'Completed: ' + d.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' });
}
