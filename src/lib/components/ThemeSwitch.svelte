<script lang="ts">
	import { onMount } from 'svelte';
	import {
		readPreference,
		resolveTheme,
		writePreference,
		type ThemePreference
	} from '#lib/theme.js';
	import { m } from '#lib/paraglide/messages.js';

	const options: { value: ThemePreference; label: () => string }[] = [
		{ value: 'system', label: m.shell_theme_system },
		{ value: 'light', label: m.shell_theme_light },
		{ value: 'dark', label: m.shell_theme_dark }
	];

	let preference = $state<ThemePreference>('system');

	function apply(pref: ThemePreference) {
		const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
		document.documentElement.dataset.theme = resolveTheme(pref, dark);
	}

	function choose(value: ThemePreference) {
		preference = value;
		try {
			writePreference(localStorage, value);
		} catch {
			// Storage can be blocked entirely; the choice still applies for this page.
		}
		apply(value);
	}

	onMount(() => {
		try {
			preference = readPreference(localStorage);
		} catch {
			preference = 'system';
		}
		const query = window.matchMedia('(prefers-color-scheme: dark)');
		const onChange = () => {
			if (preference === 'system') apply('system');
		};
		query.addEventListener('change', onChange);
		return () => query.removeEventListener('change', onChange);
	});
</script>

<div class="switch" role="radiogroup" aria-label={m.shell_theme()}>
	{#each options as option (option.value)}
		<label class:selected={preference === option.value}>
			<input
				type="radio"
				name="theme"
				value={option.value}
				checked={preference === option.value}
				onchange={() => choose(option.value)}
			/>
			<span>{option.label()}</span>
		</label>
	{/each}
</div>

<style>
	.switch {
		display: inline-flex;
		padding: 2px;
		gap: 2px;
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
	}

	label {
		position: relative;
		display: block;
		border-radius: var(--radius-sm);
		cursor: pointer;
	}

	input {
		position: absolute;
		inset: 0;
		margin: 0;
		opacity: 0;
		cursor: pointer;
	}

	span {
		display: block;
		padding: var(--space-1) var(--space-3);
		font-size: 0.8125rem;
		line-height: 1.25rem;
		color: var(--muted);
		border-radius: var(--radius-sm);
	}

	label:hover span {
		background: var(--surface-hover);
		color: var(--fg);
	}

	label.selected span {
		background: var(--accent-purple);
		color: var(--on-accent);
		font-weight: 700;
	}

	label:has(input:focus-visible) {
		outline: 2px solid var(--accent-pink);
		outline-offset: 2px;
	}

	@media (max-width: 480px) {
		span {
			padding: var(--space-1) var(--space-2);
		}
	}
</style>
