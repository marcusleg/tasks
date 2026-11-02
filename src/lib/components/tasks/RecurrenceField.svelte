<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { Temporal } from 'temporal-polyfill';
	import { getTaskStore } from '#lib/client/tasks.svelte.js';
	import {
		localDate,
		parseDueDate,
		parsePlannedDate,
		type DateOnly,
		type TimedDate
	} from '#lib/domain/dates.js';
	import {
		stepDriver,
		type Frequency,
		type SerializedRecurrence,
		type Weekday
	} from '#lib/domain/recurrence.js';
	import { hasDate, recurrenceConflict } from '#lib/domain/recurring-tasks.js';
	import type { SerializedTask } from '#lib/domain/tasks.js';

	/**
	 * The Recurrence editor of the detail panel: how often the Task repeats (every N days, weeks on
	 * chosen weekdays, months on a day, or years), when the series ends, and whether it counts from
	 * completion. Every change is saved at once. Unavailable, with a hint, while the Task has no
	 * date, is Completed, or when its parent or one of its Subtasks already repeats.
	 */
	let { task }: { task: SerializedTask } = $props();

	const store = getTaskStore();
	const id = $props.id();
	// The panel is keyed by Task id; a change can still be saved while it's closing.
	const taskId = untrack(() => task.id);

	const FREQUENCIES: { value: Frequency; label: string; unit: [string, string] }[] = [
		{ value: 'daily', label: 'Daily', unit: ['day', 'days'] },
		{ value: 'weekly', label: 'Weekly', unit: ['week', 'weeks'] },
		{ value: 'monthly', label: 'Monthly', unit: ['month', 'months'] },
		{ value: 'yearly', label: 'Yearly', unit: ['year', 'years'] }
	];
	const WEEKDAYS: { value: Weekday; short: string; name: string }[] = [
		{ value: 1, short: 'M', name: 'Monday' },
		{ value: 2, short: 'T', name: 'Tuesday' },
		{ value: 3, short: 'W', name: 'Wednesday' },
		{ value: 4, short: 'T', name: 'Thursday' },
		{ value: 5, short: 'F', name: 'Friday' },
		{ value: 6, short: 'S', name: 'Saturday' },
		{ value: 7, short: 'S', name: 'Sunday' }
	];
	const DEFAULT_COUNT = 5;

	// The yearly date is spelled out in the browser's locale, so only after hydration.
	let mounted = $state(false);
	onMount(() => (mounted = true));

	const rule = $derived(task.recurrence);
	const dates = $derived({ planned: parsePlannedDate(task.planned), due: parseDueDate(task.due) });
	/** The date the rule steps, whose weekday and day of month are the defaults. */
	const driver = $derived(
		hasDate(dates) ? localDate(dates[stepDriver(dates)] as DateOnly | TimedDate) : null
	);
	const family = $derived(
		task.parentId === null
			? store.subtasks(task.id)
			: [store.get(task.parentId)].filter((parent) => parent !== undefined)
	);
	const conflict = $derived(recurrenceConflict(task, family));
	const hint = $derived.by(() => {
		if (task.completedAt) return 'Reopen the task to change how it repeats.';
		if (conflict === 'parent-repeats') return 'The parent task repeats, so its subtasks can’t.';
		if (conflict === 'subtask-repeats') return 'A subtask repeats, so this task can’t.';
		if (!driver) return 'Set a planned or due date to repeat this task.';
		return null;
	});
	const disabled = $derived(hint !== null);
	const unit = $derived(
		rule && FREQUENCIES.find((frequency) => frequency.value === rule.frequency)!.unit
	);
	const yearlyOn = $derived(
		rule?.frequency === 'yearly' && driver && mounted
			? driver
					.with({ day: Math.min(rule.monthDay ?? driver.day, driver.daysInMonth) })
					.toLocaleString(undefined, { day: 'numeric', month: 'long' })
			: null
	);

	function save(next: SerializedRecurrence | null) {
		if (JSON.stringify(next) !== JSON.stringify(rule)) {
			void store.update(taskId, { recurrence: next });
		}
	}

	/** The rule with another frequency, with the driving date's weekday or day of month. */
	function withFrequency(frequency: Frequency): SerializedRecurrence {
		const base = {
			interval: rule?.interval ?? 1,
			end: rule?.end ?? { kind: 'never' as const },
			anchor: rule?.anchor ?? ('schedule' as const)
		};
		const day = driver ?? Temporal.Now.plainDateISO();
		switch (frequency) {
			case 'weekly':
				return { frequency, ...base, weekdays: [day.dayOfWeek as Weekday] };
			case 'monthly':
			case 'yearly':
				return { frequency, ...base, monthDay: day.day };
			default:
				return { frequency: 'daily', ...base };
		}
	}

	function onFrequencyChange(event: Event) {
		const value = (event.currentTarget as HTMLSelectElement).value;
		if (value === 'off') save(null);
		else if (value !== rule?.frequency) save(withFrequency(value as Frequency));
	}

	/** A whole number from `min` to `max` typed into `input`, or `null` (and the input reset). */
	function wholeNumber(input: HTMLInputElement, current: number, min: number, max = Infinity) {
		const value = Number(input.value);
		if (input.value === '' || !Number.isInteger(value) || value < min || value > max) {
			input.value = String(current);
			return null;
		}
		return value;
	}

	function onIntervalChange(event: Event) {
		if (!rule) return;
		const interval = wholeNumber(event.currentTarget as HTMLInputElement, rule.interval, 1, 999);
		if (interval !== null) save({ ...rule, interval });
	}

	function toggleWeekday(weekday: Weekday) {
		if (rule?.frequency !== 'weekly') return;
		const current = rule.weekdays ?? [];
		const weekdays = current.includes(weekday)
			? current.filter((day) => day !== weekday)
			: [...current, weekday].sort((a, b) => a - b);
		// At least one weekday stays chosen.
		if (weekdays.length > 0) save({ ...rule, weekdays });
	}

	function onMonthDayChange(event: Event) {
		if (rule?.frequency !== 'monthly') return;
		const current = rule.monthDay ?? driver?.day ?? 1;
		const monthDay = wholeNumber(event.currentTarget as HTMLInputElement, current, 1, 31);
		if (monthDay !== null) save({ ...rule, monthDay });
	}

	function onEndKindChange(event: Event) {
		if (!rule) return;
		const kind = (event.currentTarget as HTMLSelectElement).value;
		const from = driver ?? Temporal.Now.plainDateISO();
		if (kind === 'never') save({ ...rule, end: { kind } });
		if (kind === 'count') save({ ...rule, end: { kind, count: DEFAULT_COUNT } });
		if (kind === 'until') {
			save({ ...rule, end: { kind, date: from.add({ months: 3 }).toString() } });
		}
	}

	function onUntilChange(event: Event) {
		if (rule?.end.kind !== 'until') return;
		const input = event.currentTarget as HTMLInputElement;
		if (!input.value) {
			input.value = rule.end.date;
			return;
		}
		save({ ...rule, end: { kind: 'until', date: input.value } });
	}

	function onCountChange(event: Event) {
		if (rule?.end.kind !== 'count') return;
		const count = wholeNumber(event.currentTarget as HTMLInputElement, rule.end.count, 1, 9999);
		if (count !== null) save({ ...rule, end: { kind: 'count', count } });
	}

	function onAnchorChange(event: Event) {
		if (!rule) return;
		const checked = (event.currentTarget as HTMLInputElement).checked;
		save({ ...rule, anchor: checked ? 'completion' : 'schedule' });
	}
