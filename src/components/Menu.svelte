<script>
  /** Pop-up menu attached to a trigger button. Closes on outside click or Escape. */
  let { label, trigger, children, align = 'right', open = $bindable(false) } = $props();
  let root = $state(null);

  function onDocClick(e) {
    if (open && root && !root.contains(e.target)) open = false;
  }
  function onKey(e) {
    if (open && e.key === 'Escape') open = false;
  }
</script>

<svelte:document onclick={onDocClick} onkeydown={onKey} />

<div class="menu-root" bind:this={root}>
  <button
    type="button"
    class="icon-btn"
    aria-label={label}
    title={label}
    aria-haspopup="menu"
    aria-expanded={open}
    onclick={() => (open = !open)}
  >
    {@render trigger()}
  </button>
  {#if open}
    <div class="panel {align}" role="menu" tabindex="-1" onclick={(e) => { if (e.target.closest('[data-close]')) open = false; }} onkeydown={() => {}}>
      {@render children()}
    </div>
  {/if}
</div>

<style>
  .menu-root {
    position: relative;
  }

  .panel {
    position: absolute;
    top: calc(100% + 4px);
    z-index: 30;
    min-width: 240px;
    padding: 8px 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    box-shadow: var(--shadow);
  }

  .panel.right {
    right: 0;
  }

  .panel.left {
    left: 0;
  }

  .panel :global(.menu-item) {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    min-height: 40px;
    padding: 8px 16px;
    border: 0;
    background: transparent;
    color: var(--fg);
    font-size: var(--text-sm);
    text-align: left;
  }

  .panel :global(.menu-item:hover) {
    background: var(--surface-hover);
    text-decoration: none;
  }

  .panel :global(.menu-item:disabled) {
    color: var(--muted);
    cursor: default;
    background: transparent;
  }

  .panel :global(.menu-label) {
    padding: 8px 16px 4px;
    color: var(--muted);
    font-size: var(--text-xs);
  }

  .panel :global(.menu-sep) {
    height: 1px;
    margin: 8px 0;
    background: var(--border);
  }

  .panel :global(.menu-item .tick) {
    width: 20px;
    color: var(--accent-purple);
  }
</style>
