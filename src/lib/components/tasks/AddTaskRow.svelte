<script lang="ts">
	import { navigating } from '$app/state';
	import { hydration } from '#lib/client/hydration.svelte.js';
	import { getScopePrompt, ScopedTasks } from '#lib/client/occurrence-scope.svelte.js';
	import { getTaskStore } from '#lib/client/tasks.svelte.js';
	import { MAX_TITLE_LENGTH } from '#lib/domain/tasks.js';

	/**
	 * "Add a task": Enter adds the Task at the top of the List and keeps the field ready for the
	 * next one. With `parentId` it adds Subtasks instead, at the bottom of the parent's Subtasks;
	 * for a recurring parent `ScopedTasks` asks first (if cancelled, the title stays). Pass the
	 * detail panel's `scopes` so its remembered answers apply.
	 */
	type Props = {
		listId: string;
		parentId?: string | null;
		label?: string;
		scopes?: ScopedTasks;
	};

	let { listId, parentId = null, label = 'Add a task', scopes: panelScopes }: Props = $props();

	const scopes = $derived(panelScopes ?? new ScopedTasks(getScopePrompt(), getTaskStore()));
	const id = $props.id();
	let title = $state('');
	// Not usable before hydration (Enter would submit a native form and lose the Title), nor while
	// the page is navigating to another route, e.g. to another List: what is typed meanwhile
	// would be about to belong to a List the User is leaving.
	const leaving = $derived(
		navigating.to !== null && navigating.to.url.pathname !== navigating.from?.url.pathname
	);

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		const adding = title;
		if (!adding.trim()) return;
		const id = await scopes.add(listId, adding, parentId);
		if (id !== null && title === adding) title = '';
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && title) {
			event.stopPropagation();
			title = '';
		}
	}
</script>

<form class="add" onsubmit={submit}>
	<label for="{id}-title">
		<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
			<path
				d="M12 5v14M5 12h14"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				fill="none"
			/>
		</svg>
		<span class="visually-hidden">{label}</span>
	</label>
	<input
		id="{id}-title"
		bind:value={title}
		{onkeydown}
		placeholder={label}
		maxlength={MAX_TITLE_LENGTH}
		disabled={!hydration.done || leaving}
		autocomplete="off"
		enterkeyhint="enter"
	/>
</form>

<style>
	.add {
		display: flex;
		align-items: center;
		gap: var(--space-1);
		padding: 0 var(--space-2) 0 var(--space-1);
		border-radius: var(--radius-md);
	}

	.add:hover {
		background: var(--surface-hover);
	}

	label {
		display: grid;
		place-items: center;
		flex: none;
		width: 2.5rem;
		height: 2.75rem;
		color: var(--accent-purple);
		cursor: text;
	}

	input {
		flex: 1;
		min-width: 0;
		height: 2.75rem;
		padding: 0;
		background: transparent;
		border: none;
		outline: none;
	}

	input::placeholder {
		color: var(--accent-purple);
		opacity: 1;
	}

	input:focus::placeholder {
		color: var(--muted);
	}

	.add:focus-within {
		box-shadow: inset 0 -2px 0 var(--accent-purple);
		border-radius: var(--radius-md) var(--radius-md) 0 0;
	}
</style>
