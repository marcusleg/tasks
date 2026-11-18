<script>
  import { store, dismissToast } from '../lib/store.svelte.js';
</script>

<div class="toasts" aria-live="polite">
  {#each store.toasts as t (t.id)}
    <div class="toast">
      <span>{t.message}</span>
      {#if t.action}
        <button
          type="button"
          onclick={() => {
            dismissToast(t.id);
            t.action.run();
          }}>{t.action.label}</button
        >
      {/if}
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    left: 24px;
    bottom: 24px;
    z-index: 50;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-width: calc(100vw - 48px);
  }

  .toast {
    display: flex;
    align-items: center;
    gap: 24px;
    min-height: 48px;
    padding: 6px 8px 6px 16px;
    border-radius: var(--radius-sm);
    background: var(--fg);
    color: var(--bg);
    box-shadow: var(--shadow);
  }

  button {
    height: 36px;
    padding: 0 8px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--inverse-accent);
    font-weight: 700;
  }

  button:hover {
    background: color-mix(in srgb, var(--inverse-accent) 15%, transparent);
  }
</style>
