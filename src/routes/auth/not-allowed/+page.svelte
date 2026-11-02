<script lang="ts">
	import { resolve } from '$app/paths';
</script>

<svelte:head>
	<title>Not allowed · Tasks</title>
</svelte:head>

<main class="auth-page">
	<h1>Not allowed</h1>
	<p>
		Your account isn't in the group that may use this app, so you can't sign in. Ask the
		administrator to add you to the group, or sign in with a different account.
	</p>
	<p><a href={resolve('/auth/login')}>Back to sign in</a></p>
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
