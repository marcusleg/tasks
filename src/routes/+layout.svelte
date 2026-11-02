<script lang="ts">
	import '@fontsource/inter/400.css';
	import '@fontsource/inter/700.css';
	import '@fontsource/jetbrains-mono/400.css';
	import '#lib/styles/global.css';
	import favicon from '#lib/assets/favicon.svg';
	import AppShell from '#lib/components/AppShell.svelte';
	import SidebarNav from '#lib/components/SidebarNav.svelte';
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	let { children }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{#if page.data.user}
	<AppShell user={page.data.user}>
		{#snippet sidebar()}
			<SidebarNav />
		{/snippet}
		{#snippet userActions()}
			<form method="POST" action="/auth/logout">
				<button type="submit" class="sign-out">Sign out</button>
			</form>
		{/snippet}
		{@render children()}
	</AppShell>
{:else}
	<!-- Public pages (sign in, not allowed) render without the shell. -->
	{@render children()}
{/if}

<style>
	.sign-out {
		font: inherit;
		font-size: 0.875rem;
		color: var(--muted);
		background: none;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: var(--space-1) var(--space-2);
		cursor: pointer;
	}

	.sign-out:hover {
		color: var(--fg);
		background: var(--surface-hover);
	}
</style>
