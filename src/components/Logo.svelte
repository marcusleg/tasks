<script>
  /** App mark: gradient check icon plus the wordmark with the brand rule underneath. 74×24 like the original. */
  let { name = 'Tasks', size = 'auth' } = $props();
</script>

<span class="logo" class:header={size === 'header'} role="img" aria-label={name}>
  <svg viewBox="0 0 512 512" aria-hidden="true">
    <defs>
      <linearGradient id="logo-g" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="512" y2="512">
        <stop offset="0%" stop-color="#fd971f" />
        <stop offset="50%" stop-color="#f92672" />
        <stop offset="100%" stop-color="#ae81ff" />
      </linearGradient>
    </defs>
    <rect width="512" height="512" rx="112" fill="url(#logo-g)" />
    <circle cx="256" cy="256" r="164" fill="none" stroke="#fff" stroke-width="28" />
    <path d="M178 262 L234 318 L338 196" fill="none" stroke="#fff" stroke-width="46" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
  <span class="word">{name}</span>
</span>

<style>
  .logo {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 24px;
    min-width: 74px;
    color: var(--fg);
  }

  svg {
    width: 24px;
    height: 24px;
    flex: none;
  }

  .word {
    position: relative;
    font-size: 18px;
    line-height: 22px;
    font-weight: 700;
    letter-spacing: -0.2px;
    white-space: nowrap;
  }

  .word::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: -2px;
    height: 2px;
    border-radius: 1px;
    background: var(--brand-rule);
  }

  .header svg {
    width: 32px;
    height: 32px;
  }

  .header {
    gap: 10px;
    height: 32px;
  }

  .header .word {
    font-size: 24px;
    line-height: 26px;
    font-weight: 400;
  }
</style>
