<script>
  import AuthLayout from './components/AuthLayout.svelte';
  import SignIn from './components/SignIn.svelte';
  import SignUp from './components/SignUp.svelte';
  import TasksApp from './components/TasksApp.svelte';
  import InfoPage from './components/InfoPage.svelte';
  import { api, loadConfig, FALLBACK_CONFIG } from './lib/api.js';

  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  const infoPage = ['/help', '/privacy', '/terms'].includes(path) ? path.slice(1) : null;

  const authErrors = {
    oidc_failed: 'Single sign-on didn’t finish. Try again.',
    oidc_state: 'That sign-in link expired. Try again.',
    oidc_not_allowed: 'Your account isn’t allowed to use this server. Ask its administrator for access.',
    oidc_signup_disabled: 'There’s no account for you on this server yet. Ask its administrator to create one.',
    oidc_disabled: 'Single sign-on isn’t set up on this server.'
  };
  const params = new URLSearchParams(window.location.search);
  const initialError = authErrors[params.get('auth_error')] ?? '';
  if (params.has('auth_error')) history.replaceState(null, '', window.location.pathname);

  const hinted = document.cookie.split('; ').includes('tasks_signed_in=1');

  let config = $state(FALLBACK_CONFIG);
  let user = $state(null);
  let phase = $state(infoPage ? 'signin' : 'checking');

  loadConfig().then((c) => {
    config = c;
    document.title = infoPage ? document.title.replace('Tasks', c.appName) : c.appName;
    if (infoPage) return;
    if (c.preview) {
      // No server behind this page: open the task app straight away, saving in this browser.
      user = { id: 'preview', username: 'preview', name: 'You', email: null, hasPassword: false, provider: null };
      phase = 'app';
      return;
    }
    api('GET', '/api/me')
      .then((res) => {
        user = res.user;
        phase = 'app';
      })
      .catch(() => {
        phase = 'signin';
        if (!hinted && !initialError && c.oidc.enabled && c.oidc.autoRedirect && !c.passwordAuth) {
          window.location.href = '/auth/oidc/login';
        }
      });
  });

  function signedIn(u) {
    user = u;
    phase = 'app';
  }
</script>

{#if infoPage}
  <InfoPage page={infoPage} {config} />
{:else if phase === 'app' && user}
  <TasksApp {user} {config} />
{:else if phase === 'checking'}
  <div class="checking"><span class="spinner" aria-label="Loading"></span></div>
{:else}
  <AuthLayout {config}>
    {#if phase === 'signup'}
      <SignUp {config} onsignedin={signedIn} onback={() => (phase = 'signin')} />
    {:else}
      <SignIn {config} {initialError} onsignedin={signedIn} oncreate={() => (phase = 'signup')} />
    {/if}
  </AuthLayout>
{/if}

<style>
  .checking {
    display: grid;
    place-items: center;
    height: 100vh;
  }

  .spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--border);
    border-top-color: var(--accent-purple);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
