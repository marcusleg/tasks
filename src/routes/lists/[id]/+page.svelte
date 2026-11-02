<script lang="ts">
	import ListPage from '#lib/components/tasks/ListPage.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

{#if data.list}
	<ListPage focus={data.list} tasks={data.tasks} scrollToFocus />
{/if}
