<script lang="ts">
	import { tick } from 'svelte';
	import { getListStore } from '#lib/client/lists.svelte.js';
	import { getTaskStore } from '#lib/client/tasks.svelte.js';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import { MAX_LIST_NAME_LENGTH, type SerializedList } from '#lib/domain/lists.js';
	import AddTaskRow from './AddTaskRow.svelte';
	import Column from './Column.svelte';
	import ListMenu from './ListMenu.svelte';
	import TaskRow from './TaskRow.svelte';

	/**
	 * One List: header (name, menu), "Add a task", the open Tasks and the collapsed Completed
	 * section. Reads and changes Tasks through the page's `TaskStore` and the List through the
	 * `ListStore`, so several columns can sit side by side (#10).
	 */
	type Props = {
		list: SerializedList;
		/** Called after the List was deleted, e.g. to navigate away. */
		onDeleted?: () => void;
	};

	let { list, onDeleted }: Props = $props();

	const tasks = getTaskStore();
	const lists = getListStore();
	const id = $props.id();

	const open = $derived(tasks.openTasks(list.id));
	const completed = $derived(tasks.completedTasks(list.id));

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

	async function deleteList() {
		if (await lists.remove(list.id)) onDeleted?.();
	}

	const completedCount = $derived(completed.length);
	const completedNoun = $derived(completedCount === 1 ? 'task' : 'tasks');
</script>

<Column labelledBy="{id}-name">
	{#snippet header()}
		{#if renaming}
			<label class="visually-hidden" for="{id}-rename">List name</label>
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
			<h2 id="{id}-name" class="name">{list.name}</h2>
		{/if}
		<ListMenu
			label="List options"
			actions={[
				{ label: 'Rename list', onSelect: startRename },
				{
					label: 'Delete all completed',
					onSelect: () => (confirmDeleteCompleted = true),
					disabled: completedCount === 0
				},
				{ label: 'Delete list', onSelect: () => (confirmDeleteList = true), danger: true }
			]}
		/>
	{/snippet}

	<AddTaskRow listId={list.id} />

	{#if open.length > 0}
		<ul class="tasks" aria-label="Open tasks">
			{#each open as task (task.id)}
				<!-- #7 renders the Task's Subtasks below its row. -->
				<TaskRow {task} />
			{/each}
		</ul>
	{:else}
		<p class="empty">{completedCount > 0 ? 'All tasks completed' : 'No tasks yet'}</p>
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
				Completed ({completedCount})
			</summary>
			<ul class="tasks" aria-label="Completed tasks">
				{#each completed as task (task.id)}
					<TaskRow {task} />
				{/each}
			</ul>
		</details>
	{/if}
</Column>

<ConfirmDialog
	bind:open={confirmDeleteList}
	title="Delete “{list.name}”?"
	message="The list and all of its tasks will be deleted. This can’t be undone."
	confirmLabel="Delete list"
	onConfirm={deleteList}
/>

<ConfirmDialog
	bind:open={confirmDeleteCompleted}
	title="Delete all completed tasks?"
	message="{completedCount} completed {completedNoun} in “{list.name}” will be deleted. This can’t be undone."
	confirmLabel="Delete"
	onConfirm={() => tasks.deleteCompleted(list.id)}
/>

<style>
	.name {
		flex: 1;
		min-width: 0;
		font-size: 1.125rem;
		overflow-wrap: anywhere;
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
