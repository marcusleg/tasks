<script lang="ts">
	import { getTaskStore } from '#lib/client/tasks.svelte.js';
	import { MAX_TITLE_LENGTH } from '#lib/domain/tasks.js';

	/** "Add a task": Enter adds the Task at the top of the List and keeps the field ready for the next one. */
	let { listId }: { listId: string } = $props();

	const store = getTaskStore();
	const id = $props.id();
	let title = $state('');

	function submit(event: SubmitEvent) {
		event.preventDefault();
		if (!title.trim()) return;
		store.add(listId, title);
		title = '';
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
		<span class="visually-hidden">Add a task</span>
	</label>
	<input
		id="{id}-title"
		bind:value={title}
		{onkeydown}
		placeholder="Add a task"
		maxlength={MAX_TITLE_LENGTH}
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
