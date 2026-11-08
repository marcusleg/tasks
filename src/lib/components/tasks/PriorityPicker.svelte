<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { getScopePrompt, ScopedTasks } from '#lib/client/occurrence-scope.svelte.js';
	import { getTaskStore } from '#lib/client/tasks.svelte.js';
	import type { Priority, SerializedTask } from '#lib/domain/tasks.js';
	import PriorityMarker from './PriorityMarker.svelte';
	import { priorityChoices, priorityLabel } from './priority.js';

	/**
	 * The Priority quick picker on a Task row: the marker as a button, opening a small menu of the
	 * levels. Without a Priority the button stays out of the way until the row is hovered or focused
	 * (always shown on touch screens). Esc or a click elsewhere closes the menu. A recurring Task (or
	 * a Subtask of one) asks which Occurrences the change applies to.
	 */
	let { task }: { task: SerializedTask } = $props();

	const scopes = new ScopedTasks(getScopePrompt(), getTaskStore());
	const id = $props.id();
	let open = $state(false);
	let root = $state<HTMLElement>();
	let button = $state<HTMLButtonElement>();

	const name = $derived(
		m.priority_picker_name({
			level: task.priority ? priorityLabel(task.priority) : m.priority_none()
		})
	);

	function close(restoreFocus = true) {
		open = false;
		if (restoreFocus) button?.focus();
	}

	async function choose(priority: Priority | null) {
		close();
		if (priority === task.priority) return;
		// Nothing to put back on cancel: the picker shows the Task's saved Priority.
		await scopes.update(task.id, { priority }, { discard: () => {} });
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
<div class="picker" class:unset={!task.priority} bind:this={root} {onkeydown}>
	<button
		bind:this={button}
		type="button"
		class="trigger"
		aria-label={name}
		title={name}
		aria-expanded={open}
		aria-controls="{id}-menu"
		onclick={() => (open = !open)}
	>
		<PriorityMarker priority={task.priority} size={18} />
	</button>
	<ul id="{id}-menu" aria-label={m.priority_label()} hidden={!open}>
		{#each priorityChoices() as choice (choice.label)}
			<li>
				<button
					type="button"
					aria-pressed={choice.value === task.priority}
					onclick={() => choose(choice.value)}
				>
					<PriorityMarker priority={choice.value} />
					{choice.label}
				</button>
			</li>
		{/each}
	</ul>
</div>

<style>
	.picker {
		position: relative;
		flex: none;
		align-self: flex-start;
		padding-top: var(--space-1);
	}

	.trigger {
		display: grid;
		place-items: center;
		width: 2.25rem;
		height: 2.25rem;
		padding: 0;
		background: none;
		border: none;
		border-radius: 50%;
	}

	.trigger:hover,
	.trigger[aria-expanded='true'] {
		background: var(--surface-hover);
	}

	/* No Priority: only show the button where it can be used without hunting for it. */
	@media (hover: hover) {
		.unset .trigger {
			opacity: 0;
		}

		:global(.task:hover) .unset .trigger,
		:global(.task.selected) .unset .trigger,
		.unset .trigger:focus-visible,
		.unset .trigger[aria-expanded='true'] {
			opacity: 1;
		}
	}

	ul {
		position: absolute;
		top: calc(100% - var(--space-1));
		right: 0;
		z-index: 10;
		min-width: 9rem;
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
		display: flex;
		align-items: center;
		gap: var(--space-3);
		width: 100%;
		padding: var(--space-2) var(--space-4);
		background: none;
		border: none;
		text-align: left;
	}

	li button:hover {
		background: var(--surface-hover);
	}

	li button[aria-pressed='true'] {
		font-weight: 700;
	}
</style>
