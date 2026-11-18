<script>
  /** Centered card with the footer under it; on phones the card fills the screen and the footer sits at the bottom. */
  import AuthFooter from './AuthFooter.svelte';
  let { config, children } = $props();
</script>

<div class="auth-page">
  <div class="auth-wrap">
    <main class="auth-card">
      {@render children()}
    </main>
    <AuthFooter {config} />
  </div>
</div>

<style>
  .auth-page {
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    min-height: 100vh;
    min-height: 100dvh;
  }

  .auth-wrap {
    position: relative;
    width: var(--auth-card-width);
  }

  .auth-card {
    width: var(--auth-card-width);
    padding: var(--space-48) var(--space-40) 39px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg);
  }

  .auth-wrap :global(.auth-footer) {
    position: absolute;
    top: 100%;
    left: 1px;
    width: var(--footer-width);
  }

  @media (max-width: 599px) {
    .auth-page {
      justify-content: flex-start;
    }

    .auth-wrap {
      display: flex;
      flex-direction: column;
      flex: 1;
      width: 100%;
    }

    .auth-card {
      flex: 1;
      width: 100%;
      padding: var(--space-24) var(--space-24) 0;
      border: 0;
      border-radius: 0;
    }

    .auth-wrap :global(.auth-footer) {
      position: static;
      width: 100%;
      padding: 0 var(--space-24) var(--space-14);
    }
  }
</style>
