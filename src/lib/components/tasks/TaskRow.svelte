<script lang="ts">
	import type { Snippet } from 'svelte';
	import { openTask, openTaskId } from '#lib/client/task-panel.js';
	import { getTaskStore } from '#lib/client/tasks.svelte.js';
	import type { SerializedTask } from '#lib/domain/tasks.js';

	type Props = {
		task: SerializedTask;
		/**
		 * Extra details under the Title, e.g. Planned/Due chips (#8) or the Priority marker (#9).
		 * Subtasks (#7) render after the row, in the List.
		 */
		meta?: Snippet<[SerializedTask]>;
		/** At the end of the row, e.g. the toggle that collapses a parent's Subtasks. */
		trailing?: Snippet;
	};

	let { task, meta, trailing }: Props = $props();

	const store = getTaskStore();
	const completed = $derived(task.completedAt !== null);
	const selected = $derived(openTaskId() === task.id);

	function toggle() {
		if (completed) store.reopen(task.id);
		else store.complete(task.id);
	}
</script>

<li class="task" class:completed class:selected data-task-id={task.id}>
	<label class="check">
		<input type="checkbox" checked={completed} onchange={toggle} aria-label={task.title} />
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
			type="button"
			class="open"
			aria-haspopup="dialog"
			aria-expanded={selected}
			onclick={() => openTask(task.id)}
		>
			{task.title}
		</button>
		{#if task.description}
			<p class="description">{task.description}</p>
		{/if}
		{@render meta?.(task)}
	</div>
	{@render trailing?.()}
</li>

<style>
	.task {
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
</style>
