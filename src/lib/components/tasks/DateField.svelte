<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import { Temporal } from 'temporal-polyfill';
	import {
		DEFAULT_DURATION_MINUTES,
		dateOnly,
		parseDueDate,
		parsePlannedDate,
		serializeDueDate,
		serializePlannedDate,
		timedDueDate,
		timedPlannedDate,
		type SerializedDueDate,
		type SerializedPlannedDate,
		type TimedPlannedDate
	} from '#lib/domain/dates.js';
	import { viewerDateTime } from '#lib/domain/date-display.js';

	/**
	 * Editor for a Planned Date or a Due Date: unset, a date, or a date and time (Planned adds a
	 * Duration). Native date/time inputs give accessible pickers on every platform; Today/Tomorrow
	 * are quick picks.
	 *
	 * The inputs show a timed value in the browser's zone (`timeZone`). Changing the date or time
	 * saves it with that zone; changing only the Duration keeps the stored date-time and zone.
	 * Typed dates fire `change` per segment, so typing is saved after a short pause or on blur.
	 */
	type Value = SerializedPlannedDate | SerializedDueDate;
	type Props = {
		kind: 'planned' | 'due';
		/** The group's name, e.g. "Planned date". */
		label: string;
		value: Value;
		/** The browser's IANA zone, from the clock. */
		timeZone: string;
		onchange: (value: Value) => void;
	};

	let { kind, label, value, timeZone, onchange }: Props = $props();

	const id = $props.id();
	const TYPING_DELAY_MS = 600;
	const DEFAULT_TIME = '09:00';

	const parsed = $derived(kind === 'planned' ? parsePlannedDate(value) : parseDueDate(value));
	const local = $derived(parsed.kind === 'timed' ? viewerDateTime(parsed, timeZone) : null);
	const dateText = $derived(
		parsed.kind === 'unset'
			? ''
			: parsed.kind === 'date'
				? parsed.date.toString()
				: local!.toPlainDate().toString()
	);
	const timeText = $derived(local ? local.toPlainTime().toString({ smallestUnit: 'minute' }) : '');
	const timed = $derived(parsed.kind === 'timed');
	const durationMinutes: number = $derived(
		parsed.kind === 'timed' && kind === 'planned'
			? (parsed as TimedPlannedDate).durationMinutes
			: DEFAULT_DURATION_MINUTES
	);
	/** Where a timed value was set, when that's not here, with its time there. */
	const elsewhere = $derived(
		parsed.kind === 'timed' && parsed.timeZone !== timeZone
			? `Set in ${parsed.timeZone.replaceAll('_', ' ')}: ${parsed.dateTime.toPlainTime().toString({ smallestUnit: 'minute' })} there`
			: null
	);

	let dateInput = $state<HTMLInputElement>();
	let timeInput = $state<HTMLInputElement>();
	let typingTimer: ReturnType<typeof setTimeout> | undefined;
	/**
	 * The last value seen. A pending edit can be saved while the panel is closing, when the props
	 * are no longer readable.
	 */
	let known = untrack(() => value);
	$effect.pre(() => {
		known = value;
	});
	/** What was typed but not saved yet. */
	let pending: Value | null = null;

	/** The value for a date (and time) entered here, in this browser's zone; null if invalid. */
	function build(date: string, time: string | null): Value | null {
		try {
			if (time === null) return serializeDueDate(dateOnly(date));
			const dateTime = `${date}T${time}`;
			return kind === 'planned'
				? serializePlannedDate(timedPlannedDate(dateTime, timeZone, durationMinutes))
				: serializeDueDate(timedDueDate(dateTime, timeZone));
		} catch {
			return null;
		}
	}

	function save(next: Value | null) {
		clearTimeout(typingTimer);
		typingTimer = undefined;
		pending = null;
		if (next !== null && JSON.stringify(next) !== JSON.stringify(known)) onchange(next);
	}

	/**
	 * The value typed into the date/time inputs, or null while it's incomplete or unchanged (an
	 * untouched timed value shown in another zone must not be re-saved with this zone).
	 */
	function typedValue(): Value | null {
		const date = dateInput?.value ?? '';
		const time = timed ? (timeInput?.value ?? '') : null;
		if (!date || time === '') return null;
		if (date === dateText && (time ?? '') === timeText) return null;
		return build(date, time);
	}

	function onTyped() {
		clearTimeout(typingTimer);
		pending = typedValue();
		if (pending) typingTimer = setTimeout(() => save(pending), TYPING_DELAY_MS);
	}

	/** On blur, saves what's complete and shows the stored value again if the input was left empty. */
	function onBlur(event: FocusEvent) {
		// The inputs may already be empty or reverted when the panel is closing.
		save(typedValue() ?? pending);
		const input = event.currentTarget as HTMLInputElement;
		if (!input.value) input.value = input === timeInput ? timeText : dateText;
	}

	// Closing the panel mid-pause still saves what was typed.
	onDestroy(() => {
		if (pending) save(pending);
	});

	function pick(days: number) {
		const date = Temporal.Now.plainDateISO(timeZone).add({ days }).toString();
		save(build(date, timed ? timeText : null));
	}

	function addTime() {
		save(build(dateText || Temporal.Now.plainDateISO(timeZone).toString(), DEFAULT_TIME));
	}

	function removeTime() {
		save(build(dateText, null));
	}

	function clear() {
		clearTimeout(typingTimer);
		typingTimer = undefined;
		if (value !== null) onchange(null);
	}

	function onDurationChange(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const minutes = Number(input.value);
		if (parsed.kind !== 'timed' || !Number.isInteger(minutes) || minutes <= 0) {
			input.value = String(durationMinutes);
			return;
		}
		// Only the Duration changes: the start keeps its stored date-time and zone.
		const start = value as Extract<SerializedPlannedDate, { kind: 'timed' }>;
		if (minutes !== durationMinutes) onchange({ ...start, durationMinutes: minutes });
	}
