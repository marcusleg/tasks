export type ThemePreference = 'system' | 'light' | 'dark';
export type EffectiveTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'theme';
export const THEME_PREFERENCES: readonly ThemePreference[] = ['system', 'light', 'dark'];

/** Minimal slice of `Storage` so tests (and failing storages) are easy to fake. */
export type ThemeStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function isThemePreference(value: unknown): value is ThemePreference {
	return THEME_PREFERENCES.includes(value as ThemePreference);
}

/** The theme to paint for a preference, given whether the OS currently prefers dark. */
export function resolveTheme(
	preference: ThemePreference,
	systemPrefersDark: boolean
): EffectiveTheme {
	if (preference === 'system') return systemPrefersDark ? 'dark' : 'light';
	return preference;
}

/** Stored preference, or 'system' when nothing valid is stored or storage is unavailable. */
export function readPreference(storage: ThemeStorage | undefined): ThemePreference {
	try {
		const value = storage?.getItem(THEME_STORAGE_KEY);
		return isThemePreference(value) ? value : 'system';
	} catch {
		return 'system';
	}
}

/** Persists the preference; returns false when storage refused it. */
export function writePreference(
	storage: ThemeStorage | undefined,
	preference: ThemePreference
): boolean {
	try {
		if (!storage) return false;
		if (preference === 'system') storage.removeItem(THEME_STORAGE_KEY);
		else storage.setItem(THEME_STORAGE_KEY, preference);
		return true;
	} catch {
		return false;
	}
}
