<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import { openTask } from '#lib/client/task-panel.js';
	import { getTaskStore } from '#lib/client/tasks.svelte.js';
	import LinkifiedText from '#lib/components/LinkifiedText.svelte';
	import {
		MAX_DESCRIPTION_LENGTH,
		MAX_TITLE_LENGTH,
		type SerializedTask
	} from '#lib/domain/tasks.js';
	import AddTaskRow from './AddTaskRow.svelte';
	import TaskRow from './TaskRow.svelte';
	import PriorityField from './PriorityField.svelte';
	import TaskDateFields from './TaskDateFields.svelte';

	/**
	 * The Task detail panel: a side panel on wide screens, a full-screen sheet on narrow ones.
	 * Edits are saved as you type (debounced) and when a field loses focus. Render it inside
	 * `{#key task.id}` so each Task starts with fresh drafts. A top-level Task lists its Subtasks
	 * (with "Add subtask"); a Subtask links back to its parent.
	 */
	type Props = {
		task: SerializedTask;
		onClose: () => void;
	};

	let { task, onClose }: Props = $props();

	const store = getTaskStore();
	const id = $props.id();
	const SAVE_DELAY_MS = 500;
	// The panel is keyed by Task id. Closing it (e.g. with Esc mid-debounce) flushes the drafts
	// after the props are gone, so the id is captured here; the drafts are this component's own.
	const taskId = untrack(() => task.id);

	// Drafts, so answers from the server never overwrite what is being typed.
	let title = $state(untrack(() => task.title));
	let description = $state(untrack(() => task.description));
	let editingDescription = $state(false);
	let titleInput = $state<HTMLTextAreaElement>();
	let descriptionInput = $state<HTMLTextAreaElement>();
	let saveTimer: ReturnType<typeof setTimeout> | undefined;
	let saved = untrack(() => ({ title: task.title, description: task.description }));

	const completed = $derived(task.completedAt !== null);
	const parent = $derived(store.get(task.parentId));
	const subtasks = $derived(task.parentId === null ? store.subtasks(task.id) : []);
	const subtasksDone = $derived(subtasks.filter((subtask) => subtask.completedAt).length);

	onMount(() => {
		titleInput?.focus();
		return () => save();
	});

	/** Sends whatever changed since the last save. An empty Title is never saved. */
	function save() {
		clearTimeout(saveTimer);
		saveTimer = undefined;
		const patch: { title?: string; description?: string } = {};
		const trimmedTitle = title.trim();
		if (trimmedTitle && trimmedTitle !== saved.title) patch.title = trimmedTitle;
		if (description.trimEnd() !== saved.description) patch.description = description.trimEnd();
		if (Object.keys(patch).length === 0) return;
		saved = {
			title: patch.title ?? saved.title,
			description: patch.description ?? saved.description
		};
		void store.update(taskId, patch);
	}

	function scheduleSave() {
		clearTimeout(saveTimer);
		saveTimer = setTimeout(save, SAVE_DELAY_MS);
	}

	function onTitleKeydown(event: KeyboardEvent) {
		// The Title is one line; Enter finishes it.
		if (event.key === 'Enter') {
			event.preventDefault();
			titleInput?.blur();
		}
	}

	function onTitleBlur() {
		save();
		if (!title.trim()) title = saved.title;
	}

	async function editDescription() {
		editingDescription = true;
		await tick();
		descriptionInput?.focus();
	}

	function onDescriptionBlur() {
		save();
		editingDescription = false;
	}

	function onWindowKeydown(event: KeyboardEvent) {
		if (event.key !== 'Escape' || event.defaultPrevented) return;
		// A confirmation dialog handles its own Esc.
		if (document.querySelector('dialog[open]')) return;
		event.preventDefault();
		onClose();
	}

	function toggleCompleted() {
		save();
		if (completed) store.reopen(task.id);
		else store.complete(task.id);
	}

	function remove() {
		clearTimeout(saveTimer);
		onClose();
		void store.remove(task.id);
	}

	// Showing the editor while there is no Description gives a place to start typing.
	const showEditor = $derived(editingDescription || !description);
</script>

<svelte:window onkeydown={onWindowKeydown} />

