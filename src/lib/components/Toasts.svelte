<script lang="ts">
	import type { Toasts } from '#lib/client/toasts.svelte.js';

	let { toasts }: { toasts: Toasts } = $props();
</script>

<!-- Always rendered, so screen readers pick up messages added to it. -->
<div class="toasts" role="status" aria-live="polite">
	{#each toasts.items as toast (toast.id)}
		<div class="toast">
			<span>{toast.message}</span>
			<button type="button" aria-label="Dismiss" onclick={() => toasts.dismiss(toast.id)}>
				<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
					<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" fill="none" />
				</svg>
			</button>
		</div>
	{/each}
</div>

<style>
	.toasts {
		position: fixed;
		left: 50%;
		bottom: var(--space-4);
		z-index: 60;
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		width: min(28rem, calc(100vw - 2 * var(--space-4)));
		transform: translateX(-50%);
		pointer-events: none;
	}

	.toast {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-3) var(--space-4);
		border-radius: var(--radius-md);
		background: var(--fg);
		color: var(--bg);
		font-size: 0.875rem;
		pointer-events: auto;
	}

	span {
		flex: 1;
	}

	button {
		display: inline-flex;
		padding: var(--space-1);
		background: none;
		border: none;
		border-radius: var(--radius-sm);
		color: inherit;
	}
</style>
