<script lang="ts">
	import { tick, untrack } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { getListStore } from '#lib/client/lists.svelte.js';
	import { closeTask, openTaskId } from '#lib/client/task-panel.js';
	import { setTaskStore, TaskStore } from '#lib/client/tasks.svelte.js';
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

	const store = setTaskStore(new TaskStore(() => tasks, getToasts()));
	const lists = getListStore();

	// The Lists as edited in this browser (renamed, hidden, reordered), falling back to the page data.
	const columns = $derived(lists.all.filter((list) => list.visible || list.id === focus.id));
	const current = $derived(lists.get(focus.id) ?? focus);
	const selected = $derived(store.get(openTaskId()));

	// A deep link to a hidden List shows its column on wide screens, until the User changes that
	// List's visibility; on `/` a hidden last-viewed List is only shown on narrow screens.
	const reveal = (id: string) => (scrollToFocus ? { id, visible: lists.get(id)?.visible } : null);
	let revealed = $state(untrack(() => reveal(focus.id)));
	$effect.pre(() => {
		const id = focus.id;
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
		const id = focus.id;
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
	<select id="list-switcher" value={focus.id} onchange={switchTo}>
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
