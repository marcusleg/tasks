<script lang="ts">
	import { hydration } from '#lib/client/hydration.svelte.js';
	import type { Snippet } from 'svelte';
	import { tick } from 'svelte';
	import ThemeSwitch from './ThemeSwitch.svelte';

	/**
	 * The header's compact user menu: an initial-in-a-circle button that opens a popover with the
	 * User's name, the theme switch and `actions` (e.g. Sign out). Esc or a click elsewhere closes
	 * it; Esc returns focus to the button.
	 */
	let { name, actions }: { name: string; actions?: Snippet } = $props();

	let open = $state(false);
	let root = $state<HTMLElement>();
	let button = $state<HTMLButtonElement>();
	let popover = $state<HTMLElement>();
	const id = $props.id();

	const initial = $derived([...name.trim()][0]?.toUpperCase() ?? '?');

	async function toggle() {
		open = !open;
		if (!open) return;
		await tick();
		// Into the menu: the selected theme option.
		popover?.querySelector<HTMLElement>('input:checked, button, a')?.focus();
	}

	function close(restoreFocus: boolean) {
		open = false;
		if (restoreFocus) button?.focus();
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && open) {
			event.preventDefault();
			event.stopPropagation();
			close(true);
		}
	}

	function onWindowPointerDown(event: PointerEvent) {
		if (open && root && !root.contains(event.target as Node)) close(false);
	}

	function onfocusout(event: FocusEvent) {
		const next = event.relatedTarget as Node | null;
		if (open && next && root && !root.contains(next)) close(false);
	}
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="user-menu" bind:this={root} {onkeydown} {onfocusout}>
	<button
		bind:this={button}
		type="button"
		class="trigger"
		disabled={!hydration.done}
		aria-label="User menu"
		aria-expanded={open}
		aria-controls="{id}-popover"
		onclick={toggle}
	>
		{initial}
	</button>
	<!-- Always mounted (just hidden), so the theme switch keeps following the system setting. -->
	<div
		id="{id}-popover"
		class="popover"
		bind:this={popover}
		role="group"
		aria-label="User"
		hidden={!open}
	>
		<p class="name">{name}</p>
		<div class="row">
			<span class="label">Theme</span>
			<ThemeSwitch />
		</div>
		{@render actions?.()}
	</div>
</div>

<style>
	.user-menu {
		position: relative;
	}

	.trigger {
		display: grid;
		place-items: center;
		width: 2.25rem;
		height: 2.25rem;
		padding: 0;
		background: var(--accent-purple);
		border: 2px solid transparent;
		border-radius: 50%;
		color: var(--on-accent);
		font-weight: 700;
	}

	.trigger[aria-expanded='true'] {
		border-color: var(--fg);
	}

	.popover {
		position: absolute;
		top: calc(100% + var(--space-2));
		right: 0;
		z-index: 40;
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		width: max-content;
		max-width: calc(100vw - 2 * var(--space-3));
		padding: var(--space-3);
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		box-shadow: 0 4px 16px var(--overlay);
	}

	.popover[hidden] {
		display: none;
	}

	.name {
		margin: 0;
		font-weight: 700;
		overflow-wrap: anywhere;
	}

	.row {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.label {
		font-size: 0.75rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--muted);
	}
</style>
