import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { m } from '#lib/paraglide/messages.js';
import { overwriteGetLocale } from '#lib/paraglide/runtime.js';
import { DISMISS_AFTER_MS, Toasts } from './toasts.svelte';

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

const messages = (toasts: Toasts) => toasts.items.map((toast) => toast.message);

describe('Toasts', () => {
	it('dismisses a toast after about six seconds', () => {
		const toasts = new Toasts();
		toasts.show('Saved');

		vi.advanceTimersByTime(DISMISS_AFTER_MS - 1);
		expect(messages(toasts)).toEqual(['Saved']);
		vi.advanceTimersByTime(1);
		expect(messages(toasts)).toEqual([]);
	});

	it('keeps one toast with an action: a new one replaces it, and the old action is dropped', () => {
		const toasts = new Toasts();
		const first = vi.fn();
		const second = vi.fn();
		toasts.show("Couldn't save the task.");
		toasts.undoable('Task completed', first);
		toasts.undoable('Task deleted', second);

		expect(messages(toasts)).toEqual(["Couldn't save the task.", 'Task deleted']);
		expect(toasts.actionable?.message).toBe('Task deleted');

		expect(toasts.actCurrent()).toBe(true);
		expect(first).not.toHaveBeenCalled();
		expect(second).toHaveBeenCalledOnce();
		expect(messages(toasts)).toEqual(["Couldn't save the task."]);
	});

	it('runs an action at most once', () => {
		const toasts = new Toasts();
		const undo = vi.fn();
		const id = toasts.undoable('Task completed', undo);

		toasts.act(id);
		toasts.act(id);
		expect(toasts.actCurrent()).toBe(false);
		expect(undo).toHaveBeenCalledOnce();
	});

	it('has nothing to run once the toast is gone', () => {
		const toasts = new Toasts();
		const undo = vi.fn();
		toasts.undoable('Task completed', undo);

		vi.advanceTimersByTime(DISMISS_AFTER_MS);
		expect(toasts.actCurrent()).toBe(false);
		expect(undo).not.toHaveBeenCalled();
	});

	it('pauses the countdown while hovered or focused, and resumes with the time that was left', () => {
		const toasts = new Toasts();
		const id = toasts.undoable('Task deleted', () => {});

		vi.advanceTimersByTime(4000);
		toasts.pause(id, 'hover');
		toasts.pause(id, 'focus');
		vi.advanceTimersByTime(60_000);
		expect(messages(toasts)).toEqual(['Task deleted']);

		// Still focused.
		toasts.resume(id, 'hover');
		vi.advanceTimersByTime(60_000);
		expect(messages(toasts)).toEqual(['Task deleted']);

		toasts.resume(id, 'focus');
		vi.advanceTimersByTime(DISMISS_AFTER_MS - 4000 - 1);
		expect(messages(toasts)).toEqual(['Task deleted']);
		vi.advanceTimersByTime(1);
		expect(messages(toasts)).toEqual([]);
	});

	it('ignores repeated pauses and resumes without a pause', () => {
		const toasts = new Toasts();
		const id = toasts.show('Saved');

		toasts.resume(id, 'hover');
		toasts.pause(id, 'hover');
		toasts.pause(id, 'hover');
		toasts.resume(id, 'hover');
		vi.advanceTimersByTime(DISMISS_AFTER_MS);
		expect(messages(toasts)).toEqual([]);
	});

	it('dismissing a toast by hand cancels its countdown', () => {
		const toasts = new Toasts();
		const first = toasts.show('First');
		toasts.dismiss(first);
		toasts.show('Second');
		vi.advanceTimersByTime(DISMISS_AFTER_MS - 1);
		expect(messages(toasts)).toEqual(['Second']);
	});
});

describe('Toasts.failed', () => {
	afterEach(() => overwriteGetLocale(() => 'en'));

	it('words a failure and its detail in the Language of the moment', () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const toasts = new Toasts();
		toasts.failed(m.toast_what_save_task(), new Error("That task doesn't exist anymore"));
		overwriteGetLocale(() => 'de');
		toasts.failed(m.toast_what_save_task(), new Error('Diese Aufgabe gibt es nicht mehr'));
		expect(messages(toasts)).toEqual([
			"Couldn't save the task. That task doesn't exist anymore.",
			'Aufgabe speichern fehlgeschlagen. Diese Aufgabe gibt es nicht mehr.'
		]);
	});
});
