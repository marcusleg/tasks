<script lang="ts">
	import { tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { getListStore } from '#lib/client/lists.svelte.js';
	import { MAX_LIST_NAME_LENGTH } from '#lib/domain/lists.js';

	const lists = getListStore();

	const links = [
		{ href: '/priority', label: 'Priority' },
		{ href: '/settings', label: 'Settings' }
	] as const;

	/** The List shown in the main area (`/` shows the last-viewed one). */
	const shownListId = $derived((page.data.list as { id: string } | null | undefined)?.id);

	let creating = $state(false);
	let name = $state('');
	let input = $state<HTMLInputElement>();

	async function startCreating() {
		creating = true;
		await tick();
		input?.focus();
	}

	function stopCreating() {
		creating = false;
		name = '';
	}

	async function create(event: SubmitEvent) {
		event.preventDefault();
		if (!name.trim()) return;
		const pending = lists.create(name);
		stopCreating();
		const id = await pending;
		if (id) await goto(resolve('/lists/[id]', { id }));
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			stopCreating();
		}
	}
</script>

<nav aria-label="Main">
	<section aria-labelledby="sidebar-lists-heading">
		<h2 id="sidebar-lists-heading">Lists</h2>
		<!-- #10 adds the List visibility checkboxes and reordering here. -->
		<!-- Preload on tap, not hover: loading a List marks it as last viewed. -->
		<ul data-sveltekit-preload-data="tap">
			{#each lists.all as list (list.id)}
				<li>
					<a
						href={resolve('/lists/[id]', { id: list.id })}
						aria-current={list.id === shownListId ? 'page' : undefined}
					>
						{list.name}
					</a>
				</li>
			{/each}
		</ul>
		{#if creating}
			<form class="new-list" onsubmit={create}>
				<label class="visually-hidden" for="new-list-name">New list name</label>
				<input
					bind:this={input}
					id="new-list-name"
					bind:value={name}
					placeholder="List name"
					maxlength={MAX_LIST_NAME_LENGTH}
					autocomplete="off"
					{onkeydown}
					onblur={() => {
						if (!name.trim()) stopCreating();
					}}
				/>
			</form>
		{:else}
			<button type="button" class="new-list-button" onclick={startCreating}>
				<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
					<path
						d="M12 5v14M5 12h14"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						fill="none"
					/>
				</svg>
				New list
			</button>
		{/if}
	</section>

	<ul>
		{#each links as link (link.href)}
			<li>
				<!-- Routes don't exist yet (#13, #18); switch to resolve() once they do. -->
				<!-- eslint-disable svelte/no-navigation-without-resolve -->
				<a
					href={link.href}
					aria-current={page.url.pathname.startsWith(link.href) ? 'page' : undefined}
				>
					{link.label}
				</a>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			</li>
		{/each}
	</ul>
</nav>

<style>
	nav {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	h2 {
		padding: 0 var(--space-3);
		margin-bottom: var(--space-2);
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--muted);
	}

	ul {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	a {
		display: block;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		color: var(--fg);
		text-decoration: none;
		overflow-wrap: anywhere;
	}

	a:hover {
		background: var(--surface-hover);
		color: var(--fg);
	}

	a[aria-current='page'] {
		background: var(--surface);
		font-weight: 700;
	}

	.new-list-button {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		width: 100%;
		margin-top: var(--space-1);
		padding: var(--space-2) var(--space-3);
		background: none;
		border: none;
		border-radius: var(--radius-md);
		color: var(--accent-purple);
		text-align: left;
	}

	.new-list-button:hover {
		background: var(--surface-hover);
	}

	.new-list {
		margin-top: var(--space-1);
	}

	.new-list input {
		width: 100%;
		padding: var(--space-2) var(--space-3);
		background: var(--surface);
		border: 1px solid var(--accent-purple);
		border-radius: var(--radius-md);
	}

	.new-list input:focus {
		outline: none;
	}
</style>
