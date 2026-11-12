<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { onDestroy, tick } from 'svelte';
	import { afterNavigate, goto } from '$app/navigation';
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
	 * The main page: the visible Lists as columns, side by side on wide screens and stacked on narrow
	 * ones, and, when `?task=` is set, that Task's detail panel. With a `focus` (the `/lists/[id]`
	 * link) that List's column shows even if it is a Hidden List, and is scrolled into view and
	 * focused; `/` has none.
	 */
	let { focus, tasks }: { focus: SerializedList | null; tasks: SerializedTask[] } = $props();

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

	const focusId = $derived(focus?.id);

	// The Lists as edited in this browser (renamed, hidden, reordered), falling back to the page data.
	// A link to a Hidden List shows its column until the User shows it, which reloads the page data.
	const columns = $derived(
		lists.all.filter((list) => list.visible || (list.id === focusId && focus?.visible === false))
	);
	const current = $derived(focus && (lists.get(focus.id) ?? focus));
	const selected = $derived(store.get(openTaskId()));

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

	// After navigating, not as an effect: SvelteKit scrolls a new page to the top once it has
	// rendered. Opening or closing a Task only changes the query, which is no reason to scroll.
	afterNavigate(({ from, to }) => {
		const id = focusId;
		if (!id || from?.url.pathname === to?.url.pathname) return;
		void tick().then(() => {
			const el = document.querySelector<HTMLElement>(`[data-column="${id}"]`);
			if (!el) return;
			el.focus({ preventScroll: true });
			el.scrollIntoView({ inline: 'nearest', block: 'start' });
		});
	});
</script>

<svelte:head>
	<title>{current ? `${current.name} · Tasks` : 'Tasks'}</title>
</svelte:head>

{#if columns.length === 0}
	<p class="all-hidden">{m.list_all_hidden()}</p>
{/if}

<div class="columns" class:with-panel={selected}>
	{#each columns as list (list.id)}
		<!-- Focusable only by script (the deep link); the column inside is the real landmark. -->
		<div
			class="slot"
			data-column={list.id}
			data-focused={list.id === focusId ? '' : undefined}
			tabindex="-1"
		>
			<ListColumn {list} {onDeleted} />
		</div>
	{/each}
</div>

<p id="task-move-hint" class="visually-hidden">
	{m.task_drag_hint()}
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
				{m.task_drag_not_allowed({ reason: active.invalid })}
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

	.columns {
		display: flex;
		align-items: flex-start;
		gap: var(--space-4);
	}

	.slot {
		flex: none;
		width: 24rem;
		outline: none;
		/* Scrolled to just below the sticky header, where <main>'s padding puts the first column. */
		scroll-margin-top: calc(var(--header-height) + env(safe-area-inset-top) + var(--space-5));
	}

	.all-hidden {
		max-width: 28rem;
		margin: 0;
		color: var(--muted);
	}

	/* Leave room to scroll the last column clear of the side panel. */
	@media (min-width: 769px) {
		.columns.with-panel::after {
			content: '';
			flex: none;
			width: 26rem;
		}
	}

	/* Stacked on narrow screens: every List in full, one after another. */
	@media (max-width: 768px) {
		.columns {
			flex-direction: column;
			gap: var(--space-6);
		}

		.slot {
			width: 100%;
			max-width: 42rem;
		}
	}
</style>
