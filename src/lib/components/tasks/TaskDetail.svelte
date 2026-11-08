<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { onMount, tick, untrack } from 'svelte';
	import { getListStore } from '#lib/client/lists.svelte.js';
	import {
		getScopePrompt,
		ScopedTasks,
		type ScopeGroup
	} from '#lib/client/occurrence-scope.svelte.js';
	import { scopeNote as describeScope } from '#lib/client/scope-messages.js';
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
	import RecurrenceField from './RecurrenceField.svelte';
	import TaskDateFields from './TaskDateFields.svelte';

	/**
	 * The Task detail panel: a side panel on wide screens, a full-screen sheet on narrow ones.
	 * Edits are saved as you type (debounced) and when a field loses focus. Render it inside
	 * `{#key task.id}` so each Task starts with fresh drafts. A top-level Task lists its Subtasks
	 * (with "Add subtask"); a Subtask links back to its parent.
	 *
	 * For a recurring Task, or a Subtask of one, a committed change asks whether it applies to this
	 * Occurrence or to this and all future ones (`ScopedTasks`: once per field group while the panel
	 * is open; typing is saved only once that is known). Deleting always asks.
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

	// Reads the Task from the store, not the props: a change can still be asked about while the
	// panel closes.
	const scopes = new ScopedTasks(getScopePrompt(), store, { remembers: true });
	let asking = false;
	let deleted = false;
	/** Bumped when a change is cancelled, so the field shows the saved value again. */
	let revision = $state(0);

	const completed = $derived(task.completedAt !== null);
	const parent = $derived(store.get(task.parentId));
	const subtasks = $derived(task.parentId === null ? store.subtasks(task.id) : []);
	const subtasksDone = $derived(subtasks.filter((subtask) => subtask.completedAt).length);

	onMount(() => {
		titleInput?.focus();
		return () => void save();
	});

	// A change from another device reaches the drafts, unless they hold edits not saved yet.
	$effect(() => {
		const fresh = store.loaded(taskId);
		if (!fresh) return;
		untrack(() => {
			if (title === saved.title) title = saved.title = fresh.title;
			if (description === saved.description) description = saved.description = fresh.description;
		});
	});

	/** What changed since the last save, or `null`. An empty Title is never saved. */
	function pendingPatch(): { title?: string; description?: string } | null {
		const patch: { title?: string; description?: string } = {};
		const trimmedTitle = title.trim();
		if (trimmedTitle && trimmedTitle !== saved.title) patch.title = trimmedTitle;
		if (description.trimEnd() !== saved.description) patch.description = description.trimEnd();
		return Object.keys(patch).length === 0 ? null : patch;
	}

	/**
	 * Sends whatever changed since the last save. While typing (`committed` false), a recurring
	 * Task's change waits until it's known which Occurrences it applies to; a commit asks.
	 */
	async function save(committed = true) {
		clearTimeout(saveTimer);
		saveTimer = undefined;
		if (asking || deleted || !pendingPatch()) return;
		if (!committed && scopes.unanswered(taskId, 'details')) return;
		asking = true;
		await scopes.update(
			taskId,
			() => {
				// Re-read once the scope is known: typing may have gone on while the question was open.
				const patch = pendingPatch();
				if (patch) {
					saved = {
						title: patch.title ?? saved.title,
						description: patch.description ?? saved.description
					};
				}
				return patch;
			},
			{
				discard: () => {
					title = saved.title;
					description = saved.description;
				}
			}
		);
		asking = false;
	}

	function scheduleSave() {
		clearTimeout(saveTimer);
		saveTimer = setTimeout(() => save(false), SAVE_DELAY_MS);
	}

	function changePriority(priority: SerializedTask['priority']) {
		return scopes.update(taskId, { priority }, { discard: () => revision++ });
	}

	/** What the panel remembers, e.g. "Date changes apply to this occurrence only." */
	const scopeNote = $derived(
		Object.entries(scopes.chosen)
			.map(([group, applyTo]) => describeScope(group as ScopeGroup, applyTo))
			.join(' ')
	);

	function onTitleKeydown(event: KeyboardEvent) {
		// The Title is one line; Enter finishes it.
		if (event.key === 'Enter') {
			event.preventDefault();
			titleInput?.blur();
		}
	}

	function onTitleBlur() {
		if (!title.trim()) title = saved.title;
		void save();
	}

	async function editDescription() {
		editingDescription = true;
		await tick();
		descriptionInput?.focus();
	}

	function onDescriptionBlur() {
		void save();
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
		void save();
		if (completed) store.reopen(task.id);
		else store.complete(task.id);
	}

	async function remove() {
		clearTimeout(saveTimer);
		await scopes.remove(taskId, () => {
			deleted = true;
			onClose();
		});
	}

	// "Move to List" (#11): to the top of the other List, with its Subtasks; a Subtask becomes a
	// top-level Task there. Drag-and-drop does the same on wide screens.
	const lists = getListStore();

	function moveToList(event: Event) {
		const listId = (event.currentTarget as HTMLSelectElement).value;
		if (listId !== task.listId) void store.move(task.id, { listId, parentId: null });
	}

	// Showing the editor while there is no Description gives a place to start typing.
	const showEditor = $derived(editingDescription || !description);
