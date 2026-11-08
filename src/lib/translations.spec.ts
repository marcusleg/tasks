import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The message files' rules (README → Translations). Paraglide silently falls back to English for
 * a message missing in another language, so this is what makes CI fail instead.
 */

/** Each area of the app keeps its messages under its own prefix. */
const KEY_PREFIXES = [
	'api_error_',
	'auth_',
	'confirm_',
	'date_',
	'default_list_',
	'error_page_',
	'feed_',
	'list_',
	'priority_',
	'recurrence_',
	'scope_',
	'settings_',
	'shell_',
	'sort_',
	'subtask_',
	'task_',
	'toast_'
];

type Catalog = Record<string, unknown>;

/** What's wrong with a set of message files, one line per problem; empty when all is well. */
function checkCatalogs(base: string, catalogs: Record<string, Catalog>): string[] {
	const problems: string[] = [];
	const keysOf = (catalog: Catalog) => Object.keys(catalog).filter((key) => key !== '$schema');
	const baseCatalog = catalogs[base];
	const baseKeys = keysOf(baseCatalog);

	for (const [language, catalog] of Object.entries(catalogs)) {
		const keys = keysOf(catalog);
		const sorted = [...keys].sort();
		const unsorted = keys.findIndex((key, i) => key !== sorted[i]);
		if (unsorted !== -1) {
			problems.push(`${language}: keys are not sorted, "${keys[unsorted]}" is out of place`);
		}

		for (const key of keys) {
			if (!KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
				problems.push(`${language}: "${key}" has none of the area prefixes`);
			}
			if (!/^[a-z][a-z0-9_]*$/.test(key)) {
				problems.push(`${language}: "${key}" is not snake_case`);
			}
			const value = catalog[key];
			if (!(typeof value === 'string' ? value.trim() : Array.isArray(value) && value.length)) {
				problems.push(`${language}: "${key}" is empty`);
			}
			if (language !== base && !(key in baseCatalog)) {
				problems.push(`${language}: "${key}" is not in ${base}`);
			}
		}

		if (language === base) continue;
		for (const key of baseKeys) {
			if (!(key in catalog)) {
				problems.push(`${language}: "${key}" is missing`);
				continue;
			}
			const expected = [...variables(baseCatalog[key])].sort().join(', ');
			const actual = [...variables(catalog[key])].sort().join(', ');
			if (actual !== expected) {
				problems.push(`${language}: "${key}" uses {${actual}}, ${base} uses {${expected}}`);
			}
		}
	}
	return problems;
}

/** The `{name}` placeholders and `input name` declarations anywhere in a message. */
function variables(message: unknown, found = new Set<string>()): Set<string> {
	if (typeof message === 'string') {
		for (const [, name] of message.matchAll(/(?:^|[^\\])\{(\w+)\}/g)) found.add(name);
		for (const [, name] of message.matchAll(/^input (\w+)$/g)) found.add(name);
	} else if (message && typeof message === 'object') {
		for (const value of Object.values(message)) variables(value, found);
	}
	return found;
}

describe('message files', () => {
	const root = process.cwd();
	const settings = JSON.parse(readFileSync(join(root, 'project.inlang/settings.json'), 'utf8'));
	const catalogs: Record<string, Catalog> = Object.fromEntries(
		(settings.locales as string[]).map((language) => [
			language,
			JSON.parse(readFileSync(join(root, 'messages', `${language}.json`), 'utf8'))
		])
	);

	it('have one file per Language, and no others', () => {
		expect(readdirSync(join(root, 'messages')).sort()).toEqual(
			(settings.locales as string[]).map((language) => `${language}.json`).sort()
		);
	});

	it('have every message in every Language, sorted, prefixed and with the same placeholders', () => {
		expect(checkCatalogs(settings.baseLocale, catalogs)).toEqual([]);
	});
});

describe('checkCatalogs', () => {
	const en = { $schema: 'x', shell_a: 'A', shell_b: 'Hi {name}' };

	it('accepts matching catalogs', () => {
		expect(checkCatalogs('en', { en, de: { shell_a: 'A', shell_b: 'Hallo {name}' } })).toEqual([]);
	});

	it('fails when a German message is missing', () => {
		expect(checkCatalogs('en', { en, de: { shell_a: 'A' } })).toEqual(['de: "shell_b" is missing']);
	});

	it('fails on a message only German has, or an empty one', () => {
		expect(
			checkCatalogs('en', { en, de: { shell_a: ' ', shell_b: 'Hallo {name}', shell_c: 'C' } })
		).toEqual(['de: "shell_a" is empty', 'de: "shell_c" is not in en']);
	});

	it('fails on a different placeholder', () => {
		expect(checkCatalogs('en', { en, de: { shell_a: 'A', shell_b: 'Hallo {nam}' } })).toEqual([
			'de: "shell_b" uses {nam}, en uses {name}'
		]);
	});

	it('fails on unsorted keys, unknown prefixes and other casing', () => {
		expect(checkCatalogs('en', { en: { shell_b: 'B', shell_a: 'A', misc_x: 'X' } })).toEqual([
			'en: keys are not sorted, "shell_b" is out of place',
			'en: "misc_x" has none of the area prefixes'
		]);
		expect(checkCatalogs('en', { en: { shell_A: 'A' } })).toEqual([
			'en: "shell_A" is not snake_case'
		]);
	});

	it('compares the inputs of plural messages', () => {
		const plural = (one: string, other: string, input = 'count') => [
			{
				declarations: [`input ${input}`, `local countPlural = ${input}: plural`],
				selectors: ['countPlural'],
				match: { 'countPlural=one': one, 'countPlural=*': other }
			}
		];
		expect(
			checkCatalogs('en', {
				en: { task_n: plural('{count} task', '{count} tasks') },
				de: { task_n: plural('{count} Aufgabe', '{count} Aufgaben') }
			})
		).toEqual([]);
		expect(
			checkCatalogs('en', {
				en: { task_n: plural('{count} task', '{count} tasks') },
				de: { task_n: plural('{n} Aufgabe', '{n} Aufgaben', 'n') }
			})
		).toEqual(['de: "task_n" uses {n}, en uses {count}']);
	});
});
