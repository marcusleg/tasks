<script lang="ts">
	import '@fontsource/inter/400.css';
	import '@fontsource/inter/700.css';
	import '@fontsource/jetbrains-mono/400.css';
	import '#lib/styles/global.css';
	import favicon from '#lib/assets/favicon.svg';
	import AppShell from '#lib/components/AppShell.svelte';
	import SidebarNav from '#lib/components/SidebarNav.svelte';
	import Toasts from '#lib/components/Toasts.svelte';
	import { ListStore, setListStore } from '#lib/client/lists.svelte.js';
	import { setToasts, Toasts as ToastQueue } from '#lib/client/toasts.svelte.js';
	import { onMount } from 'svelte';
	import { hydration } from '#lib/client/hydration.svelte.js';
	import { page } from '$app/state';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	const toasts = setToasts(new ToastQueue());
	setListStore(new ListStore(() => data.lists, toasts));

	onMount(() => {
		hydration.done = true;
		document.documentElement.dataset.hydrated = 'true';
	});
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
			<form method="POST" action="/auth/logout" class="sign-out-form">
				<button type="submit" class="sign-out">Sign out</button>
			</form>
		{/snippet}
		{@render children()}
	</AppShell>
	<Toasts {toasts} />
{:else}
	<!-- Public pages (sign in, not allowed) render without the shell. -->
	{@render children()}
{/if}

<style>
	.sign-out {
		width: 100%;
		font: inherit;
		font-size: 0.875rem;
		color: var(--fg);
		background: none;
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		padding: var(--space-2);
		cursor: pointer;
	}

	.sign-out:hover {
		color: var(--fg);
		background: var(--surface-hover);
	}
</style>
