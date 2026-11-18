<script>
  import { theme, setTheme } from '../lib/theme.svelte.js';
  let { config } = $props();
</script>

<footer class="auth-footer">
  <form class="theme-form" onsubmit={(e) => e.preventDefault()}>
    <label class="visually-hidden" for="theme-select">Colour theme</label>
    <div class="select-wrap">
      <select id="theme-select" value={theme.preference} onchange={(e) => setTheme(e.currentTarget.value)}>
        <option value="system">Theme: same as device</option>
        <option value="light">Theme: light</option>
        <option value="dark">Theme: dark</option>
      </select>
      <svg class="caret" width="10" height="5" viewBox="0 0 10 5" aria-hidden="true"><path d="M0 0l5 5 5-5z" fill="currentColor" /></svg>
    </div>
  </form>
  <ul class="links">
    <li><a href={config.links.help}>Help</a></li>
    <li><a href={config.links.privacy}>Privacy</a></li>
    <li><a href={config.links.terms}>Terms</a></li>
  </ul>
</footer>

<style>
  .auth-footer {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding: 0 0 var(--space-14);
    font-size: var(--text-xs);
    line-height: 16px;
  }

  .theme-form {
    margin-left: -16px;
  }

  .select-wrap {
    position: relative;
    color: var(--muted);
  }

  select {
    appearance: none;
    height: 48px;
    padding: 0 38px 0 16px;
    border: 0;
    border-radius: var(--radius-md);
    background: transparent;
    color: var(--muted);
    font-size: var(--text-xs);
    cursor: pointer;
  }

  select:hover {
    background: var(--surface-hover);
  }

  select option {
    background: var(--bg);
    color: var(--fg);
  }

  .caret {
    position: absolute;
    right: 8px;
    top: 22px;
    pointer-events: none;
  }

  .links {
    display: flex;
    margin-right: -16px;
  }

  .links a {
    display: block;
    padding: 16px;
    border-radius: var(--radius-md);
    color: var(--muted);
    font-size: var(--text-xs);
    line-height: 16px;
  }

  .links a:hover {
    background: var(--surface-hover);
    text-decoration: none;
  }
</style>
