<script>
  /**
   * Priority marker: three bars like a signal meter, as many filled as the level (Low 1, Medium 2,
   * High 3), so levels differ by shape as well as colour. No priority: all bars outlined and muted.
   * Decorative; the surrounding control carries the name.
   */
  let { priority = null, size = 16 } = $props();
  const LEVEL = { low: 1, medium: 2, high: 3 };
  const level = $derived(priority ? LEVEL[priority] : 0);
  const bars = [
    { x: 1.5, height: 5 },
    { x: 6.5, height: 8.5 },
    { x: 11.5, height: 12 }
  ];
</script>

<svg class="marker {priority ?? 'none'}" viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
  {#each bars as bar, i (bar.x)}
    <rect x={bar.x} y={14.5 - bar.height} width="3" height={bar.height} rx="0.75" class:filled={i < level} />
  {/each}
</svg>

<style>
  .marker {
    flex: none;
  }

  rect {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.25;
    opacity: 0.45;
  }

  rect.filled {
    fill: currentColor;
    opacity: 1;
  }

  .high {
    color: var(--accent-pink);
  }

  .medium {
    color: var(--accent-orange);
  }

  .low {
    color: var(--accent-cyan);
  }

  .none {
    color: var(--muted);
  }
</style>
