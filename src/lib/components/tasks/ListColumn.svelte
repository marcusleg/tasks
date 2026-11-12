<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { onMount, tick } from 'svelte';
	import { dateLocale, startClock, viewerTimeZone } from '#lib/client/clock.svelte.js';
	import { CollapsedSubtasks } from '#lib/client/collapsed-subtasks.svelte.js';
	import { getListStore } from '#lib/client/lists.svelte.js';
	import { getTaskStore } from '#lib/client/tasks.svelte.js';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import {
		MAX_LIST_NAME_LENGTH,
		SORT_MODES,
		type SerializedList,
		type SortMode
	} from '#lib/domain/lists.js';
	import { sortTasks } from '#lib/domain/sorting.js';
	import AddTaskRow from './AddTaskRow.svelte';
	import Column from './Column.svelte';
	import ListMenu from './ListMenu.svelte';
	import TaskRow from './TaskRow.svelte';

	/**
	 * One List: header (name, menu), "Add a task", the open Tasks with their open Subtasks indented
	 * below (collapsible per parent), and the collapsed Completed section, where Completed Subtasks
	 * of open parents are grouped under their parent's Title. Reads and changes Tasks through the page's `TaskStore` and the List through the
	 * `ListStore`, so several columns can sit side by side (#10).
	 */
	let { list }: { list: SerializedList } = $props();

	const tasks = getTaskStore();
	const lists = getListStore();
	const id = $props.id();

	// The Sort Mode is a view over Custom Order. Until the clock has started (SSR, hydration) the
	// zone is UTC, so the markup is stable; the open Tasks re-sort once the browser zone is known.
	const timeZone = $derived(viewerTimeZone());
	const open = $derived(sortTasks(tasks.openTasks(list.id), list.sortMode, timeZone, dateLocale()));
	const completed = $derived(tasks.completedGroups(list.id));
	const openSubtasks = (parentId: string) =>
		sortTasks(
			tasks.subtasks(parentId).filter((subtask) => !subtask.completedAt),
			list.sortMode,
			timeZone,
			dateLocale()
		);

	const sortLabel = (mode: SortMode): string => {
		switch (mode) {
			case 'custom':
				return m.sort_custom();
			case 'planned':
				return m.sort_planned();
			case 'due':
				return m.sort_due();
			case 'priority':
				return m.sort_priority();
			case 'title':
				return m.sort_title();
		}
	};

	// Drag-and-drop (#11) only rearranges Custom Order, so only while the List shows it.
	const reorderable = $derived(list.sortMode === 'custom');

	const collapsed = new CollapsedSubtasks();
	onMount(() => {
		startClock();
		collapsed.load();
	});

	let renaming = $state(false);
	let draftName = $state('');
	let nameInput = $state<HTMLInputElement>();
	let confirmDeleteList = $state(false);
	let confirmDeleteCompleted = $state(false);

	async function startRename() {
		draftName = list.name;
		renaming = true;
		await tick();
		nameInput?.select();
	}

	function finishRename(save: boolean) {
		if (!renaming) return;
		renaming = false;
		const name = draftName.trim();
		if (save && name && name !== list.name) void lists.update(list.id, { name });
	}

	function onNameKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			event.preventDefault();
			finishRename(true);
		} else if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			finishRename(false);
		}
	}

	const completedCount = $derived(tasks.completedCount(list.id));
</script>

