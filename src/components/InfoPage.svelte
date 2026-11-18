<script>
  /** Help, privacy and terms pages, laid out like the sign-in card. */
  import AuthLayout from './AuthLayout.svelte';
  import Logo from './Logo.svelte';
  let { page, config } = $props();
</script>

<AuthLayout {config}>
  <Logo name={config.appName} />
  {#if page === 'help'}
    <h1>Help</h1>
    <div class="prose">
      <h2>Signing in</h2>
      <p>Sign in with the email or username you chose when you created your account, then enter your password. If this server is connected to a company or family sign-in service, use the “Sign in with …” button instead.</p>
      <h2 id="shared-devices">Shared computers</h2>
      <p>On a computer other people use, open a private (incognito) window before signing in. Everything from that window, including your sign-in, is forgotten when you close it. You can also choose <em>Sign out</em> from your picture in the top-right corner.</p>
      <h2>Forgot your password?</h2>
      <p>Passwords are stored only on this server. Ask the person who runs it to set a temporary password for you, then change it from your account menu.</p>
      <h2>Using your lists</h2>
      <p>Use <em>Add a task</em> at the top of a list, click a task to add details, a date or subtasks, and tick the circle when it’s done. Drag tasks to reorder them or move them to another list. Star tasks to find them under <em>Starred</em>.</p>
      <h2>Priorities</h2>
      <p>Give a task a High, Medium or Low priority in its details. The bars next to it show the level, <em>Sort by → Priority</em> groups a list by it, and <em>Priority</em> in the menu shows every prioritised task from all lists.</p>
      <h2>Calendar links</h2>
      <p>Under <em>Calendar links</em>, create a secret address and add it to your calendar app (“Subscribe” or “Add from URL”). Your open tasks that have a date then show up in that calendar, from all lists or only the ones you pick. Delete the link to stop sharing.</p>
      <h2>Repeating tasks</h2>
      <p>Open a task and choose <em>Repeat</em> to make it come back every few days, on chosen weekdays, monthly or yearly, and pick when the series ends. When you complete it, the next one appears with its new date (and fresh copies of its subtasks).</p>
    </div>
  {:else if page === 'privacy'}
    <h1>Privacy</h1>
    <div class="prose">
      <p>This is a self-hosted app. Your lists and tasks are stored only in the database on the server run by whoever set it up — not by a third party.</p>
      <p>The app keeps your account name, email or username, a scrambled (hashed) copy of your password and a sign-in cookie so you stay signed in. It doesn’t use tracking, analytics or advertising cookies. Your colour theme choice is saved in your browser only.</p>
      <p>To have your account and data removed, contact the person who runs this server.</p>
    </div>
  {:else}
    <h1>Terms</h1>
    <div class="prose">
      <p>This app is provided by the person or organisation that runs this server. They decide who may use it and are responsible for keeping it running and backed up.</p>
      <p>Use it for your own to-dos, keep your password private, and don’t use it to store anything you aren’t allowed to share with the server’s operator.</p>
    </div>
  {/if}
  <p class="back"><a href="/">Back to sign in</a></p>
</AuthLayout>

<style>
  h1 {
    padding-top: 16px;
    font-size: var(--text-lg);
    line-height: 32px;
    font-weight: 400;
    text-align: center;
  }

  :global(.auth-card) > :global(.logo) {
    display: flex;
    width: max-content;
    margin: 0 auto;
  }

  .prose {
    padding-top: 24px;
    color: var(--muted);
  }

  .prose h2 {
    margin: 20px 0 6px;
    color: var(--fg);
    font-size: var(--text-md);
    line-height: 24px;
    font-weight: 400;
  }

  .prose p + p {
    margin-top: 12px;
  }

  .back {
    padding: 32px 0 36px;
    font-weight: 500;
  }
</style>
