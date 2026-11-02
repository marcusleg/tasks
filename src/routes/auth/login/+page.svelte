<script lang="ts">
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let error = $derived(form?.error ?? data.error);
</script>

<svelte:head>
	<title>Sign in · Tasks</title>
</svelte:head>

<main class="auth-page">
	<h1>Tasks</h1>

	{#if error}
		<p class="message error" role="alert">{error}</p>
	{:else if data.signedOut}
		<p class="message" role="status">You have been signed out.</p>
	{/if}

	<form method="POST">
		<button type="submit">Sign in</button>
	</form>
</main>

<style>
	.auth-page {
		max-width: 24rem;
		margin: 15vh auto 0;
		padding: 0 1rem;
		font-family: system-ui, sans-serif;
		text-align: center;
	}

	.message {
		padding: 0.5rem 0.75rem;
		border: 1px solid currentColor;
		border-radius: 0.25rem;
	}

	.error {
		color: #b00020;
	}

	button {
		font: inherit;
		padding: 0.5rem 1.5rem;
		cursor: pointer;
	}
</style>
