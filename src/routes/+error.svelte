<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
</script>

<svelte:head>
	<title>{page.status === 404 ? 'Not found' : 'Error'} · Tasks</title>
</svelte:head>

<section>
	<h1>{page.status === 404 ? 'Not found' : 'Something went wrong'}</h1>
	<p>{page.error?.message}</p>
	<a href={resolve('/')}>Back to your tasks</a>
</section>

<style>
	section {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
	}

	p {
		color: var(--muted);
	}
</style>