</script>

<svelte:window onkeydown={onWindowKeydown} />

<aside class="detail" aria-labelledby="{id}-heading">
	<header>
		<h2 id="{id}-heading" class="visually-hidden">{m.task_details_heading()}</h2>
		{#if parent}
			<nav class="breadcrumb" aria-label={m.task_parent_nav()}>
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
		<button type="button" class="icon" aria-label={m.task_close_details()} onclick={onClose}>
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
		{#if scopeNote}
			<p class="scope-note" role="status">
				<span>{scopeNote}</span>
				<button type="button" class="link-button" onclick={() => scopes.forget()}>
					{m.scope_ask_again()}
				</button>
			</p>
		{/if}
		<label class="visually-hidden" for="{id}-title">{m.task_title()}</label>
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
					<label class="label" for="{id}-description">{m.task_details()}</label>
				{:else}
					<h3 class="label">{m.task_details()}</h3>
					<button
						type="button"
						class="link-button"
						aria-label={m.task_details_edit_label()}
						onclick={editDescription}
					>
						{m.task_details_edit()}
					</button>
				{/if}
			</div>
			{#if showEditor}
				<textarea
					bind:this={descriptionInput}
					id="{id}-description"
					rows="4"
					maxlength={MAX_DESCRIPTION_LENGTH}
					placeholder={m.task_details_add()}
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

		{#key revision}
			<TaskDateFields {task} {scopes} />
			<PriorityField value={task.priority} onchange={changePriority} />
		{/key}

		<RecurrenceField {task} />

		{#if task.parentId === null}
			<section class="subtasks" aria-labelledby="{id}-subtasks">
				<div class="label-row">
					<h3 id="{id}-subtasks" class="label">{m.subtask_heading()}</h3>
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
					<p class="hint">{m.subtask_reopen_hint()}</p>
				{:else}
					<AddTaskRow listId={task.listId} parentId={task.id} label={m.subtask_add()} {scopes} />
				{/if}
			</section>
		{/if}

		<div class="move">
			<label class="label" for="{id}-list">{m.task_list()}</label>
			<select
				id="{id}-list"
				value={task.listId}
				disabled={completed}
				aria-describedby={completed ? `${id}-list-hint` : undefined}
				onchange={moveToList}
			>
				{#each lists.all as list (list.id)}
					<option value={list.id}>{list.name}</option>
				{/each}
			</select>
			{#if completed}
				<p id="{id}-list-hint" class="hint">{m.task_move_reopen_hint()}</p>
			{/if}
		</div>
	</div>

	<footer>
		<button type="button" class="secondary" onclick={toggleCompleted}>
			{completed ? m.task_mark_uncompleted() : m.task_mark_completed()}
		</button>
		<button type="button" class="danger" onclick={remove}>{m.task_delete()}</button>
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

	.scope-note {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-1) var(--space-2);
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--border);
		border-left: 4px solid var(--accent-purple);
		border-radius: var(--radius-md);
		color: var(--muted);
		font-size: 0.8125rem;
	}

	.scope-note .link-button {
		margin-left: auto;
		padding: 0 var(--space-1);
	}

	.move {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
	}

	.move select {
		width: 100%;
		padding: var(--space-2) var(--space-3);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
	}

	.move select:focus {
		outline: none;
		border-color: var(--accent-purple);
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
