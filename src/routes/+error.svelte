<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { m } from '#lib/paraglide/messages.js';

	// Not `page.error.message`: that is the server's English, e.g. "List not found".
	const notFound = $derived(page.status === 404);
</script>

<svelte:head>
	<title>{notFound ? m.error_page_not_found_title() : m.error_page_error_tab()} · Tasks</title>
</svelte:head>

<section>
	<h1>{notFound ? m.error_page_not_found_title() : m.error_page_error_title()}</h1>
	<p>{notFound ? m.error_page_not_found_text() : m.error_page_error_text()}</p>
	<a href={resolve('/')}>{m.error_page_back()}</a>
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