<aside class="detail" aria-labelledby="{id}-heading">
	<header>
		<h2 id="{id}-heading" class="visually-hidden">Task details</h2>
		{#if parent}
			<nav class="breadcrumb" aria-label="Parent task">
				<button type="button" onclick={() => openTask(parent.id)}>
					<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
						<path
							d="M15 6l-6 6 6 6"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
					<span class="breadcrumb-title">{parent.title}</span>
				</button>
			</nav>
		{/if}
		<button type="button" class="icon" aria-label="Close details" onclick={onClose}>
			<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
				<path
					d="M6 6l12 12M18 6L6 18"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					fill="none"
				/>
			</svg>
		</button>
	</header>

	<div class="fields">
		<label class="visually-hidden" for="{id}-title">Title</label>
		<textarea
			bind:this={titleInput}
			id="{id}-title"
			class="title"
			class:completed
			rows="1"
			maxlength={MAX_TITLE_LENGTH}
			bind:value={title}
			oninput={scheduleSave}
			onkeydown={onTitleKeydown}
			onblur={onTitleBlur}></textarea>

		<div class="description">
			<div class="label-row">
				{#if showEditor}
					<label class="label" for="{id}-description">Details</label>
				{:else}
					<h3 class="label">Details</h3>
					<button
						type="button"
						class="link-button"
						aria-label="Edit details"
						onclick={editDescription}
					>
						Edit
					</button>
				{/if}
			</div>
			{#if showEditor}
				<textarea
					bind:this={descriptionInput}
					id="{id}-description"
					rows="4"
					maxlength={MAX_DESCRIPTION_LENGTH}
					placeholder="Add details"
					bind:value={description}
					oninput={scheduleSave}
					onfocus={() => (editingDescription = true)}
					onblur={onDescriptionBlur}></textarea>
			{:else}
				<!-- Clicking the text (but not a link) edits it; keyboard users use the Edit button. -->
				<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
				<div
					class="description-text"
					onclick={(event) => {
						if (!(event.target as Element).closest('a')) editDescription();
					}}
				>
					<LinkifiedText text={description} />
				</div>
			{/if}
		</div>

		<TaskDateFields {task} />
		<PriorityField
			value={task.priority}
			onchange={(priority) => store.update(task.id, { priority })}
		/>

		<!-- #16 (Recurrence) adds its fields here. -->

		{#if task.parentId === null}
			<section class="subtasks" aria-labelledby="{id}-subtasks">
				<div class="label-row">
					<h3 id="{id}-subtasks" class="label">Subtasks</h3>
					{#if subtasks.length > 0}
						<span class="count">{subtasksDone}/{subtasks.length}</span>
					{/if}
				</div>
				{#if subtasks.length > 0}
					<ul aria-labelledby="{id}-subtasks">
						{#each subtasks as subtask (subtask.id)}
							<TaskRow task={subtask} />
						{/each}
					</ul>
				{/if}
				{#if completed}
					<p class="hint">Reopen the task to add subtasks.</p>
				{:else}
					<AddTaskRow listId={task.listId} parentId={task.id} label="Add subtask" />
				{/if}
			</section>
		{/if}
	</div>

	<footer>
		<button type="button" class="secondary" onclick={toggleCompleted}>
			{completed ? 'Mark uncompleted' : 'Mark completed'}
		</button>
		<button type="button" class="danger" onclick={remove}>Delete task</button>
	</footer>
</aside>

<style>
	.detail {
		position: fixed;
		top: var(--header-height);
		right: 0;
		bottom: 0;
		z-index: 15;
		display: flex;
		flex-direction: column;
		width: var(--detail-width, 26rem);
		background: var(--bg);
		border-left: 1px solid var(--border);
	}

	header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		padding: var(--space-2);
	}

	header > .icon {
		margin-left: auto;
	}

	.breadcrumb {
		min-width: 0;
		padding-left: var(--space-3);
	}

	.breadcrumb button {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		max-width: 100%;
		min-height: 2.5rem;
		padding: 0 var(--space-2) 0 var(--space-1);
		background: none;
		border: none;
		border-radius: var(--radius-md);
		color: var(--accent-purple);
		font-size: 0.875rem;
	}

	.breadcrumb button:hover {
		background: var(--surface-hover);
	}

	.breadcrumb svg {
		flex: none;
	}

	.breadcrumb-title {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.subtasks ul {
		margin: 0 calc(-1 * var(--space-3));
		padding: 0;
		list-style: none;
	}

	.subtasks :global(form) {
		margin: 0 calc(-1 * var(--space-3));
	}

	.count {
		color: var(--muted);
		font-size: 0.8125rem;
		font-variant-numeric: tabular-nums;
	}

	.hint {
		color: var(--muted);
		font-size: 0.875rem;
	}

	.icon {
		display: grid;
		place-items: center;
		width: 2.5rem;
		height: 2.5rem;
		padding: 0;
		background: none;
		border: none;
		border-radius: 50%;
		color: var(--muted);
	}

	.icon:hover {
		background: var(--surface-hover);
		color: var(--fg);
	}

	.fields {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: var(--space-5);
		padding: 0 var(--space-5) var(--space-5);
		overflow-y: auto;
	}

	textarea {
		width: 100%;
		padding: var(--space-2) var(--space-3);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		resize: vertical;
	}

	textarea:focus {
		outline: none;
		border-color: var(--accent-purple);
	}

	.title {
		field-sizing: content;
		min-height: 2.75rem;
		padding: var(--space-2);
		margin: 0 calc(-1 * var(--space-2));
		width: calc(100% + 2 * var(--space-2));
		font-size: 1.25rem;
		font-weight: 700;
		background: transparent;
		border-color: transparent;
		resize: none;
		overflow-wrap: anywhere;
	}

	.title:hover {
		border-color: var(--border);
	}

	.title.completed {
		text-decoration: line-through;
		color: var(--muted);
	}

	.description textarea {
		field-sizing: content;
		min-height: 6rem;
	}

	.label-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: var(--space-2);
	}

	.label {
		margin: 0;
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

	.description-text {
		padding: var(--space-2) var(--space-3);
		margin: 0 calc(-1 * var(--space-3));
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		cursor: text;
	}

	.description-text:hover {
		border-color: var(--border);
	}

	footer {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: var(--space-2);
		padding: var(--space-3) var(--space-5);
		border-top: 1px solid var(--border);
	}

	footer button {
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius-md);
		background: transparent;
		border: 1px solid var(--border);
	}

	footer button:hover {
		background: var(--surface-hover);
	}

	.danger {
		color: var(--accent-pink);
	}

	@media (max-width: 768px) {
		.detail {
			top: 0;
			left: 0;
			z-index: 40;
			width: auto;
			border-left: none;
		}

		header {
			padding: var(--space-2) var(--space-2) 0;
		}

		.fields {
			padding: 0 var(--space-4) var(--space-4);
		}

		footer {
			padding: var(--space-3) var(--space-4);
		}
	}
</style>
