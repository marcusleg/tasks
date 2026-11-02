/**
 * The viewer's clock and time zone for date display (`#lib/domain/date-display`).
 *
 * Relative labels (Today, Overdue) and times depend on the browser's zone, which the server doesn't
 * know. So {@link viewer} is `null` until a component has called {@link startClock} from
 * `onMount`: server-rendered HTML and the hydration pass show no zone-dependent text, and the
 * chips appear right after. The clock then ticks every 30 seconds (and when the tab comes back),
 * so labels roll over at midnight and follow a changed system zone.
 */
import { Temporal } from 'temporal-polyfill';
import type { Viewer } from '#lib/domain/date-display.js';

const TICK_MS = 30_000;

let now = $state<Temporal.Instant | null>(null);
let timeZone = $state('UTC');
let started = false;

/** The IANA zone of this browser; timed dates edited here are saved with it. */
export function browserTimeZone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
	} catch {
		return 'UTC';
	}
}

function tick() {
	now = Temporal.Now.instant();
	timeZone = browserTimeZone();
}

/** Starts the clock (once per page load). Call it from `onMount`. */
export function startClock(): void {
	if (started) return;
	started = true;
	tick();
	setInterval(tick, TICK_MS);
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') tick();
	});
}

/** Now and the browser zone, or `null` before the clock has started (SSR, hydration). */
export function viewer(): Viewer | null {
	return now && { now, timeZone };
}

/** The browser zone as last seen by the clock; stable between ticks, unlike {@link viewer}. */
export function viewerTimeZone(): string {
	return timeZone;
}
