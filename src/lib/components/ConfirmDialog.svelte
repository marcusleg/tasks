<script lang="ts">
	/**
	 * A modal confirmation (native `<dialog>`): Esc or Cancel dismisses it, focus starts on Cancel
	 * and returns to where it was when the dialog closes.
	 */
	type Props = {
		open: boolean;
		title: string;
		message: string;
		confirmLabel: string;
		onConfirm: () => void;
	};

	let { open = $bindable(), title, message, confirmLabel, onConfirm }: Props = $props();

	let dialog = $state<HTMLDialogElement>();
	const id = $props.id();

	$effect(() => {
		if (!dialog) return;
		if (open && !dialog.open) dialog.showModal();
		if (!open && dialog.open) dialog.close();
	});

	function confirm() {
		open = false;
		onConfirm();
	}
</script>

<dialog
	bind:this={dialog}
	aria-labelledby="{id}-title"
	aria-describedby="{id}-message"
	onclose={() => (open = false)}
>
	<h2 id="{id}-title">{title}</h2>
	<p id="{id}-message">{message}</p>
	<div class="actions">
		<!-- First in the dialog, so showModal() focuses it. -->
		<button type="button" class="secondary" onclick={() => (open = false)}>Cancel</button>
		<button type="button" class="danger" onclick={confirm}>{confirmLabel}</button>
	</div>
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
		overflow-wrap: anywhere;
	}

	p {
		color: var(--muted);
		overflow-wrap: anywhere;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-2);
		margin-top: var(--space-5);
	}

	button {
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius-md);
		font-weight: 700;
	}

	.secondary {
		background: transparent;
		border: 1px solid var(--border);
	}

	.secondary:hover {
		background: var(--surface-hover);
	}

	.danger {
		background: var(--accent-pink);
		border: 1px solid var(--accent-pink);
		color: var(--on-accent);
	}
</style>
