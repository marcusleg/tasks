<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { hydration } from '#lib/client/hydration.svelte.js';
	import type { Snippet } from 'svelte';
	import { getTaskDrag } from '#lib/client/task-drag.svelte.js';
	import { openTask, openTaskId } from '#lib/client/task-panel.js';
	import { getTaskStore } from '#lib/client/tasks.svelte.js';
	import type { SerializedTask } from '#lib/domain/tasks.js';
	import PriorityPicker from './PriorityPicker.svelte';
	import TaskDateChips from './TaskDateChips.svelte';

	type Props = {
		task: SerializedTask;
		/**
		 * Extra details under the Title and the Planned/Due chips. Subtasks (#7) render after the
		 * row, in the List.
		 */
		meta?: Snippet<[SerializedTask]>;
		/** At the end of the row, e.g. the toggle that collapses a parent's Subtasks. */
		trailing?: Snippet;
		/** Shows a drag handle (Custom Order, #11) when the page offers drag-and-drop. */
		reorderable?: boolean;
	};

	let { task, meta, trailing, reorderable = false }: Props = $props();

	const drag = getTaskDrag();
	const titleId = $props.id();
	const handle = $derived(reorderable && drag?.canDrag(task));

	const store = getTaskStore();
	const completed = $derived(task.completedAt !== null);
	const selected = $derived(openTaskId() === task.id);

	function toggle() {
		if (completed) store.reopen(task.id);
		else store.complete(task.id);
	}
</script>

<li
	class="task"
	class:completed
	class:selected
	class:drag-source={drag?.draggingId === task.id}
	data-task-id={task.id}
>
	{#if handle && drag}
		<button
			type="button"
			class="handle"
			data-task-handle
			disabled={!hydration.done}
			aria-label={m.task_move_handle()}
			aria-describedby="{titleId} task-move-hint"
			onpointerdown={(event) => drag.start(event, task)}
			onkeydown={(event) => drag.keydown(event, task)}
		>
			<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
				<path
					d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"
					stroke="currentColor"
					stroke-width="3"
					stroke-linecap="round"
				/>
			</svg>
		</button>
	{/if}
	<label class="check">
		<input
			type="checkbox"
			checked={completed}
			disabled={!hydration.done}
			onchange={toggle}
			aria-label={task.title}
		/>
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path
				d="M6 12.5l4 4 8-9"
				fill="none"
				stroke="currentColor"
				stroke-width="2.5"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
		</svg>
	</label>
	<div class="body">
		<button
			id={titleId}
			type="button"
			class="open"
			disabled={!hydration.done}
			aria-haspopup="dialog"
			aria-expanded={selected}
			onclick={() => openTask(task.id)}
		>
			{task.title}
		</button>
		{#if task.description}
			<p class="description">{task.description}</p>
		{/if}
		<TaskDateChips {task} />
		{@render meta?.(task)}
	</div>
	<PriorityPicker {task} />
	{@render trailing?.()}
</li>

<style>
	.task {
		position: relative;
		display: flex;
		align-items: flex-start;
		gap: var(--space-1);
		padding: 0 var(--space-2) 0 var(--space-1);
		border-radius: var(--radius-md);
	}

	.task:hover,
	.task.selected {
		background: var(--surface-hover);
	}

	.check {
		position: relative;
		display: grid;
		place-items: center;
		flex: none;
		width: 2.5rem;
		height: 2.75rem;
		cursor: pointer;
	}

	input {
		appearance: none;
		width: 1.25rem;
		height: 1.25rem;
		margin: 0;
		border: 2px solid var(--muted);
		border-radius: 50%;
		background: transparent;
		cursor: pointer;
	}

	.check:hover input {
		border-color: var(--accent-purple);
	}

	input:checked {
		border-color: var(--accent-purple);
		background: var(--accent-purple);
	}

	svg {
		position: absolute;
		width: 0.875rem;
		height: 0.875rem;
		color: var(--accent-purple);
		opacity: 0;
		pointer-events: none;
	}

	.check:hover svg {
		opacity: 0.6;
	}

	input:checked + svg {
		color: var(--on-accent);
		opacity: 1;
	}

	.body {
		flex: 1;
		min-width: 0;
		padding: var(--space-2) 0;
	}

	.open {
		display: block;
		width: 100%;
		min-height: 1.75rem;
		padding: 0.125rem 0;
		background: none;
		border: none;
		border-radius: var(--radius-sm);
		text-align: left;
		overflow-wrap: anywhere;
	}

	.description {
		display: -webkit-box;
		overflow: hidden;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		color: var(--muted);
		font-size: 0.875rem;
		white-space: pre-line;
		overflow-wrap: anywhere;
	}

	.completed .open {
		color: var(--muted);
		text-decoration: line-through;
	}

	/* Drag handle (#11): in the gutter left of the checkbox, shown on hover and focus, and always
	   on touch screens. Only the handle stops touch scrolling, so the List still scrolls. */
	.handle {
		position: absolute;
		top: 0;
		left: -0.375rem;
		display: grid;
		place-items: center;
		width: 1.125rem;
		height: 2.75rem;
		padding: 0;
		background: none;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--muted);
		cursor: grab;
		opacity: 0;
		touch-action: none;
	}

	.handle svg {
		position: static;
		width: 1rem;
		height: 1rem;
		color: inherit;
		opacity: 1;
	}

	.task:hover .handle,
	.handle:focus-visible {
		opacity: 1;
	}

	.handle:hover {
		color: var(--fg);
		background: var(--surface-hover);
	}

	@media (hover: none) {
		.handle {
			opacity: 1;
		}
	}

	.drag-source {
		opacity: 0.4;
	}

	/* While a Task is dragged, the rows it passes over aren't highlighted. */
	:global(html.task-dragging) .task:not(.selected):hover {
		background: none;
	}
</style>
