<script lang="ts">
	import { tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { getListStore } from '#lib/client/lists.svelte.js';
	import { hydration } from '#lib/client/hydration.svelte.js';
	import { dropIndex } from '#lib/client/reorder.js';
	import { MAX_LIST_NAME_LENGTH, moveToIndex } from '#lib/domain/lists.js';
	import { invalidate } from '$app/navigation';
	import { TASKS_DEPENDENCY } from '#lib/dependencies.js';

	const lists = getListStore();

	const links = [
		{ href: '/priority', label: 'Priority' },
		{ href: '/settings', label: 'Settings' }
	] as const;

	/** The List shown in the main area (`/` shows the last-viewed one). */
	const shownListId = $derived((page.data.list as { id: string } | null | undefined)?.id);

	let announcement = $state('');
	let listEl = $state<HTMLUListElement>();
	/** The entry being dragged: its index, how far the pointer moved, and where it would land. */
	let drag = $state<{ id: string; from: number; dy: number; to: number } | null>(null);
	let dragStartY = 0;

	async function toggle(id: string, visible: boolean) {
		const ok = await lists.update(id, { visible });
		// Showing a List needs its Tasks, which the page only loaded for the visible Lists.
		if (ok && visible) await invalidate(TASKS_DEPENDENCY);
	}

	/** Moves the List at `from` to index `to`; keeps focus on `focusEl` (re-inserted by the move). */
	async function moveTo(from: number, to: number, focusEl?: HTMLElement) {
		const all = lists.all;
		const move = moveToIndex(all, from, to);
		if (!move) return;
		const { id, name } = all[from];
		const target = Math.max(0, Math.min(all.length - 1, to));
		const done = lists.move(id, move);
		announcement = `${name} moved to position ${target + 1} of ${all.length}`;
		await tick();
		focusEl?.focus();
		await done;
	}

	function onItemKeydown(event: KeyboardEvent, index: number) {
		const onHandle = (event.target as HTMLElement).dataset.reorder !== undefined;
		if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
		// Arrow keys on the handle, or Alt+Arrow anywhere on the entry.
		if (!event.altKey && !onHandle) return;
		event.preventDefault();
		void moveTo(index, index + (event.key === 'ArrowUp' ? -1 : 1), event.target as HTMLElement);
	}

	function dragStart(event: PointerEvent, id: string, index: number) {
		if (event.pointerType === 'mouse' && event.button !== 0) return;
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		dragStartY = event.clientY;
		drag = { id, from: index, dy: 0, to: index };
	}

	function dragMove(event: PointerEvent) {
		if (!drag || !listEl) return;
		const others = [...listEl.querySelectorAll<HTMLElement>(':scope > li')].filter(
			(li) => li.dataset.listId !== drag!.id
		);
		const mids = others.map((li) => {
			const rect = li.getBoundingClientRect();
			return rect.top + rect.height / 2;
		});
		drag = { ...drag, dy: event.clientY - dragStartY, to: dropIndex(mids, event.clientY) };
	}

	function dragEnd(event: PointerEvent) {
		if (!drag) return;
		const { from, to } = drag;
		drag = null;
		if (event.type === 'pointerup') void moveTo(from, to);
	}

	function dragKeydown(event: KeyboardEvent) {
		if (drag && event.key === 'Escape') {
			event.preventDefault();
			event.stopPropagation();
			drag = null;
		}
	}

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
		<!-- Preload on tap, not hover: loading a List marks it as last viewed. -->
		<ul bind:this={listEl} class="lists" data-sveltekit-preload-data="tap">
			{#each lists.all as list, index (list.id)}
				{@const others = lists.all.filter((l) => l.id !== drag?.id)}
				<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
				<li
					data-list-id={list.id}
					class:dragging={drag?.id === list.id}
					class:drop-before={drag && drag.id !== list.id && others[drag.to]?.id === list.id}
					class:drop-after={drag &&
						drag.id !== list.id &&
						drag.to === others.length &&
						others.at(-1)?.id === list.id}
					style:transform={drag?.id === list.id ? `translateY(${drag.dy}px)` : undefined}
					onkeydown={(event) => onItemKeydown(event, index)}
				>
					<button
						type="button"
						class="handle"
						data-reorder
						disabled={!hydration.done}
						aria-label="Reorder {list.name}"
						aria-describedby="reorder-hint"
						onpointerdown={(event) => dragStart(event, list.id, index)}
						onpointermove={dragMove}
						onpointerup={dragEnd}
						onpointercancel={dragEnd}
						onkeydown={dragKeydown}
					>
						<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
							<path
								d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"
								stroke="currentColor"
								stroke-width="3"
								stroke-linecap="round"
							/>
						</svg>
					</button>
					<input
						type="checkbox"
						aria-label="Show {list.name}"
						checked={list.visible}
						disabled={!hydration.done}
						onchange={(event) => toggle(list.id, event.currentTarget.checked)}
					/>
					<a
						href={resolve('/lists/[id]', { id: list.id })}
						aria-current={list.id === shownListId ? 'page' : undefined}
					>
						{list.name}
					</a>
				</li>
			{/each}
		</ul>
		<p id="reorder-hint" class="visually-hidden">
			Drag to reorder, or press Arrow Up or Arrow Down. Alt+Arrow works on any part of the entry.
		</p>
		<p class="visually-hidden" role="status" aria-live="polite">{announcement}</p>
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
			<button
				type="button"
				class="new-list-button"
				disabled={!hydration.done}
				onclick={startCreating}
			>
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

	.lists li {
		position: relative;
		display: flex;
		align-items: center;
		gap: var(--space-1);
		border-radius: var(--radius-md);
	}

	.lists li.dragging {
		z-index: 2;
		background: var(--surface-hover);
		box-shadow: 0 2px 8px var(--overlay);
		opacity: 0.9;
	}

	.lists li.drop-before::before,
	.lists li.drop-after::after {
		content: '';
		position: absolute;
		left: 0;
		right: 0;
		height: 2px;
		background: var(--accent-purple);
	}

	.lists li.drop-before::before {
		top: -3px;
	}

	.lists li.drop-after::after {
		bottom: -3px;
	}

	.lists li a {
		flex: 1;
		min-width: 0;
	}

	.handle {
		flex: none;
		display: grid;
		place-items: center;
		width: 1.5rem;
		height: 2rem;
		padding: 0;
		background: none;
		border: none;
		border-radius: var(--radius-sm);
		color: var(--muted);
		cursor: grab;
		/* Dragging with a finger must not scroll the sidebar. */
		touch-action: none;
	}

	.handle:hover {
		color: var(--fg);
		background: var(--surface-hover);
	}

	.lists li.dragging .handle {
		cursor: grabbing;
	}

	li > input[type='checkbox'] {
		flex: none;
		margin: 0 var(--space-1);
		accent-color: var(--accent-purple);
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
