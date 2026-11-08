<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import { loginErrorMessage } from './login-error';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	let error = $derived(form?.error ?? data.error);
</script>

<svelte:head>
	<title>{m.auth_sign_in()} · Tasks</title>
</svelte:head>

<main class="auth-page">
	<h1>Tasks</h1>

	{#if error}
		<p class="message error" role="alert">{loginErrorMessage(error)}</p>
	{:else if data.signedOut}
		<p class="message" role="status">{m.auth_login_signed_out()}</p>
	{/if}

	<form method="POST">
		<button type="submit">{m.auth_sign_in()}</button>
	</form>
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

	.message {
		padding: var(--space-2) var(--space-3);
		margin-bottom: var(--space-4);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
	}

	.error {
		border-color: var(--accent-pink);
	}

	button {
		font: inherit;
		font-weight: 700;
		color: var(--on-accent);
		background: var(--accent-purple);
		border: none;
		border-radius: var(--radius-md);
		padding: var(--space-2) var(--space-6);
		cursor: pointer;
	}

	button:hover {
		background: var(--accent-pink);
	}
</style>
