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

<AppShell user={page.data.user}>
	{#snippet sidebar()}
		<SidebarNav />
	{/snippet}
	{@render children()}
</AppShell>
