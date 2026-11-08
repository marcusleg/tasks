<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { hydration } from '#lib/client/hydration.svelte.js';
	import { onDestroy, tick } from 'svelte';
	import { dateLocale, viewerTimeZone } from '#lib/client/clock.svelte.js';
	import { getListStore } from '#lib/client/lists.svelte.js';
	import { closeTask, openTaskId } from '#lib/client/task-panel.js';
	import { setTaskStore, TaskStore } from '#lib/client/tasks.svelte.js';
	import { httpTaskPort } from '#lib/client/task-port.http.js';
	import { getToasts } from '#lib/client/toasts.svelte.js';
	import { priorityGroup } from '#lib/domain/priority-view.js';
	import { PRIORITIES, type Priority, type SerializedTask } from '#lib/domain/tasks.js';
	import Column from './Column.svelte';
	import { priorityEmptyText, priorityLabel, priorityTasksLabel } from './priority.js';
	import PriorityMarker from './PriorityMarker.svelte';
	import TaskDetail from './TaskDetail.svelte';
	import TaskRow from './TaskRow.svelte';

	/**
	 * The Priority View (#13): every open Task with a Priority, across all Lists, in High, Medium
	 * and Low columns. On narrow screens one column is shown at a time, picked with a switcher.
	 * `tasks` also carries the Subtasks and parents the rows and the detail panel refer to.
	 */
	let { tasks }: { tasks: SerializedTask[] } = $props();

	const lists = getListStore();
	const store = setTaskStore(
		new TaskStore(
			() => tasks,
			getToasts(),
			httpTaskPort,
			(id) => lists.get(id)?.name
		)
	);
	onDestroy(() => store.dispose());
	const id = $props.id();

	const selected = $derived(store.get(openTaskId()));
	const groups = $derived(
		PRIORITIES.map((priority) => ({
			priority,
			tasks: priorityGroup(store.all, priority, viewerTimeZone(), dateLocale())
		}))
	);

	let shown = $state<Priority>('high');

	async function close() {
		const taskId = selected?.id;
		await closeTask();
		await tick();
		document.querySelector<HTMLElement>(`[data-task-id="${taskId}"] .open`)?.focus();
	}
</script>

<svelte:head>
	<title>{m.priority_label()} · Tasks</title>
</svelte:head>

<div class="switcher">
	<label class="visually-hidden" for="{id}-switcher">{m.priority_label()}</label>
	<select id="{id}-switcher" bind:value={shown} disabled={!hydration.done}>
		{#each PRIORITIES as priority (priority)}
			<option value={priority}>{priorityLabel(priority)}</option>
		{/each}
	</select>
</div>

<div class="columns" class:with-panel={selected}>
	{#each groups as group (group.priority)}
		<div class="slot" class:shown={group.priority === shown}>
			<Column labelledBy="{id}-{group.priority}">
				{#snippet header()}
					<PriorityMarker priority={group.priority} />
					<h2 id="{id}-{group.priority}" class="name">{priorityLabel(group.priority)}</h2>
					<span class="count">{group.tasks.length}</span>
				{/snippet}

				{#if group.tasks.length > 0}
					<ul class="tasks" aria-label={priorityTasksLabel(group.priority)}>
						{#each group.tasks as task (task.id)}
							<TaskRow {task}>
								{#snippet meta(item)}
									<p class="where">
										<span class="list">{lists.get(item.listId)?.name}</span>
										{#if item.parentId}
											<span class="crumb">· {store.get(item.parentId)?.title} ›</span>
										{/if}
									</p>
								{/snippet}
							</TaskRow>
						{/each}
					</ul>
				{:else}
					<p class="empty">{priorityEmptyText(group.priority)}</p>
				{/if}
			</Column>
		</div>
	{/each}
</div>

{#if selected}
	{#key selected.id}
		<TaskDetail task={selected} onClose={close} />
	{/key}
{/if}

<style>
	.switcher {
		display: none;
		margin-bottom: var(--space-3);
	}

	.switcher select {
		width: 100%;
		padding: var(--space-2) var(--space-3);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		font-weight: 700;
	}

	.columns {
		display: flex;
		align-items: flex-start;
		gap: var(--space-4);
	}

	.slot {
		flex: none;
		width: 24rem;
	}

	.name {
		flex: 1;
		min-width: 0;
		font-size: 1.125rem;
	}

	.count {
		padding-right: var(--space-3);
		color: var(--muted);
		font-size: 0.875rem;
	}

	.tasks {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.where {
		margin: 0;
		color: var(--muted);
		font-size: 0.8125rem;
		overflow-wrap: anywhere;
	}

	.list {
		font-weight: 600;
	}

	.empty {
		padding: var(--space-5) var(--space-3);
		color: var(--muted);
		text-align: center;
		font-size: 0.875rem;
	}

	@media (min-width: 769px) {
		.columns.with-panel::after {
			content: '';
			flex: none;
			width: 26rem;
		}
	}

	@media (max-width: 768px) {
		.switcher {
			display: block;
		}

		.slot {
			display: none;
			width: 100%;
			max-width: 42rem;
		}

		.slot.shown {
			display: block;
		}
	}
</style>
