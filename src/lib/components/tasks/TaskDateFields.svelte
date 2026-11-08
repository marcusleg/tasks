<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { startClock, viewer, viewerTimeZone } from '#lib/client/clock.svelte.js';
	import type { ScopedTasks } from '#lib/client/occurrence-scope.svelte.js';
	import {
		parseDueDate,
		parsePlannedDate,
		type SerializedDueDate,
		type SerializedPlannedDate
	} from '#lib/domain/dates.js';
	import { isPlannedAfterDue } from '#lib/domain/date-display.js';
	import type { SerializedTask } from '#lib/domain/tasks.js';
	import { m } from '#lib/paraglide/messages.js';
	import DateField from './DateField.svelte';

	/**
	 * The Planned Date and Due Date editors of the detail panel, with a non-blocking warning when
	 * Planned falls after Due. Rendered after mount only: the inputs show times in the browser's
	 * zone, which the server doesn't know.
	 *
	 * `scopes` (the panel's) asks which Occurrences of a recurring Task a change applies to; if
	 * cancelled, the fields show the saved dates again. Typed dates are saved on blur only while a
	 * change would still ask first.
	 */
	type Props = {
		task: SerializedTask;
		scopes: ScopedTasks;
	};

	let { task, scopes }: Props = $props();

	// The panel is keyed by Task id; a pending date can still be saved while it's closing.
	const taskId = untrack(() => task.id);
	onMount(startClock);

	const ready = $derived(viewer() !== null);
	const timeZone = $derived(viewerTimeZone());
	/** Bumped when a change is cancelled, so the fields show the saved dates again. */
	let revision = $state(0);

	const asksFirst = $derived(scopes.unanswered(taskId, 'dates'));

	function change(patch: { planned?: SerializedPlannedDate; due?: SerializedDueDate }) {
		return scopes.update(taskId, patch, { group: 'dates', discard: () => revision++ });
	}

	const plannedAfterDue = $derived(
		isPlannedAfterDue(parsePlannedDate(task.planned), parseDueDate(task.due), timeZone)
	);
</script>

{#if ready}
	<div class="dates">
		{#key revision}
			<DateField
				kind="planned"
				label={m.date_field_planned()}
				clearLabel={m.date_clear_planned()}
				value={task.planned}
				{timeZone}
				deferTyped={asksFirst}
				onchange={(planned) => change({ planned: planned as SerializedPlannedDate })}
			/>
			<DateField
				kind="due"
				label={m.date_field_due()}
				clearLabel={m.date_clear_due()}
				value={task.due}
				{timeZone}
				deferTyped={asksFirst}
				onchange={(due) => change({ due: due as SerializedDueDate })}
			/>
		{/key}
		{#if plannedAfterDue}
			<p class="warning" role="status">
				<svg viewBox="0 0 24 24" aria-hidden="true">
					<path d="M12 3.5L2.5 20h19L12 3.5z" />
					<path d="M12 10v4.5M12 17.25v.25" />
				</svg>
				{m.date_planned_after_due()}
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
