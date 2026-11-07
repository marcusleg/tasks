<script lang="ts">
	import { hydration } from '#lib/client/hydration.svelte.js';
	import { onDestroy, tick, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { getListStore } from '#lib/client/lists.svelte.js';
	import { setTaskDrag, TaskDrag } from '#lib/client/task-drag.svelte.js';
	import { closeTask, openTaskId } from '#lib/client/task-panel.js';
	import { setTaskStore, TaskStore } from '#lib/client/tasks.svelte.js';
	import { httpTaskPort } from '#lib/client/task-port.http.js';
	import { getToasts } from '#lib/client/toasts.svelte.js';
	import { TASKS_DEPENDENCY } from '#lib/dependencies.js';
	import type { SerializedList } from '#lib/domain/lists.js';
	import type { SerializedTask } from '#lib/domain/tasks.js';
	import ListColumn from './ListColumn.svelte';
	import TaskDetail from './TaskDetail.svelte';

	/**
	 * The main page: the visible Lists side by side as columns (plus the focused List, even if it
	 * is hidden) and, when `?task=` is set, that Task's detail panel. On narrow screens only the
	 * focused List is shown, with a switcher on top. With `scrollToFocus` (the `/lists/[id]` deep
	 * link) the focused column is scrolled into view and focused.
	 */
	let {
		focus,
		tasks,
		scrollToFocus = false
	}: { focus: SerializedList; tasks: SerializedTask[]; scrollToFocus?: boolean } = $props();

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
	// The columns scroll sideways inside <main> (AppShell).
	const drag = setTaskDrag(new TaskDrag(store, lists, () => document.getElementById('main')));

	// The Lists as edited in this browser (renamed, hidden, reordered), falling back to the page data.
	const columns = $derived(lists.all.filter((list) => list.visible || list.id === focus.id));
	const current = $derived(lists.get(focus.id) ?? focus);
	const selected = $derived(store.get(openTaskId()));

	// A deep link to a hidden List shows its column on wide screens, until the User changes that
	// List's visibility; on `/` a hidden last-viewed List is only shown on narrow screens.
	const reveal = (id: string) => (scrollToFocus ? { id, visible: lists.get(id)?.visible } : null);
	// The id, not `focus` itself: reloaded page data brings a new object for the same List, and that
	// is no reason to take the keyboard focus away from whatever the User is doing.
	const focusId = $derived(focus.id);
	let revealed = $state(untrack(() => reveal(focusId)));
	$effect.pre(() => {
		const id = focusId;
		revealed = untrack(() => reveal(id));
	});
	const wideColumn = (list: SerializedList) =>
		list.visible || (revealed?.id === list.id && revealed.visible === list.visible);

	async function close() {
		const id = selected?.id;
		await closeTask();
		await tick();
		// Back to the row the panel was opened from.
		document.querySelector<HTMLElement>(`[data-task-id="${id}"] .open`)?.focus();
	}

	function onDeleted() {
		void goto(resolve('/'), { invalidate: [TASKS_DEPENDENCY] });
	}

	function switchTo(event: Event) {
		const id = (event.currentTarget as HTMLSelectElement).value;
		void goto(resolve('/lists/[id]', { id }));
	}

	$effect(() => {
		const id = focusId;
		if (!scrollToFocus) return;
		void tick().then(() => {
			const el = document.querySelector<HTMLElement>(`[data-column="${id}"]`);
			if (!el || el.offsetParent === null) return;
			el.focus({ preventScroll: true });
			el.scrollIntoView({ inline: 'nearest', block: 'nearest' });
		});
	});
</script>

<svelte:head>
	<title>{current.name} · Tasks</title>
</svelte:head>

<div class="switcher">
	<label class="visually-hidden" for="list-switcher">List</label>
	<select id="list-switcher" value={focus.id} disabled={!hydration.done} onchange={switchTo}>
		{#each lists.all as list (list.id)}
			<option value={list.id}>{list.name}</option>
		{/each}
	</select>
</div>

<div class="columns" class:with-panel={selected}>
	{#each columns as list (list.id)}
		<!-- Focusable only by script (the deep link); the column inside is the real landmark. -->
		<div
			class="slot"
			class:focused={list.id === focus.id}
			class:narrow-only={!wideColumn(list)}
			data-column={list.id}
			data-focused={list.id === focus.id ? '' : undefined}
			tabindex="-1"
		>
			<ListColumn {list} {onDeleted} />
		</div>
	{/each}
</div>

<p id="task-move-hint" class="visually-hidden">
	Drag to move the task; drag right to make it a subtask, left to take it out. Or press Arrow Up or
	Arrow Down to move it, Arrow Right to make it a subtask of the task above, Arrow Left to take it
	out of its parent.
</p>
<p class="visually-hidden" role="status" aria-live="polite">{drag.announcement}</p>

{#if drag.active}
	{@const active = drag.active}
	{#if active.indicator}
		<div
			class="drop-indicator"
			class:invalid={active.invalid}
			style:top="{active.indicator.top - 1}px"
			style:left="{active.indicator.left}px"
			style:width="{active.indicator.width}px"
			aria-hidden="true"
		></div>
	{/if}
	<div
		class="drag-ghost"
		class:invalid={active.invalid}
		style:transform="translate({active.x + 16}px, {active.y + 12}px)"
		aria-hidden="true"
	>
		<span class="ghost-title">{active.title}</span>
		{#if active.invalid}
			<span class="not-allowed">
				<svg viewBox="0 0 24 24" width="16" height="16">
					<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2" />
					<path d="M5.6 5.6l12.8 12.8" stroke="currentColor" stroke-width="2" />
				</svg>
				Not allowed: {active.invalid}
			</span>
		{/if}
	</div>
{/if}

{#if selected}
	{#key selected.id}
		<TaskDetail task={selected} onClose={close} />
	{/key}
{/if}

<style>
	/* Above the dragged copy, so the line always shows where the Task will land. */
	.drop-indicator {
		position: fixed;
		z-index: 61;
		height: 2px;
		background: var(--accent-purple);
		border-radius: 1px;
		pointer-events: none;
	}

	.drop-indicator::before {
		content: '';
		position: absolute;
		top: -3px;
		left: -4px;
		width: 8px;
		height: 8px;
		border: 2px solid var(--accent-purple);
		border-radius: 50%;
		background: var(--bg);
		box-sizing: border-box;
	}

	.drop-indicator.invalid {
		background: repeating-linear-gradient(90deg, var(--accent-pink) 0 6px, transparent 6px 10px);
	}

	.drop-indicator.invalid::before {
		border-color: var(--accent-pink);
	}

	.drag-ghost {
		position: fixed;
		top: 0;
		left: 0;
		z-index: 60;
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		max-width: 20rem;
		padding: var(--space-2) var(--space-3);
		background: var(--bg);
		border: 1px solid var(--accent-purple);
		border-radius: var(--radius-md);
		box-shadow: 0 6px 18px var(--overlay);
		pointer-events: none;
		opacity: 0.95;
	}

	.drag-ghost.invalid {
		border-color: var(--accent-pink);
	}

	.ghost-title {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.not-allowed {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		color: var(--accent-pink);
		font-size: 0.8125rem;
		font-weight: 700;
	}

	:global(html.task-dragging),
	:global(html.task-dragging *) {
		cursor: grabbing !important;
		user-select: none;
	}

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
		outline: none;
	}

	@media (min-width: 769px) {
		.slot.narrow-only {
			display: none;
		}
	}

	/* Leave room to scroll the last column clear of the side panel. */
	@media (min-width: 769px) {
		.columns.with-panel::after {
			content: '';
			flex: none;
			width: 26rem;
		}
	}

	/* One List at a time on narrow screens. */
	@media (max-width: 768px) {
		.switcher {
			display: block;
		}

		.slot {
			display: none;
			width: 100%;
			max-width: 42rem;
		}

		.slot.focused {
			display: block;
		}
	}
</style>