</script>

<!-- A group named by its heading (a <legend> couldn't share its row with the Clear button). -->
<div class="date-field" role="group" aria-labelledby="{id}-label">
	<div class="label-row">
		<h3 id="{id}-label" class="label">{label}</h3>
		{#if parsed.kind !== 'unset'}
			<button
				type="button"
				class="link-button"
				aria-label="Clear {label.toLowerCase()}"
				onclick={clear}
			>
				Clear
			</button>
		{/if}
	</div>

	<div class="inputs">
		<label class="visually-hidden" for="{id}-date">Date</label>
		<input
			bind:this={dateInput}
			id="{id}-date"
			type="date"
			value={dateText}
			onchange={onTyped}
			onblur={onBlur}
		/>
		{#if timed}
			<label class="visually-hidden" for="{id}-time">Time</label>
			<input
				bind:this={timeInput}
				id="{id}-time"
				type="time"
				value={timeText}
				onchange={onTyped}
				onblur={onBlur}
			/>
		{/if}
	</div>

	<div class="actions">
		<button type="button" class="pill" onclick={() => pick(0)}>Today</button>
		<button type="button" class="pill" onclick={() => pick(1)}>Tomorrow</button>
		{#if timed}
			<button type="button" class="pill" onclick={removeTime}>Remove time</button>
		{:else if parsed.kind !== 'unset'}
			<button type="button" class="pill" onclick={addTime}>Add time</button>
		{/if}
	</div>

	{#if timed && kind === 'planned'}
		<div class="duration">
			<label for="{id}-duration">Duration</label>
			<input
				id="{id}-duration"
				type="number"
				inputmode="numeric"
				min="1"
				step="5"
				value={durationMinutes}
				onchange={onDurationChange}
			/>
			<span aria-hidden="true">min</span>
		</div>
	{/if}

	{#if elsewhere}
		<p class="note">{elsewhere}</p>
	{/if}
</div>

<style>
	.date-field {
		min-width: 0;
	}

	.label-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		min-height: 2rem;
		margin-bottom: var(--space-1);
	}

	.label {
		color: var(--muted);
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
	}

	.link-button {
		padding: var(--space-1) var(--space-2);
		background: none;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--accent-purple);
		font-size: 0.875rem;
	}

	.link-button:hover {
		background: var(--surface-hover);
	}

	.inputs {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	input {
		min-height: 2.75rem;
		padding: var(--space-2) var(--space-3);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
	}

	input[type='date'] {
		flex: 1 1 10rem;
		min-width: 0;
	}

	input[type='time'] {
		flex: none;
	}

	input:focus {
		outline: none;
		border-color: var(--accent-purple);
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}

	.pill {
		min-height: 2.25rem;
		padding: var(--space-1) var(--space-3);
		background: transparent;
		border: 1px solid var(--border);
		border-radius: 999px;
		font-size: 0.875rem;
	}

	.pill:hover {
		background: var(--surface-hover);
	}

	.duration {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		margin-top: var(--space-3);
		font-size: 0.875rem;
	}

	.duration label {
		color: var(--muted);
	}

	.duration input {
		width: 5.5rem;
	}

	.note {
		margin-top: var(--space-2);
		color: var(--muted);
		font-size: 0.8125rem;
	}
</style>
