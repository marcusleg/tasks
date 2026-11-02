<script lang="ts">
	import ListPage from '#lib/components/tasks/ListPage.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

{#key data.list.id}
	<ListPage list={data.list} tasks={data.tasks} />
{/key}
