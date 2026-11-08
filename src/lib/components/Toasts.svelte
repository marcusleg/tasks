<script lang="ts">
	import { m } from '#lib/paraglide/messages.js';
	import type { Toasts } from '#lib/client/toasts.svelte.js';

	let { toasts }: { toasts: Toasts } = $props();

	/** Where focus was before it moved into a toast, to go back there when the toast goes. */
	let returnFocus: HTMLElement | null = null;

	function isTextField(target: EventTarget | null): boolean {
		if (!(target instanceof HTMLElement)) return false;
		if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true;
		if (target instanceof HTMLSelectElement) return true;
		return (
			target instanceof HTMLInputElement &&
			!['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(
				target.type
			)
		);
	}

	/** Ctrl+Z (Cmd+Z on macOS) runs the current Undo, unless a text field has its own undo. */
	function onWindowKeydown(event: KeyboardEvent) {
		if (event.key.toLowerCase() !== 'z' || !(event.ctrlKey || event.metaKey)) return;
		if (event.shiftKey || event.altKey || event.repeat || event.defaultPrevented) return;
		if (isTextField(event.target) || isTextField(document.activeElement)) return;
		if (document.querySelector('dialog[open]')) return;
		if (!toasts.actionable) return;
		event.preventDefault();
		toasts.actCurrent();
	}

	function onFocusIn(event: FocusEvent, id: number) {
		toasts.pause(id, 'focus');
		const from = event.relatedTarget;
		if (from instanceof HTMLElement && !(event.currentTarget as HTMLElement).contains(from)) {
			returnFocus = from;
		}
	}

	function onFocusOut(event: FocusEvent, id: number) {
		const to = event.relatedTarget;
		if (to instanceof Node && (event.currentTarget as HTMLElement).contains(to)) return;
		toasts.resume(id, 'focus');
	}

	/** Runs the action; focus would otherwise fall to the page when the toast goes away. */
	function act(id: number) {
		const back = returnFocus;
		returnFocus = null;
		toasts.act(id);
		if (back?.isConnected) back.focus();
	}
</script>

<svelte:window onkeydown={onWindowKeydown} />

<!-- Always rendered, so screen readers pick up messages added to it. -->
<div class="toasts" role="status" aria-live="polite" aria-label={m.toast_notifications()}>
	{#each toasts.items as toast (toast.id)}
		<div
			class="toast"
			role="group"
			aria-label={m.toast_notification()}
			onmouseenter={() => toasts.pause(toast.id, 'hover')}
			onmouseleave={() => toasts.resume(toast.id, 'hover')}
			onfocusin={(event) => onFocusIn(event, toast.id)}
			onfocusout={(event) => onFocusOut(event, toast.id)}
		>
			<span class="message">{toast.message}</span>
			{#if toast.action}
				<button
					type="button"
					class="action"
					aria-keyshortcuts="Control+Z Meta+Z"
					onclick={() => act(toast.id)}
				>
					{toast.action.label}
				</button>
			{/if}
			<button
				type="button"
				class="dismiss"
				aria-label={m.toast_dismiss()}
				onclick={() => toasts.dismiss(toast.id)}
			>
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
		/* Clear of the home indicator on phones (the viewport covers the safe areas). */
		bottom: calc(var(--space-4) + env(safe-area-inset-bottom));
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
		gap: var(--space-2);
		padding: var(--space-2) var(--space-2) var(--space-2) var(--space-4);
		min-height: 3rem;
		border-radius: var(--radius-md);
		background: var(--fg);
		color: var(--bg);
		font-size: 0.875rem;
		box-shadow: 0 6px 18px var(--overlay);
		pointer-events: auto;
	}

	.message {
		flex: 1;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 2.25rem;
		background: none;
		border: none;
		border-radius: var(--radius-sm);
		color: inherit;
		font: inherit;
		cursor: pointer;
	}

	button:focus-visible {
		outline: 2px solid var(--bg);
		outline-offset: 1px;
	}

	.action {
		flex: none;
		padding: 0 var(--space-3);
		border: 1px solid color-mix(in srgb, var(--bg) 45%, transparent);
		font-weight: 700;
	}

	.action:hover {
		background: color-mix(in srgb, var(--bg) 15%, transparent);
	}

	.dismiss {
		flex: none;
		min-width: 2.25rem;
		padding: var(--space-1);
	}
</style>
