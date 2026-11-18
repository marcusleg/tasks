<script>
  import Logo from './Logo.svelte';
  import OutlinedField from './OutlinedField.svelte';
  import { api } from '../lib/api.js';

  let { config, onsignedin, onback } = $props();

  let name = $state('');
  let identifier = $state('');
  let password = $state('');
  let confirm = $state('');
  let showPassword = $state(false);
  let errors = $state({});
  let busy = $state(false);

  async function submit(e) {
    e.preventDefault();
    const next = {};
    if (!identifier.trim()) next.identifier = 'Choose an email or username';
    if (password.length < 8) next.password = 'Use 8 characters or more for your password';
    else if (password !== confirm) next.confirm = 'Those passwords didn’t match. Try again.';
    errors = next;
    if (Object.keys(next).length) return;
    busy = true;
    try {
      const { user } = await api('POST', '/api/auth/register', {
        name: name.trim(),
        identifier: identifier.trim(),
        password
      });
      onsignedin(user);
    } catch (err) {
      if (err.code === 'identifier_taken') errors = { identifier: err.message };
      else if (err.code === 'weak_password') errors = { password: err.message };
      else errors = { form: err.message };
    } finally {
      busy = false;
    }
  }
</script>

<Logo name={config.appName} />
<h1>Create an account</h1>
<p class="subtitle">to start using {config.appName}</p>

<form class="auth-form" onsubmit={submit} novalidate>
  {#if errors.form}<p class="banner" role="alert">{errors.form}</p>{/if}
  <div class="stack">
    <OutlinedField id="name" label="Name (optional)" autocomplete="name" bind:value={name} autofocus />
    <OutlinedField id="new-identifier" label="Email or username" autocomplete="username" bind:value={identifier} error={errors.identifier} />
    <OutlinedField
      id="new-password"
      type={showPassword ? 'text' : 'password'}
      label="Password"
      autocomplete="new-password"
      bind:value={password}
      error={errors.password}
    />
    <OutlinedField
      id="confirm-password"
      type={showPassword ? 'text' : 'password'}
      label="Confirm password"
      autocomplete="new-password"
      bind:value={confirm}
      error={errors.confirm}
    />
  </div>
  <p class="hint">Use 8 or more characters.</p>
  <p class="check">
    <label><input type="checkbox" bind:checked={showPassword} /> Show password</label>
  </p>

  <div class="actions">
    <button type="button" class="btn-text start" onclick={onback}>Sign in instead</button>
    <button type="submit" class="btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Next'}</button>
  </div>
</form>

<style>
  h1 {
    padding-top: 16px;
    font-size: var(--text-lg);
    line-height: 32px;
    font-weight: 400;
    text-align: center;
  }

  .subtitle {
    padding-top: 8px;
    font-size: var(--text-md);
    line-height: 24px;
    text-align: center;
  }

  .auth-form {
    padding-top: var(--space-32);
  }

  .stack {
    display: flex;
    flex-direction: column;
    gap: var(--space-24);
  }

  .hint {
    padding: var(--space-9) 0 var(--space-3);
    color: var(--muted);
    font-size: var(--text-xs);
    line-height: 16px;
  }

  .check {
    padding-top: var(--space-16);
  }

  .check label {
    display: inline-flex;
    gap: 12px;
    align-items: center;
    cursor: pointer;
  }

  .check input {
    width: 18px;
    height: 18px;
    margin: 0;
    accent-color: var(--accent-purple);
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
</style>
