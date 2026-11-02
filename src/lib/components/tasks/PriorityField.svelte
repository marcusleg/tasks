<script lang="ts">
	import type { Priority } from '#lib/domain/tasks.js';
	import PriorityMarker from './PriorityMarker.svelte';
	import { PRIORITY_CHOICES } from './priority.js';

	/** The Priority picker in the detail panel: a segmented radio group, None/Low/Medium/High. */
	type Props = { value: Priority | null; onchange: (priority: Priority | null) => void };

	let { value, onchange }: Props = $props();

	const id = $props.id();
</script>

<fieldset class="priority">
	<legend class="label">Priority</legend>
	<div class="segments">
		{#each PRIORITY_CHOICES as choice (choice.label)}
			<label class="segment">
				<input
					type="radio"
					name="{id}-priority"
					checked={choice.value === value}
					onchange={() => onchange(choice.value)}
				/>
				{#if choice.value}<PriorityMarker priority={choice.value} size={14} />{/if}
				{choice.label}
			</label>
		{/each}
	</div>
</fieldset>

<style>
	.priority {
		min-width: 0;
		margin: 0;
		padding: 0;
		border: none;
	}

	.label {
		margin: 0 0 var(--space-2);
		padding: 0;
		color: var(--muted);
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.segments {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		overflow: hidden;
	}

	.segment {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-1);
		min-height: 2.75rem;
		padding: 0 var(--space-1);
		font-size: 0.875rem;
		cursor: pointer;
	}

	.segment + .segment {
		border-left: 1px solid var(--border);
	}

	.segment:hover {
		background: var(--surface-hover);
	}

	/* The radio stays in the accessibility tree and keyboard order, drawn as the segment. */
	input {
		position: absolute;
		inset: 0;
		margin: 0;
		opacity: 0;
		cursor: pointer;
	}

	.segment:has(input:checked) {
		background: var(--surface-hover);
		font-weight: 700;
		box-shadow: inset 0 -3px 0 var(--accent-purple);
	}

	.segment:has(input:focus-visible) {
		outline: 2px solid var(--accent-pink);
		outline-offset: -2px;
	}
</style>
