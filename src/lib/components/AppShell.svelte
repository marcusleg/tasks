<script lang="ts">
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import ThemeSwitch from './ThemeSwitch.svelte';

	type Props = {
		/** The signed-in user. The user area is not rendered when absent. */
		user?: { name: string } | null;
		/** Extra controls next to the user's name, e.g. a logout button. */
		userActions?: Snippet;
		/** Content of the sidebar (below the menu button on narrow screens). */
		sidebar: Snippet;
		children: Snippet;
	};

	let { user = null, userActions, sidebar, children }: Props = $props();

	let open = $state(false);
	let menuButton = $state<HTMLButtonElement>();
	let sidebarEl = $state<HTMLElement>();

	function close(restoreFocus: boolean) {
		open = false;
		if (restoreFocus) menuButton?.focus();
	}

	async function toggle() {
		if (open) return close(true);
		open = true;
		// Wait for visibility to apply, then move focus into the sidebar.
		await Promise.resolve();
		sidebarEl?.querySelector<HTMLElement>('a, button, input')?.focus();
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && open) {
			event.preventDefault();
			close(true);
		}
	}

	// Close the drawer after navigating.
	$effect(() => {
		void page.url.pathname;
		open = false;
	});
</script>

<svelte:window onkeydown={onKeydown} />

<div class="shell">
	<header>
		<button
			bind:this={menuButton}
			class="menu-button"
			type="button"
			aria-expanded={open}
			aria-controls="app-sidebar"
			aria-label="Menu"
			onclick={toggle}
		>
			<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
				<path
					d="M4 6h16M4 12h16M4 18h16"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					fill="none"
				/>
			</svg>
		</button>
		<a class="brand" href={resolve('/')}>Tasks</a>
		<div class="header-end">
			<ThemeSwitch />
			{#if user}
				<div class="user-menu">
					<span class="user-name">{user.name}</span>
					{@render userActions?.()}
				</div>
			{/if}
		</div>
	</header>

	<div class="body">
		{#if open}
			<!-- Click-away layer for the drawer; keyboard users close it with Esc. -->
			<div class="backdrop" role="presentation" onclick={() => close(false)}></div>
		{/if}
		<aside id="app-sidebar" class="sidebar" class:open bind:this={sidebarEl} aria-label="Sidebar">
			{@render sidebar()}
		</aside>
		<main id="main">
			{@render children()}
		</main>
	</div>
</div>

<style>
	.shell {
		display: flex;
		flex-direction: column;
		min-height: 100dvh;
	}

	header {
		position: sticky;
		top: 0;
		z-index: 20;
		display: flex;
		align-items: center;
		gap: var(--space-3);
		height: var(--header-height);
		padding: 0 var(--space-4);
		background: var(--bg);
		border-bottom: 1px solid var(--border);
	}

	.brand {
		color: var(--fg);
		font-weight: 700;
		font-size: 1.125rem;
		text-decoration: none;
	}

	.brand:hover {
		color: var(--accent-purple);
	}

	.header-end {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		margin-left: auto;
		min-width: 0;
	}

	.user-menu {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-width: 0;
	}

	.user-name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		max-width: 12rem;
		font-size: 0.875rem;
		color: var(--muted);
	}

	.menu-button {
		display: none;
		align-items: center;
		justify-content: center;
		width: 2.25rem;
		height: 2.25rem;
		padding: 0;
		background: transparent;
		border: 1px solid transparent;
		border-radius: var(--radius-md);
		color: var(--fg);
	}

	.menu-button:hover {
		background: var(--surface-hover);
	}

	.body {
		position: relative;
		display: flex;
		flex: 1;
		min-height: 0;
	}

	.sidebar {
		flex: none;
		width: var(--sidebar-width);
		padding: var(--space-4) var(--space-3);
		border-right: 1px solid var(--border);
		background: var(--bg);
		overflow-y: auto;
	}

	/* min-width: 0 lets the main region shrink so wide content (List columns) scrolls inside it. */
	main {
		flex: 1;
		min-width: 0;
		padding: var(--space-5) var(--space-4);
		overflow-x: auto;
	}

	.backdrop {
		display: none;
	}

	@media (max-width: 768px) {
		.menu-button {
			display: inline-flex;
		}

		.sidebar {
			position: fixed;
			top: var(--header-height);
			bottom: 0;
			left: 0;
			z-index: 30;
			max-width: 85vw;
			visibility: hidden;
			transform: translateX(-100%);
			transition:
				transform 0.15s ease,
				visibility 0.15s;
		}

		.sidebar.open {
			visibility: visible;
			transform: none;
		}

		.backdrop {
			display: block;
			position: fixed;
			inset: var(--header-height) 0 0 0;
			z-index: 25;
			background: var(--overlay);
		}

		header {
			padding: 0 var(--space-3);
			gap: var(--space-2);
		}

		.user-name {
			display: none;
		}
	}
</style>
