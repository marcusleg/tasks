<script>
  /** Modal dialog built on the native <dialog> element. */
  let { open = $bindable(false), title, children, actions, onclose = () => {}, wide = false } = $props();
  let el = $state(null);

  $effect(() => {
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  });
</script>

<dialog
  bind:this={el}
  class:wide
  aria-labelledby="dialog-title"
  onclose={() => {
    open = false;
    onclose();
  }}
  onclick={(e) => {
    if (e.target === el) el.close();
  }}
>
  {#if open}
    <div class="inner">
      <h2 id="dialog-title">{title}</h2>
      <div class="body">{@render children()}</div>
      {#if actions}<div class="actions">{@render actions()}</div>{/if}
    </div>
  {/if}
</dialog>

<style>
  dialog {
    width: min(420px, calc(100vw - 32px));
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg);
    color: var(--fg);
    box-shadow: var(--shadow);
  }

  dialog.wide {
    width: min(520px, calc(100vw - 32px));
  }

  dialog::backdrop {
    background: var(--overlay);
  }

  .inner {
    padding: var(--space-24);
  }

  h2 {
    font-size: 22px;
    line-height: 28px;
    font-weight: 400;
    margin-bottom: var(--space-16);
  }

  .body {
    color: var(--muted);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-8);
    margin-top: var(--space-24);
  }
</style>