<Column labelledBy="{id}-name">
	{#snippet header()}
		{#if renaming}
			<label class="visually-hidden" for="{id}-rename">{m.list_name_label()}</label>
			<input
				bind:this={nameInput}
				id="{id}-rename"
				class="rename"
				bind:value={draftName}
				maxlength={MAX_LIST_NAME_LENGTH}
				onkeydown={onNameKeydown}
				onblur={() => finishRename(true)}
			/>
			<!-- Keeps the column named while the heading is being edited. -->
			<span id="{id}-name" class="visually-hidden">{list.name}</span>
		{:else}
			<div class="name">
				<h2 id="{id}-name">{list.name}</h2>
				{#if list.sortMode !== 'custom'}
					<p class="sorted-by" data-sort-indicator>
						{m.list_sorted_by({ mode: sortLabel(list.sortMode) })}
					</p>
				{/if}
			</div>
		{/if}
		<ListMenu
			label={m.list_options()}
			sort={{
				label: m.list_sort_by(),
				value: list.sortMode,
				options: SORT_MODES.map((mode) => ({ value: mode, label: sortLabel(mode) })),
				onSelect: (mode) => void lists.update(list.id, { sortMode: mode as SortMode })
			}}
			actions={[
				{ label: m.list_rename(), onSelect: startRename },
				{
					label: m.list_delete_completed(),
					onSelect: () => (confirmDeleteCompleted = true),
					disabled: completedCount === 0
				},
				{ label: m.list_delete(), onSelect: () => (confirmDeleteList = true), danger: true }
			]}
		/>
	{/snippet}

	<AddTaskRow listId={list.id} />

	{#if open.length > 0}
		<ul class="tasks" aria-label={m.list_open_tasks()} data-open-tasks>
			{#each open as task (task.id)}
				{@const subtasks = openSubtasks(task.id)}
				{#if subtasks.length > 0}
					{@const all = tasks.subtasks(task.id).length}
					{@const expanded = !collapsed.has(task.id)}
					<TaskRow {task} {reorderable}>
						{#snippet trailing()}
							<button
								type="button"
								class="subtask-toggle"
								aria-label={m.subtask_list_label({ title: task.title })}
								aria-expanded={expanded}
								aria-controls="{id}-subtasks-{task.id}"
								title={m.subtask_progress({ done: all - subtasks.length, total: all })}
								onclick={() => collapsed.toggle(task.id)}
							>
								<span aria-hidden="true">{all - subtasks.length}/{all}</span>
								<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
									<path
										d="M6 9l6 6 6-6"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
										stroke-linejoin="round"
									/>
								</svg>
							</button>
						{/snippet}
					</TaskRow>
					<li class="subtask-group" hidden={!expanded}>
						<ul
							id="{id}-subtasks-{task.id}"
							class="subtasks"
							aria-label={m.subtask_list_label({ title: task.title })}
							data-subtasks-of={task.id}
						>
							{#each subtasks as subtask (subtask.id)}
								<TaskRow task={subtask} {reorderable} />
							{/each}
						</ul>
					</li>
				{:else}
					<TaskRow {task} {reorderable} />
				{/if}
			{/each}
		</ul>
	{:else}
		<p class="empty" data-drop-empty>
			{completedCount > 0 ? m.list_all_completed() : m.list_no_tasks()}
		</p>
	{/if}

	{#if completedCount > 0}
		<details class="completed">
			<summary>
				<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
					<path
						d="M9 6l6 6-6 6"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
				{m.list_completed_heading({ count: completedCount })}
			</summary>
			<ul class="tasks" aria-label={m.list_completed_tasks()}>
				{#each completed as { parent, subtasks } (parent.id)}
					{#if parent.completedAt}
						<TaskRow task={parent} />
						{#if subtasks.length > 0}
							<li class="subtask-group">
								<ul class="subtasks" aria-label={m.subtask_list_label({ title: parent.title })}>
									{#each subtasks as subtask (subtask.id)}
										<TaskRow task={subtask} />
									{/each}
								</ul>
							</li>
						{/if}
					{:else}
						<!-- An open parent shows only its Title, labelling its Completed Subtasks. -->
						<li class="subtask-group">
							<p id="{id}-completed-{parent.id}" class="subtask-parent">{parent.title}</p>
							<ul class="subtasks" aria-labelledby="{id}-completed-{parent.id}">
								{#each subtasks as subtask (subtask.id)}
									<TaskRow task={subtask} />
								{/each}
							</ul>
						</li>
					{/if}
				{/each}
			</ul>
		</details>
	{/if}
</Column>

<ConfirmDialog
	bind:open={confirmDeleteList}
	title={m.confirm_delete_list_title({ name: list.name })}
	message={m.confirm_delete_list_message()}
	confirmLabel={m.confirm_delete_list_confirm()}
	onConfirm={() => lists.remove(list.id)}
/>

<ConfirmDialog
	bind:open={confirmDeleteCompleted}
	title={m.confirm_delete_completed_title()}
	message={m.confirm_delete_completed_message({ count: completedCount, name: list.name })}
	confirmLabel={m.confirm_delete()}
	onConfirm={() => tasks.deleteCompleted(list.id)}
/>

<style>
	.name {
		flex: 1;
		min-width: 0;
	}

	.name h2 {
		font-size: 1.125rem;
		overflow-wrap: anywhere;
	}

	.sorted-by {
		margin: 0;
		color: var(--muted);
		font-size: 0.75rem;
	}

	.rename {
		flex: 1;
		min-width: 0;
		padding: var(--space-1) var(--space-2);
		margin-left: calc(-1 * var(--space-2));
		font-size: 1.125rem;
		font-weight: 700;
		background: var(--bg);
		border: 1px solid var(--accent-purple);
		border-radius: var(--radius-sm);
	}

	.tasks {
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.subtasks {
		margin: 0;
		padding: 0 0 0 var(--space-6);
		list-style: none;
	}

	.subtask-group[hidden] {
		display: none;
	}

	.subtask-toggle {
		display: flex;
		flex: none;
		align-items: center;
		gap: var(--space-1);
		height: 2.75rem;
		padding: 0 var(--space-2);
		background: none;
		border: none;
		border-radius: var(--radius-md);
		color: var(--muted);
		font-size: 0.8125rem;
		font-variant-numeric: tabular-nums;
	}

	.subtask-toggle:hover {
		background: var(--surface-hover);
		color: var(--fg);
	}

	.subtask-toggle svg {
		transition: transform 0.15s ease;
	}

	.subtask-toggle[aria-expanded='false'] svg {
		transform: rotate(-90deg);
	}

	.subtask-parent {
		display: flex;
		align-items: center;
		min-height: 2.25rem;
		padding: var(--space-1) var(--space-3) 0;
		color: var(--muted);
		font-size: 0.875rem;
		font-weight: 600;
		overflow-wrap: anywhere;
	}

	.empty {
		padding: var(--space-5) var(--space-3);
		color: var(--muted);
		text-align: center;
		font-size: 0.875rem;
	}

	.completed {
		margin-top: var(--space-2);
		border-top: 1px solid var(--border);
		padding-top: var(--space-2);
	}

	summary {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 2.75rem;
		padding: 0 var(--space-3);
		border-radius: var(--radius-md);
		color: var(--muted);
		font-size: 0.875rem;
		font-weight: 700;
		cursor: pointer;
		list-style: none;
	}

	summary::-webkit-details-marker {
		display: none;
	}

	summary:hover {
		background: var(--surface-hover);
		color: var(--fg);
	}

	summary svg {
		transition: transform 0.15s ease;
	}

	details[open] summary svg {
		transform: rotate(90deg);
	}
</style>
