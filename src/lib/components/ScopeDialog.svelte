<script lang="ts">
	import type { ScopePrompt } from '#lib/client/occurrence-scope.svelte.js';
	import { scopeFollows } from '#lib/client/scope-messages.js';
	import { m } from '#lib/paraglide/messages.js';

	/**
	 * The question "This occurrence" or "This and all future" for a change to a recurring Task
	 * (see `#lib/client/occurrence-scope.svelte.ts`), as a small modal `<dialog>`. Esc or Cancel
	 * discards the change; focus returns to where it was.
	 */
	let { prompt }: { prompt: ScopePrompt } = $props();

	let dialog = $state<HTMLDialogElement>();
	const id = $props.id();
	const question = $derived(prompt.question);

	$effect(() => {
		if (!dialog) return;
		if (question && !dialog.open) dialog.showModal();
		if (!question && dialog.open) dialog.close();
	});

	const deleting = $derived(question?.action === 'delete');
	const title = $derived(deleting ? m.scope_title_delete() : m.scope_title_edit());
	const message = $derived.by(() => {
		if (!question) return '';
		const { seriesTitle: series, subtaskTitle: subtask } = question;
		if (deleting) {
			return subtask
				? m.scope_delete_subtask({ subtask, series })
				: m.scope_delete_task({ series });
		}
		return subtask ? m.scope_edit_subtask({ subtask, series }) : m.scope_edit_task({ series });
	});
</script>

<dialog
	bind:this={dialog}
	aria-labelledby="{id}-title"
	aria-describedby="{id}-message"
	onclose={() => prompt.answer(null)}
>
	{#if question}
		<h2 id="{id}-title">{title}</h2>
		<p id="{id}-message">{message}</p>
		{#if question.remembersFor}
			<p class="note">{scopeFollows(question.remembersFor)}</p>
		{/if}
		<div class="actions">
			<button type="button" class="choice" onclick={() => prompt.answer('occurrence')}>
				{m.scope_occurrence()}
			</button>
			<button
				type="button"
				class="choice"
				class:danger={deleting}
				onclick={() => prompt.answer('future')}
			>
				{m.scope_future()}
			</button>
			<button type="button" class="cancel" onclick={() => prompt.answer(null)}
				>{m.scope_cancel()}</button
			>
		</div>
	{/if}
</dialog>

<style>
	dialog {
		width: min(26rem, calc(100vw - 2 * var(--space-4)));
		padding: var(--space-5);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		background: var(--bg);
		color: var(--fg);
	}

	dialog::backdrop {
		background: var(--overlay);
	}

	h2 {
		margin-bottom: var(--space-2);
	}

	p {
		color: var(--muted);
		overflow-wrap: anywhere;
	}

	.note {
		margin-top: var(--space-2);
		font-size: 0.875rem;
	}

	/* The two choices stacked full width, so their labels never wrap; Cancel below. */
	.actions {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: var(--space-2);
		margin-top: var(--space-5);
	}

	button {
		min-height: 2.75rem;
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius-md);
		font-weight: 700;
	}

	.choice {
		background: transparent;
		border: 1px solid var(--accent-purple);
		color: var(--fg);
	}

	.choice:hover {
		background: var(--surface-hover);
	}

	.choice.danger {
		border-color: var(--accent-pink);
		color: var(--accent-pink);
	}

	.cancel {
		background: transparent;
		border: 1px solid transparent;
		color: var(--muted);
	}

	.cancel:hover {
		background: var(--surface-hover);
		color: var(--fg);
	}
</style>
