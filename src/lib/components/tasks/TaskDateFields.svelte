<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { startClock, viewer, viewerTimeZone } from '#lib/client/clock.svelte.js';
	import { getTaskStore } from '#lib/client/tasks.svelte.js';
	import {
		parseDueDate,
		parsePlannedDate,
		type SerializedDueDate,
		type SerializedPlannedDate
	} from '#lib/domain/dates.js';
	import { isPlannedAfterDue } from '#lib/domain/date-display.js';
	import type { SerializedTask } from '#lib/domain/tasks.js';
	import DateField from './DateField.svelte';

	/**
	 * The Planned Date and Due Date editors of the detail panel, with a non-blocking warning when
	 * Planned falls after Due. Rendered after mount only: the inputs show times in the browser's
	 * zone, which the server doesn't know.
	 */
	let { task }: { task: SerializedTask } = $props();

	const store = getTaskStore();
	// The panel is keyed by Task id; a pending date can still be saved while it's closing.
	const taskId = untrack(() => task.id);
	onMount(startClock);

	const ready = $derived(viewer() !== null);
	const timeZone = $derived(viewerTimeZone());
	const plannedAfterDue = $derived(
		isPlannedAfterDue(parsePlannedDate(task.planned), parseDueDate(task.due), timeZone)
	);
</script>

{#if ready}
	<div class="dates">
		<DateField
			kind="planned"
			label="Planned date"
			value={task.planned}
			{timeZone}
			onchange={(planned) => store.update(taskId, { planned: planned as SerializedPlannedDate })}
		/>
		<DateField
			kind="due"
			label="Due date"
			value={task.due}
			{timeZone}
			onchange={(due) => store.update(taskId, { due: due as SerializedDueDate })}
		/>
		{#if plannedAfterDue}
			<p class="warning" role="status">
				<svg viewBox="0 0 24 24" aria-hidden="true">
					<path d="M12 3.5L2.5 20h19L12 3.5z" />
					<path d="M12 10v4.5M12 17.25v.25" />
				</svg>
				The planned date is after the due date.
			</p>
		{/if}
	</div>
{/if}

<style>
	.dates {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	.warning {
		display: flex;
		align-items: flex-start;
		gap: var(--space-2);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--border);
		border-left: 4px solid var(--accent-orange);
		border-radius: var(--radius-md);
		font-size: 0.875rem;
	}

	svg {
		flex: none;
		width: 1.125rem;
		height: 1.125rem;
		margin-top: 0.0625rem;
		fill: none;
		stroke: var(--accent-orange);
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>
