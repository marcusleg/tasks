<script lang="ts">
	import PriorityPage from '#lib/components/tasks/PriorityPage.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<PriorityPage tasks={data.tasks} />
