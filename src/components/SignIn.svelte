<script>
  import Logo from './Logo.svelte';
  import OutlinedField from './OutlinedField.svelte';
  import Dialog from './Dialog.svelte';
  import { api } from '../lib/api.js';

  let { config, onsignedin, oncreate, initialError = '' } = $props();

  let step = $state('identifier');
  let identifier = $state('');
  let password = $state('');
  let showPassword = $state(false);
  let identifierError = $state('');
  let passwordError = $state('');
  let busy = $state(false);
  let forgotOpen = $state(false);
  let ssoHelpOpen = $state(false);

  const ssoUrl = '/auth/oidc/login';
  const ssoOnly = $derived(!config.passwordAuth && config.oidc.enabled);

  function next(e) {
    e.preventDefault();
    if (ssoOnly) {
      window.location.href = ssoUrl;
      return;
    }
    if (step === 'identifier') {
      if (!identifier.trim()) {
        identifierError = 'Enter an email or username';
        return;
      }
      identifierError = '';
      step = 'password';
      return;
    }
    signIn();
  }

  async function signIn() {
    if (!password) {
      passwordError = 'Enter a password';
      return;
    }
    busy = true;
    passwordError = '';
    try {
      const { user } = await api('POST', '/api/auth/login', { identifier: identifier.trim(), password });
      onsignedin(user);
    } catch (err) {
      passwordError = err.message;
    } finally {
      busy = false;
    }
  }

  function back() {
    step = 'identifier';
    password = '';
    passwordError = '';
  }
</script>

<Logo name={config.appName} />

