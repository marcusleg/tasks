<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { getListStore } from '#lib/client/lists.svelte.js';
	import ListPage from '#lib/components/tasks/ListPage.svelte';
	import { MAX_LIST_NAME_LENGTH } from '#lib/domain/lists.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const lists = getListStore();
	let name = $state('');

	async function create(event: SubmitEvent) {
		event.preventDefault();
		if (!name.trim()) return;
		const id = await lists.create(name);
		if (id) await goto(resolve('/lists/[id]', { id }));
	}
</script>

<svelte:head>
	{#if !data.list}<title>Tasks</title>{/if}
</svelte:head>

{#if data.list}
	{#key data.list.id}
		<ListPage list={data.list} tasks={data.tasks} />
	{/key}
{:else}
	<section class="no-lists">
		<h1>No lists yet</h1>
		<p>Create a list to start adding tasks.</p>
		<form onsubmit={create}>
			<label for="first-list-name">List name</label>
			<div class="row">
				<input
					id="first-list-name"
					bind:value={name}
					maxlength={MAX_LIST_NAME_LENGTH}
					autocomplete="off"
				/>
				<button type="submit">Create list</button>
			</div>
		</form>
	</section>
{/if}

<style>
	.no-lists {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		max-width: 28rem;
	}

	p,
	label {
		color: var(--muted);
	}

	label {
		display: block;
		margin-bottom: var(--space-1);
		font-size: 0.875rem;
	}

	.row {
		display: flex;
		gap: var(--space-2);
	}

	input {
		flex: 1;
		min-width: 0;
		padding: var(--space-2) var(--space-3);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
	}

	button {
		padding: var(--space-2) var(--space-4);
		background: var(--accent-purple);
		border: none;
		border-radius: var(--radius-md);
		color: var(--on-accent);
		font-weight: 700;
	}
</style>
