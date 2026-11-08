<script lang="ts">
	import { resolve } from '$app/paths';
	import { m } from '#lib/paraglide/messages.js';
</script>

<svelte:head>
	<title>{m.auth_not_allowed_title()} · Tasks</title>
</svelte:head>

<main class="auth-page">
	<h1>{m.auth_not_allowed_title()}</h1>
	<p>{m.auth_not_allowed_text()}</p>
	<p><a href={resolve('/auth/login')}>{m.auth_not_allowed_back()}</a></p>
</main>

<style>
	.auth-page {
		max-width: 26rem;
		margin: 15vh auto 0;
		padding: 0 var(--space-4);
		text-align: center;
	}

	h1 {
		margin-bottom: var(--space-4);
	}
</style>
