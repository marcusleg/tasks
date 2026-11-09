<script lang="ts">
	import { hydration } from '#lib/client/hydration.svelte.js';
	/**
	 * The List header's options menu: a disclosure button and a short list of actions. Esc or a
	 * click elsewhere closes it, returning focus to the button.
	 */
	type Action = { label: string; onSelect: () => void; disabled?: boolean; danger?: boolean };

	/** A group of exclusive choices (e.g. Sort by), the current one marked. */
	type Choices = {
		label: string;
		value: string;
		options: { value: string; label: string }[];
		onSelect: (value: string) => void;
	};

	let { label, actions, sort }: { label: string; actions: Action[]; sort?: Choices } = $props();

	let open = $state(false);
	let root = $state<HTMLElement>();
	let button = $state<HTMLButtonElement>();
	const id = $props.id();

	function close(restoreFocus = true) {
		open = false;
		if (restoreFocus) button?.focus();
	}

	function select(action: Action) {
		close(false);
		action.onSelect();
	}

	function onWindowPointerDown(event: PointerEvent) {
		if (open && root && !root.contains(event.target as Node)) close(false);
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && open) {
			event.stopPropagation();
			close();
		}
	}
</script>

<svelte:window onpointerdown={onWindowPointerDown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="menu" bind:this={root} {onkeydown}>
	<button
		bind:this={button}
		type="button"
		class="trigger"
		disabled={!hydration.done}
		aria-label={label}
		aria-expanded={open}
		aria-controls="{id}-menu"
		onclick={() => (open = !open)}
	>
		<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
			<circle cx="12" cy="5" r="1.75" fill="currentColor" />
			<circle cx="12" cy="12" r="1.75" fill="currentColor" />
			<circle cx="12" cy="19" r="1.75" fill="currentColor" />
		</svg>
	</button>
	<ul id="{id}-menu" hidden={!open}>
		{#if sort}
			<li role="presentation">
				<div role="group" aria-label={sort.label}>
					<p class="group-label" aria-hidden="true">{sort.label}</p>
					{#each sort.options as option (option.value)}
						<button
							type="button"
							class="choice"
							aria-pressed={option.value === sort.value}
							onclick={() => {
								close(false);
								if (option.value !== sort.value) sort.onSelect(option.value);
							}}
						>
							<span class="check" aria-hidden="true">{option.value === sort.value ? '✓' : ''}</span>
							{option.label}
						</button>
					{/each}
				</div>
			</li>
			<li role="presentation" class="separator"></li>
		{/if}
		{#each actions as action (action.label)}
			<li>
				<button
					type="button"
					class:danger={action.danger}
					disabled={action.disabled}
					onclick={() => select(action)}
				>
					{action.label}
				</button>
			</li>
		{/each}
	</ul>
</div>

<style>
	.menu {
		position: relative;
		/* Lines its icon up with the rows' trailing icons, as far in as the leading ones. */
		margin-right: calc(-1 * var(--space-1));
	}

	.trigger {
		display: grid;
		place-items: center;
		width: 2.5rem;
		height: 2.5rem;
		padding: 0;
		background: none;
		border: none;
		border-radius: 50%;
		color: var(--muted);
	}

	.trigger:hover,
	.trigger[aria-expanded='true'] {
		background: var(--surface-hover);
		color: var(--fg);
	}

	ul {
		position: absolute;
		top: calc(100% + var(--space-1));
		right: 0;
		z-index: 10;
		min-width: 13rem;
		margin: 0;
		padding: var(--space-1) 0;
		list-style: none;
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
	}

	ul[hidden] {
		display: none;
	}

	li button {
		display: block;
		width: 100%;
		padding: var(--space-2) var(--space-4);
		background: none;
		border: none;
		text-align: left;
	}

	li button:hover:not(:disabled) {
		background: var(--surface-hover);
	}

	li button:disabled {
		color: var(--muted);
		cursor: default;
	}

	.group-label {
		margin: 0;
		padding: var(--space-1) var(--space-4);
		color: var(--muted);
		font-size: 0.75rem;
		font-weight: 700;
		text-transform: uppercase;
	}

	.choice {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.check {
		width: 1em;
		color: var(--accent-purple);
	}

	.separator {
		margin: var(--space-1) 0;
		border-top: 1px solid var(--border);
	}

	li button.danger:not(:disabled) {
		color: var(--accent-pink);
	}
</style>
