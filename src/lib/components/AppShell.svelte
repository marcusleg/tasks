<script lang="ts">
	import { hydration } from '#lib/client/hydration.svelte.js';
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import UserMenu from './UserMenu.svelte';
	import { m } from '#lib/paraglide/messages.js';

	type Props = {
		/** The signed-in user. The user area is not rendered when absent. */
		user?: { name: string } | null;
		/** Extra controls in the user menu below the theme switch, e.g. a logout button. */
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
			disabled={!hydration.done}
			type="button"
			aria-expanded={open}
			aria-controls="app-sidebar"
			aria-label={m.shell_menu()}
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
		{#if user}
			<div class="header-end">
				<UserMenu name={user.name} actions={userActions} />
			</div>
		{/if}
	</header>

	<div class="body">
		{#if open}
			<!-- Click-away layer for the drawer; keyboard users close it with Esc. -->
			<div class="backdrop" role="presentation" onclick={() => close(false)}></div>
		{/if}
		<aside
			id="app-sidebar"
			class="sidebar"
			class:open
			bind:this={sidebarEl}
			aria-label={m.shell_sidebar()}
		>
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
		box-sizing: content-box;
		height: var(--header-height);
		padding: env(safe-area-inset-top) max(var(--space-4), env(safe-area-inset-right)) 0
			max(var(--space-4), env(safe-area-inset-left));
		background: var(--bg);
		border-bottom: 1px solid var(--border);
	}

	.brand {
		position: relative;
		padding-block: 0.3em;
		color: var(--fg);
		font-weight: 700;
		font-size: 1.125rem;
		line-height: 1;
		text-decoration: none;
	}

	.brand::after {
		content: '';
		position: absolute;
		left: 0;
		bottom: 0;
		width: 100%;
		height: 3px;
		border-radius: 2px;
		background: var(--brand-rule);
		transform-origin: left;
		transition: transform 0.25s ease;
	}

	/* The text keeps its colour; the rule shrinks back like a progress bar. */
	.brand:hover {
		color: var(--fg);
	}

	.brand:hover::after,
	.brand:focus-visible::after {
		transform: scaleX(0.35);
	}

	.header-end {
		display: flex;
		align-items: center;
		gap: var(--space-4);
		margin-left: auto;
		min-width: 0;
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
		padding: var(--space-5) max(var(--space-4), env(safe-area-inset-right))
			calc(var(--space-5) + env(safe-area-inset-bottom))
			max(var(--space-4), env(safe-area-inset-left));
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
			top: calc(var(--header-height) + env(safe-area-inset-top));
			bottom: 0;
			padding-bottom: calc(var(--space-4) + env(safe-area-inset-bottom));
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
			inset: calc(var(--header-height) + env(safe-area-inset-top)) 0 0 0;
			z-index: 25;
			background: var(--overlay);
		}

		header {
			padding-right: max(var(--space-3), env(safe-area-inset-right));
			padding-left: max(var(--space-3), env(safe-area-inset-left));
			gap: var(--space-2);
		}
	}
</style>