</script>

<div class="recurrence">
	<label class="label" for="{id}-frequency">Repeat</label>
	<select
		id="{id}-frequency"
		class="frequency"
		{disabled}
		value={rule?.frequency ?? 'off'}
		onchange={onFrequencyChange}
		aria-describedby={hint ? `${id}-hint` : undefined}
	>
		<option value="off">Doesn’t repeat</option>
		{#each FREQUENCIES as frequency (frequency.value)}
			<option value={frequency.value}>{frequency.label}</option>
		{/each}
	</select>

	{#if hint}
		<p id="{id}-hint" class="hint">{hint}</p>
	{/if}

	{#if rule && unit}
		<div class="row">
			<label for="{id}-interval">Every</label>
			<input
				id="{id}-interval"
				class="number"
				type="number"
				inputmode="numeric"
				min="1"
				max="999"
				{disabled}
				value={rule.interval}
				onchange={onIntervalChange}
			/>
			<span>{rule.interval === 1 ? unit[0] : unit[1]}</span>
		</div>

		{#if rule.frequency === 'weekly'}
			<div class="weekdays" role="group" aria-label="On these days">
				{#each WEEKDAYS as weekday (weekday.value)}
					<button
						type="button"
						class="weekday"
						aria-label={weekday.name}
						aria-pressed={rule.weekdays?.includes(weekday.value) ?? false}
						{disabled}
						onclick={() => toggleWeekday(weekday.value)}
					>
						{weekday.short}
					</button>
				{/each}
			</div>
		{:else if rule.frequency === 'monthly'}
			<div class="row">
				<label for="{id}-month-day">On day</label>
				<input
					id="{id}-month-day"
					class="number"
					type="number"
					inputmode="numeric"
					min="1"
					max="31"
					{disabled}
					value={rule.monthDay ?? driver?.day ?? 1}
					onchange={onMonthDayChange}
				/>
			</div>
			{#if (rule.monthDay ?? 0) > 28}
				<p class="note">In shorter months, on the last day.</p>
			{/if}
		{:else if yearlyOn}
			<p class="note">On {yearlyOn} each year.</p>
		{/if}

		<div class="row">
			<label for="{id}-end">Ends</label>
			<select id="{id}-end" {disabled} value={rule.end.kind} onchange={onEndKindChange}>
				<option value="never">Never</option>
				<option value="until">On a date</option>
				<option value="count">After a number of times</option>
			</select>
		</div>
		{#if rule.end.kind === 'until'}
			<div class="row">
				<label for="{id}-until">Last date</label>
				<input
					id="{id}-until"
					type="date"
					{disabled}
					value={rule.end.date}
					onchange={onUntilChange}
				/>
			</div>
		{:else if rule.end.kind === 'count'}
			<div class="row">
				<label for="{id}-count">After</label>
				<input
					id="{id}-count"
					class="number"
					type="number"
					inputmode="numeric"
					min="1"
					{disabled}
					value={rule.end.count}
					onchange={onCountChange}
				/>
				<span>{rule.end.count === 1 ? 'time' : 'times'}</span>
			</div>
		{/if}

		<label class="anchor">
			<input
				type="checkbox"
				{disabled}
				checked={rule.anchor === 'completion'}
				onchange={onAnchorChange}
			/>
			<span>
				Repeat after completion
				<span class="note">Count from when it’s completed, not from its date.</span>
			</span>
		</label>
	{/if}
</div>

<style>
	.recurrence {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		min-width: 0;
	}

	.label {
		color: var(--muted);
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	select,
	input[type='number'],
	input[type='date'] {
		min-height: 2.75rem;
		padding: var(--space-2) var(--space-3);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
	}

	select:focus,
	input:focus {
		outline: none;
		border-color: var(--accent-purple);
	}

	select:disabled,
	input:disabled,
	button:disabled {
		opacity: 0.55;
		cursor: not-allowed;
	}

	.frequency {
		width: 100%;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2);
		font-size: 0.875rem;
	}

	.row > label {
		min-width: 4.5rem;
		color: var(--muted);
	}

	.row select,
	.row input[type='date'] {
		flex: 1 1 10rem;
		min-width: 0;
	}

	.number {
		width: 5rem;
	}

	.weekdays {
		display: grid;
		grid-template-columns: repeat(7, minmax(0, 1fr));
		gap: var(--space-1);
	}

	.weekday {
		min-height: 2.75rem;
		padding: 0;
		background: transparent;
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		font-size: 0.875rem;
		font-weight: 600;
	}

	.weekday:hover:not(:disabled) {
		background: var(--surface-hover);
	}

	.weekday[aria-pressed='true'] {
		background: var(--accent-purple);
		border-color: var(--accent-purple);
		color: var(--on-accent);
	}

	.anchor {
		display: flex;
		align-items: flex-start;
		gap: var(--space-3);
		font-size: 0.875rem;
		cursor: pointer;
	}

	.anchor input {
		flex: none;
		width: 1.125rem;
		height: 1.125rem;
		margin: 0.125rem 0 0;
		accent-color: var(--accent-purple);
	}

	.anchor .note {
		display: block;
		margin-top: 0.125rem;
	}

	.hint,
	.note {
		color: var(--muted);
		font-size: 0.8125rem;
	}
</style>
