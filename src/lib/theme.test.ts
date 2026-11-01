import { describe, expect, it } from 'vitest';
import { readPreference, resolveTheme, writePreference, type ThemeStorage } from '#lib/theme.js';

function memoryStorage(initial: Record<string, string> = {}): ThemeStorage & {
	data: Record<string, string>;
} {
	const data = { ...initial };
	return {
		data,
		getItem: (key) => data[key] ?? null,
		setItem: (key, value) => void (data[key] = value),
		removeItem: (key) => void delete data[key]
	};
}

const throwingStorage: ThemeStorage = {
	getItem() {
		throw new Error('denied');
	},
	setItem() {
		throw new Error('denied');
	},
	removeItem() {
		throw new Error('denied');
	}
};

describe('resolveTheme', () => {
	it('follows the system when the preference is system', () => {
		expect(resolveTheme('system', true)).toBe('dark');
		expect(resolveTheme('system', false)).toBe('light');
	});

	it('ignores the system for an explicit preference', () => {
		expect(resolveTheme('light', true)).toBe('light');
		expect(resolveTheme('dark', false)).toBe('dark');
	});
});

describe('readPreference', () => {
	it('defaults to system when nothing is stored', () => {
		expect(readPreference(memoryStorage())).toBe('system');
	});

	it('returns a stored valid preference', () => {
		expect(readPreference(memoryStorage({ theme: 'dark' }))).toBe('dark');
		expect(readPreference(memoryStorage({ theme: 'light' }))).toBe('light');
	});

	it('falls back to system for garbage values', () => {
		expect(readPreference(memoryStorage({ theme: 'sepia' }))).toBe('system');
	});

	it('falls back to system when storage throws or is missing', () => {
		expect(readPreference(throwingStorage)).toBe('system');
		expect(readPreference(undefined)).toBe('system');
	});
});

describe('writePreference', () => {
	it('stores light and dark under "theme"', () => {
		const storage = memoryStorage();
		expect(writePreference(storage, 'dark')).toBe(true);
		expect(storage.data.theme).toBe('dark');
	});

	it('clears the entry for system', () => {
		const storage = memoryStorage({ theme: 'dark' });
		expect(writePreference(storage, 'system')).toBe(true);
		expect(storage.data).toEqual({});
	});

	it('reports failure instead of throwing', () => {
		expect(writePreference(throwingStorage, 'light')).toBe(false);
		expect(writePreference(undefined, 'light')).toBe(false);
	});
});
