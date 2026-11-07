/**
 * Keeps an open page from showing stale data after changes made on another device: it reloads its
 * `load` data when the User comes back to it, and now and then while it stays visible (ADR 0003).
 */
import { goto, invalidate } from '$app/navigation';
import { resolve } from '$app/paths';
import { navigating, page } from '$app/state';
import { mutations } from './api.js';

const RELOAD_EVERY_MS = 60_000;
/** While the page is busy, and to count coming back as one reload: it fires two browser events. */
const SETTLE_MS = 200;
/** A phone waking up may need a moment to get its network back. */
const RETRY_OFFLINE_MS = 5_000;

/**
 * Reloading now would drop optimistic changes that are still being sent or move rows under a dragged
 * Task, and SvelteKit discards a reload that a navigation overtakes.
 */
function isBusy(): boolean {
	return (
		mutations.inFlight > 0 ||
		navigating.to !== null ||
		document.documentElement.classList.contains('task-dragging')
	);
}

/**
 * When a reload can't reach the server, SvelteKit falls back to a full page navigation, which would
 * swap the app for the browser's error page. So look before leaping.
 */
async function serverReachable(): Promise<boolean> {
	try {
		return (await fetch(resolve('/healthz'), { cache: 'no-store' })).ok;
	} catch {
		return false;
	}
}

/** Starts refreshing. Call it from `onMount` for a signed-in User. Returns how to stop. */
export function startPageRefresh(): () => void {
	let timer: ReturnType<typeof setTimeout> | undefined;

	function schedule(delay: number) {
		clearTimeout(timer);
		timer = setTimeout(() => void reload(), delay);
	}

	async function reload() {
		if (isBusy()) return schedule(SETTLE_MS);
		if (!(await serverReachable())) return schedule(RETRY_OFFLINE_MS);
		// Hidden or busy in the meantime: the timer is off, or this comes back around.
		if (document.visibilityState !== 'visible') return;
		if (isBusy()) return schedule(SETTLE_MS);

		const started = mutations.started;
		// Every custom `depends()` key (`#lib/dependencies`).
		await invalidate((url) => url.protocol === 'app:');
		// What just loaded may predate a change made here in the meantime.
		if (mutations.started !== started) return schedule(SETTLE_MS);
		// The List on screen was deleted elsewhere.
		if (page.status === 404 && page.route.id === '/lists/[id]') await goto(resolve('/'));
		schedule(RELOAD_EVERY_MS);
	}

	function onVisibilityChange() {
		if (document.visibilityState === 'visible') schedule(SETTLE_MS);
		else clearTimeout(timer);
	}

	function onFocus() {
		schedule(SETTLE_MS);
	}

	document.addEventListener('visibilitychange', onVisibilityChange);
	window.addEventListener('focus', onFocus);
	schedule(RELOAD_EVERY_MS);

	return () => {
		document.removeEventListener('visibilitychange', onVisibilityChange);
		window.removeEventListener('focus', onFocus);
		clearTimeout(timer);
	};
}