{#if step === 'identifier'}
  <h1>Sign in</h1>
  <p class="subtitle">to continue to {config.appName}</p>

  <form class="auth-form" onsubmit={next} novalidate>
    {#if initialError}
      <p class="banner" role="alert">{initialError}</p>
    {/if}
    {#if ssoOnly}
      <section class="field-section sso-only">
        <a class="sso-button" href={ssoUrl}>Sign in with {config.oidc.name}</a>
        <p class="below"><button type="button" class="link" onclick={() => (ssoHelpOpen = true)}>Trouble signing in?</button></p>
      </section>
    {:else}
      <section class="field-section">
        <OutlinedField
          id="identifierId"
          name="identifier"
          label="Email or username"
          autocomplete="username"
          bind:value={identifier}
          error={identifierError}
        />
        <p class="below"><button type="button" class="link" onclick={() => (forgotOpen = true)}>Forgot password?</button></p>
      </section>
      {#if config.oidc.enabled}
        <div class="sso">
          <span class="or">or</span>
          <a class="sso-button" href={ssoUrl}>Sign in with {config.oidc.name}</a>
        </div>
      {/if}
    {/if}

    <p class="hint">
      Using a shared computer? Open a private window to sign in.
      <a href={`${config.links.help}#shared-devices`}>Learn more about private browsing</a>
    </p>

    <div class="actions">
      {#if config.signupEnabled && config.passwordAuth}
        <button type="button" class="btn-text start" onclick={oncreate}>Create account</button>
      {:else}
        <span></span>
      {/if}
      <button type="submit" class="btn-primary" id="identifierNext">Next</button>
    </div>
  </form>
{:else}
  <h1>Welcome</h1>
  <p class="subtitle chip-row">
    <button type="button" class="chip" onclick={back} aria-label={`Change account (${identifier})`}>
      <span class="avatar" aria-hidden="true">{identifier.trim().charAt(0).toUpperCase()}</span>
      <span class="chip-text">{identifier.trim()}</span>
      <svg width="10" height="5" viewBox="0 0 10 5" aria-hidden="true"><path d="M0 0l5 5 5-5z" fill="currentColor" /></svg>
    </button>
  </p>

  <form class="auth-form" onsubmit={next} novalidate>
    <input class="visually-hidden" tabindex="-1" aria-hidden="true" name="username" autocomplete="username" value={identifier} readonly />
    <section class="field-section">
      <OutlinedField
        id="password"
        name="password"
        type={showPassword ? 'text' : 'password'}
        label="Enter your password"
        autocomplete="current-password"
        bind:value={password}
        error={passwordError}
        autofocus
      />
      <p class="below check">
        <label><input type="checkbox" bind:checked={showPassword} /> Show password</label>
      </p>
    </section>

    <p class="hint">Signing in keeps you signed in on this browser for 30 days, or until you sign out.</p>

    <div class="actions">
      <button type="button" class="btn-text start" onclick={() => (forgotOpen = true)}>Forgot password?</button>
      <button type="submit" class="btn-primary" disabled={busy}>{busy ? 'Signing in…' : 'Next'}</button>
    </div>
  </form>
{/if}

<Dialog bind:open={forgotOpen} title="Reset your password">
  <p>Passwords are kept on this server only, so nobody can email you a new one.</p>
  <p class="spaced">Ask the person who runs this server to set a temporary password for you. {#if config.oidc.enabled}Or sign in with {config.oidc.name} instead.{/if}</p>
  {#snippet actions()}
    <button class="btn-primary" onclick={() => (forgotOpen = false)}>OK</button>
  {/snippet}
</Dialog>

<Dialog bind:open={ssoHelpOpen} title="Trouble signing in?">
  <p>This server signs you in through {config.oidc.name}. If that doesn’t work, ask the person who runs it to check that your account is allowed.</p>
  {#snippet actions()}
    <button class="btn-primary" onclick={() => (ssoHelpOpen = false)}>OK</button>
  {/snippet}
</Dialog>

<style>
  h1 {
    padding-top: 16px;
    font-size: var(--text-lg);
    line-height: 32px;
    font-weight: 400;
    text-align: center;
    color: var(--fg);
  }

  .subtitle {
    padding-top: 8px;
    font-size: var(--text-md);
    line-height: 24px;
    text-align: center;
    color: var(--fg);
  }

  :global(.auth-card) > :global(.logo) {
    display: flex;
    width: max-content;
    margin: 0 auto;
  }

  .auth-form {
    padding-top: var(--space-32);
  }

  .field-section {
    min-height: 88px;
  }

  .below {
    padding: var(--space-9) 0 var(--space-3);
    line-height: 20px;
  }

  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent-purple);
    font-size: var(--text-sm);
    font-weight: 500;
    letter-spacing: 0.25px;
    line-height: 20px;
  }

  .link:hover {
    text-decoration: underline;
  }

  .check label {
    display: inline-flex;
    gap: 12px;
    align-items: center;
    color: var(--fg);
    cursor: pointer;
  }

  .check input {
    width: 18px;
    height: 18px;
    margin: 0;
    accent-color: var(--accent-purple);
  }

  .hint {
    margin-top: var(--space-32);
    padding: var(--space-9) 0 var(--space-3);
    color: var(--muted);
    font-size: var(--text-sm);
    line-height: 20px;
  }

  .hint a {
    font-weight: 500;
    letter-spacing: 0.25px;
  }

  .actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: var(--space-32);
    padding-bottom: var(--space-36);
  }

  .start {
    margin-left: -8px;
  }

  .banner {
    margin-bottom: var(--space-24);
    padding: 12px 16px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--accent-pink) 12%, transparent);
    color: var(--accent-pink);
  }

  .sso {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-16);
    margin-top: var(--space-16);
  }

  .or {
    display: flex;
    align-items: center;
    gap: 12px;
    color: var(--muted);
    font-size: var(--text-xs);
  }

  .or::before,
  .or::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--border);
  }

  .sso-button {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 40px;
    padding: 0 var(--space-24);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    color: var(--accent-purple);
    font-weight: 500;
    letter-spacing: 0.25px;
  }

  .sso-only .sso-button {
    height: 56px;
    font-size: var(--text-md);
  }

  .sso-button:hover {
    background: var(--accent-soft);
    text-decoration: none;
  }

  .chip-row {
    display: flex;
    justify-content: center;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    max-width: 100%;
    height: 32px;
    padding: 0 12px 0 4px;
    border: 1px solid var(--border);
    border-radius: var(--radius-pill);
    background: transparent;
    color: var(--fg);
    font-size: var(--text-sm);
  }

  .chip:hover {
    background: var(--surface-hover);
  }

  .avatar {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--accent-purple);
    color: var(--on-accent);
    font-size: var(--text-xs);
  }

  .chip-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .spaced {
    margin-top: 12px;
  }
</style>
