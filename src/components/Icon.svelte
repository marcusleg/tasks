<script>
  /** Simple line icons drawn on a 24px grid. */
  let { name, size = 24, filled = false } = $props();

  const paths = {
    menu: 'M3 6h18M3 12h18M3 18h18',
    plus: 'M12 5v14M5 12h14',
    more: '',
    star: 'M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z',
    check: 'M5 12.5l4.5 4.5L19 7.5',
    close: 'M6 6l12 12M18 6L6 18',
    trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
    calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
    chevronDown: 'M6 9l6 6 6-6',
    chevronRight: 'M9 6l6 6-6 6',
    chevronLeft: 'M15 6l-6 6 6 6',
    notes: 'M4 6h16M4 12h16M4 18h10',
    subtask: 'M6 4v10a3 3 0 0 0 3 3h9M14 13l4 4-4 4',
    logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11',
    sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
    moon: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z',
    monitor: 'M3 4h18v12H3zM8 20h8M12 16v4',
    drag: '',
    allTasks: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 12.5l2.7 2.7L16 9.8',
    key: 'M14 10a4 4 0 1 1-1.2-2.8M12.8 7.2L20 0M17 3l3 3',
    lock: 'M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3',
    error: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5v6M12 16.5v.01',
    clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
    list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
    edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
    sort: 'M4 7h16M7 12h10M10 17h4',
    login: 'M10 4H5v16h5M14 8l4 4-4 4M18 12H8',
    repeat: 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3'
  };
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#if name === 'more'}
    <circle cx="12" cy="5" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="12" cy="19" r="1.6" fill="currentColor" stroke="none" />
  {:else if name === 'drag'}
    {#each [6, 12, 18] as y (y)}
      <circle cx="9" cy={y} r="1.4" fill="currentColor" stroke="none" />
      <circle cx="15" cy={y} r="1.4" fill="currentColor" stroke="none" />
    {/each}
  {:else}
    <path d={paths[name]} fill={filled ? 'currentColor' : 'none'} />
  {/if}
</svg>
