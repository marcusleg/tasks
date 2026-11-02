<script lang="ts">
	import { tick } from 'svelte';
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

	/** A page showing one List and, when `?task=` is set, that Task's detail panel. */
	let { list, tasks }: { list: SerializedList; tasks: SerializedTask[] } = $props();

	const store = setTaskStore(new TaskStore(() => tasks, getToasts()));
	const lists = getListStore();

	// The List as edited in this browser (e.g. just renamed), falling back to the page data.
	const current = $derived(lists.get(list.id) ?? list);
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
</script>

<svelte:head>
	<title>{current.name} · Tasks</title>
</svelte:head>

<div class="list-page" class:with-panel={selected}>
	<ListColumn list={current} {onDeleted} />
</div>

{#if selected}
	{#key selected.id}
		<TaskDetail task={selected} onClose={close} />
	{/key}
{/if}

<style>
	.list-page {
		max-width: 42rem;
	}

	/* Keep the List clear of the side panel when there is room for both. */
	@media (min-width: 769px) {
		.list-page.with-panel {
			margin-right: min(26rem, calc(100% - 20rem));
		}
	}
</style>
