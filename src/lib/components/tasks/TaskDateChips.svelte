<script lang="ts">
	import { onMount } from 'svelte';
	import { startClock, viewer } from '#lib/client/clock.svelte.js';
	import { parseDueDate, parsePlannedDate } from '#lib/domain/dates.js';
	import {
		describeTaskDate,
		formatTaskDate,
		isOverdue,
		isToday
	} from '#lib/domain/date-display.js';
	import { parseRecurrence } from '#lib/domain/recurrence.js';
	import { describeRecurrence } from '#lib/domain/recurring-tasks.js';
	import type { SerializedTask } from '#lib/domain/tasks.js';
	import { m } from '#lib/paraglide/messages.js';

	/**
	 * Compact Planned/Due chips for a Task row: calendar icon + "Today 09:00", flag icon +
	 * "Due Fri", and a repeat icon for a recurring Task. An open Task's passed Due Date reads
	 * "Overdue …" on accent-pink. The labels depend on the browser's zone, so nothing renders until
	 * the clock has started after mount (no SSR mismatch).
	 */
	let { task }: { task: SerializedTask } = $props();

	onMount(startClock);

	const current = $derived(viewer());
	const planned = $derived(parsePlannedDate(task.planned));
	const due = $derived(parseDueDate(task.due));
	const repeats = $derived(task.recurrence && describeRecurrence(parseRecurrence(task.recurrence)));
	const overdue = $derived(!!current && !task.completedAt && isOverdue(due, current));

	function minutes(total: number): string {
		const hours = Math.floor(total / 60);
		const rest = total % 60;
		return [
			hours && m.date_duration_hours({ hours }),
			rest && m.date_duration_minutes({ minutes: rest })
		]
			.filter(Boolean)
			.join(' ');
	}
</script>

{#if current && (planned.kind !== 'unset' || due.kind !== 'unset')}
	<p class="chips">
		{#if planned.kind !== 'unset'}
			{@const full = describeTaskDate(planned, current)}
			<span
				class="chip"
				class:today={isToday(planned, current)}
				title={planned.kind === 'timed'
					? m.date_planned_title_duration({
							date: full,
							duration: minutes(planned.durationMinutes)
						})
					: m.date_planned_title({ date: full })}
			>
				<svg viewBox="0 0 24 24" aria-hidden="true">
					<rect x="4" y="5.5" width="16" height="14.5" rx="2" />
					<path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" />
				</svg>
				<span class="visually-hidden">{m.date_planned_label()}</span>
				{formatTaskDate(planned, current)}
			</span>
		{/if}
		{#if due.kind !== 'unset'}
			<span
				class="chip"
				class:today={isToday(due, current)}
				class:overdue
				title={overdue
					? m.date_overdue_title({ date: describeTaskDate(due, current) })
					: m.date_due_title({ date: describeTaskDate(due, current) })}
			>
				<svg viewBox="0 0 24 24" aria-hidden="true">
					<path d="M6 21V4M6 4.5h11l-2.5 4 2.5 4H6" />
				</svg>
				{overdue ? m.date_overdue() : m.date_due()}
				{formatTaskDate(due, current)}
			</span>
		{/if}
		{#if repeats}
			<span class="repeat" role="img" aria-label={repeats} title={repeats}>
				<svg viewBox="0 0 24 24" aria-hidden="true">
					<path d="M17 2.5l3 3-3 3" />
					<path d="M4 11.5v-1a5 5 0 0 1 5-5h11" />
					<path d="M7 21.5l-3-3 3-3" />
					<path d="M20 12.5v1a5 5 0 0 1-5 5H4" />
				</svg>
			</span>
		{/if}
	</p>
{/if}

<style>
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-2);
		margin-top: var(--space-1);
	}

	.chip {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
		padding: 0 var(--space-2) 0 0.375rem;
		min-height: 1.5rem;
		border: 1px solid var(--border);
		border-radius: 999px;
		color: var(--muted);
		font-size: 0.8125rem;
		line-height: 1.25;
		white-space: nowrap;
	}

	.chip.today {
		color: var(--fg);
		font-weight: 600;
	}

	/* Solid accent with --on-accent text: the pink alone is too light for text on light surfaces. */
	.chip.overdue {
		background: var(--accent-pink);
		border-color: var(--accent-pink);
		color: var(--on-accent);
		font-weight: 700;
	}

	.repeat {
		display: inline-flex;
		align-items: center;
		min-height: 1.5rem;
		color: var(--muted);
	}

	svg {
		flex: none;
		width: 0.875rem;
		height: 0.875rem;
		fill: none;
		stroke: currentColor;
		stroke-width: 2;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>
