<script>
  import Icon from './Icon.svelte';
  import Logo from './Logo.svelte';
  import Menu from './Menu.svelte';
  import Dialog from './Dialog.svelte';
  import ListColumn from './ListColumn.svelte';
  import TaskRow from './TaskRow.svelte';
  import TaskDetail from './TaskDetail.svelte';
  import Toasts from './Toasts.svelte';
  import AuthFooter from './AuthFooter.svelte';
  import PriorityMarker from './PriorityMarker.svelte';
  import PriorityView from './PriorityView.svelte';
  import CalendarLinks from './CalendarLinks.svelte';
  import { PRIORITY_CHOICES } from '../lib/priority.js';
  import {
    store,
    load,
    sortedLists,
    updateList,
    createList,
    createTask,
    starredTasks,
    openCount
  } from '../lib/store.svelte.js';
  import { theme, setTheme } from '../lib/theme.svelte.js';
  import { api } from '../lib/api.js';

  let { user, config } = $props();

  const wide = () => window.matchMedia('(min-width: 900px)').matches;

  let view = $state(['starred', 'priority', 'calendar'].includes(localStorage.getItem('view')) ? localStorage.getItem('view') : 'all');
  let sidebarOpen = $state(wide() && localStorage.getItem('sidebar') !== 'closed');
  let listsExpanded = $state(true);
  let openTaskId = $state(null);
  let userMenuOpen = $state(false);

  let newListOpen = $state(false);
  let newListTitle = $state('');
  let createOpen = $state(false);
  let draft = $state({ title: '', notes: '', dueDate: '', listId: '' });
  let passwordOpen = $state(false);
  let pw = $state({ current: '', next: '', confirm: '', error: '', busy: false, done: false });

  load();

  // Narrow screens use the menu as a drawer: close it when the window shrinks, restore it when it grows.
  $effect(() => {
    const mq = window.matchMedia('(min-width: 900px)');
    const onChange = () => {
      sidebarOpen = mq.matches && localStorage.getItem('sidebar') !== 'closed';
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  });

  const lists = $derived(sortedLists());
  const visibleLists = $derived(lists.filter((l) => l.visible));
  const starred = $derived(starredTasks());
  const prioritized = $derived(store.tasks.filter((t) => t.priority && !t.completedAt).length);
  const initial = $derived((user.name || user.username || '?').trim().charAt(0).toUpperCase());

  function setView(v) {
    view = v;
    localStorage.setItem('view', v);
    if (!wide()) sidebarOpen = false;
  }

  function toggleSidebar() {
    sidebarOpen = !sidebarOpen;
    if (wide()) localStorage.setItem('sidebar', sidebarOpen ? 'open' : 'closed');
  }

  async function submitNewList(e) {
    e.preventDefault();
    const title = newListTitle.trim();
    if (!title) return;
    newListOpen = false;
    newListTitle = '';
    await createList(title);
    setView('all');
  }

  function openCreate() {
    draft = { title: '', notes: '', dueDate: '', priority: null, listId: visibleLists[0]?.id ?? lists[0]?.id ?? '' };
    createOpen = true;
    if (!wide()) sidebarOpen = false;
  }

  async function submitCreate(e) {
    e.preventDefault();
    if (!draft.title.trim() || !draft.listId) return;
    createOpen = false;
    const list = lists.find((l) => l.id === draft.listId);
    if (list && !list.visible) updateList(list.id, { visible: true });
    await createTask({
      listId: draft.listId,
      title: draft.title.trim(),
      notes: draft.notes,
      dueDate: draft.dueDate || null,
      priority: draft.priority,
      placement: 'top'
    });
  }

  async function changePassword(e) {
    e.preventDefault();
    pw.error = '';
    if (pw.next.length < 8) return (pw.error = 'Use 8 characters or more for your password.');
    if (pw.next !== pw.confirm) return (pw.error = 'Those passwords didn’t match.');
    pw.busy = true;
    try {
      await api('POST', '/api/auth/password', { current: pw.current, password: pw.next });
      pw.done = true;
      user.hasPassword = true;
    } catch (err) {
      pw.error = err.message;
    } finally {
      pw.busy = false;
    }
  }

  let noticeOpen = $state(config.preview && localStorage.getItem('preview-notice') !== 'hidden');

  async function startOver() {
    const { resetPreview } = await import('../lib/local-backend.js');
    resetPreview();
    openTaskId = null;
    await load();
  }

  function hideNotice() {
    noticeOpen = false;
    localStorage.setItem('preview-notice', 'hidden');
  }

  async function signOut() {
    try {
      const res = await api('POST', '/api/auth/logout');
      window.location.href = res.redirect || '/';
    } catch {
      window.location.href = '/';
    }
  }
</script>

<div class="shell" class:with-sidebar={sidebarOpen}>
  <header class="topbar">
    <button type="button" class="icon-btn" aria-label="Main menu" title="Main menu" aria-expanded={sidebarOpen} onclick={toggleSidebar}>
      <Icon name="menu" />
    </button>
    <h1 class="brand-heading"><a class="brand" href="/" aria-label={config.appName}><Logo name={config.appName} size="header" /></a></h1>
    <div class="grow"></div>
    <Menu label="Account" bind:open={userMenuOpen}>
      {#snippet trigger()}<span class="avatar">{initial}</span>{/snippet}
      <div class="account">
        <span class="avatar big">{initial}</span>
        <div class="who">
          <strong>{user.name || user.username}</strong>
          {#if config.preview}<span>Preview · saved in this browser</span>
          {:else if user.name}<span>{user.email || user.username}</span>{/if}
          {#if user.provider}<span class="via">Signed in with {user.provider}</span>{/if}
        </div>
      </div>
      <div class="menu-sep"></div>
      <div class="menu-label">Theme</div>
      {#each [['system', 'Same as device', 'monitor'], ['light', 'Light', 'sun'], ['dark', 'Dark', 'moon']] as [value, label, icon] (value)}
        <button type="button" class="menu-item" role="menuitemradio" aria-checked={theme.preference === value} onclick={() => setTheme(value)}>
          <span class="tick">{#if theme.preference === value}<Icon name="check" size={18} />{/if}</span>
          <Icon name={icon} size={18} />{label}
        </button>
      {/each}
      <div class="menu-sep"></div>
      {#if config.preview}
        <button type="button" class="menu-item" data-close onclick={startOver}><span class="tick"></span><Icon name="list" size={18} />Start over with sample tasks</button>
      {:else}
      {#if config.passwordAuth}
        <button
          type="button"
          class="menu-item"
          data-close
          onclick={() => {
            pw = { current: '', next: '', confirm: '', error: '', busy: false, done: false };
            passwordOpen = true;
          }}><span class="tick"></span><Icon name="lock" size={18} />{user.hasPassword ? 'Change password' : 'Set a password'}</button
        >
      {/if}
      <button type="button" class="menu-item" data-close onclick={signOut}><span class="tick"></span><Icon name="logout" size={18} />Sign out</button>
      {/if}
    </Menu>
  </header>

  {#if sidebarOpen}
    <button type="button" class="scrim" aria-label="Close menu" onclick={() => (sidebarOpen = false)}></button>
  {/if}

  <nav class="sidebar" class:open={sidebarOpen} aria-label="Lists">
    <button type="button" class="create" onclick={openCreate}>
      <span class="create-icon"><Icon name="plus" /></span>Create
    </button>

    <button type="button" class="nav-item" class:active={view === 'all'} onclick={() => setView('all')}>
      <Icon name="allTasks" size={20} /><span>All tasks</span>
    </button>
    <button type="button" class="nav-item" class:active={view === 'starred'} onclick={() => setView('starred')}>
      <Icon name="star" size={20} /><span>Starred</span>
      {#if starred.length}<span class="count">{starred.length}</span>{/if}
    </button>
    <button type="button" class="nav-item" class:active={view === 'priority'} onclick={() => setView('priority')}>
      <span class="nav-marker"><PriorityMarker priority="high" size={18} /></span><span>Priority</span>
      {#if prioritized}<span class="count">{prioritized}</span>{/if}
    </button>
    <button type="button" class="nav-item" class:active={view === 'calendar'} onclick={() => setView('calendar')}>
      <Icon name="calendar" size={20} /><span>Calendar links</span>
    </button>

    <div class="lists-head">
      <button type="button" class="lists-toggle" aria-expanded={listsExpanded} onclick={() => (listsExpanded = !listsExpanded)}>
        <span>Lists</span><Icon name={listsExpanded ? 'chevronDown' : 'chevronRight'} size={20} />
      </button>
    </div>
    {#if listsExpanded}
      <ul class="lists">
        {#each lists as list (list.id)}
          <li>
            <label class="list-item">
              <input
                type="checkbox"
                checked={list.visible}
                onchange={(e) => {
                  updateList(list.id, { visible: e.currentTarget.checked });
                  if (view !== 'all') setView('all');
                }}
              />
              <span class="list-name">{list.title}</span>
              <span class="count">{openCount(list.id) || ''}</span>
            </label>
          </li>
        {/each}
      </ul>
    {/if}
    <button type="button" class="nav-item new-list" onclick={() => (newListOpen = true)}>
      <Icon name="plus" size={20} /><span>Create new list</span>
    </button>
  </nav>

  <main class="board" class:has-detail={!!openTaskId}>
    {#if noticeOpen}
      <div class="notice" role="status">
        <p>This is a preview: your tasks are saved in this browser only. Run it on your own server to sign in and see them on every device.</p>
        <button type="button" class="btn-text" onclick={hideNotice}>Got it</button>
      </div>
    {/if}
    {#if !store.loaded}
      <div class="status">
        {#if store.loadError}
          <p>{store.loadError}</p>
          <button type="button" class="btn-text" onclick={load}>Try again</button>
        {:else}
          <span class="spinner" aria-label="Loading"></span>
        {/if}
      </div>
    {:else if view === 'priority'}
      <PriorityView onopen={(id) => (openTaskId = id)} />
    {:else if view === 'calendar'}
      <CalendarLinks preview={!!config.preview} />
    {:else if view === 'starred'}
      <div class="columns">
        <section class="column-like" aria-label="Starred tasks">
          <h2>Starred tasks</h2>
          {#if starred.length}
            <div role="list">
              {#each starred as task (task.id)}
                <TaskRow {task} showList flat onopen={(id) => (openTaskId = id)} />
              {/each}
            </div>
          {:else}
            <div class="empty-star">
              <Icon name="star" size={48} />
              <p class="big">No starred tasks</p>
              <p>Mark important tasks with a star so you can easily find them here.</p>
            </div>
          {/if}
        </section>
      </div>
    {:else if visibleLists.length}
      <div class="columns">
        {#each visibleLists as list (list.id)}
          <ListColumn {list} onopen={(id) => (openTaskId = id)} />
        {/each}
      </div>
    {:else}
      <div class="status">
        <p>All lists are hidden. Tick a list in the menu to show it.</p>
        <button type="button" class="btn-text" onclick={() => (sidebarOpen = true)}>Show lists</button>
      </div>
    {/if}
  </main>

  <AuthFooter {config} />

  {#if openTaskId}
    <div class="detail-slot">
      <TaskDetail taskId={openTaskId} onclose={() => (openTaskId = null)} onopen={(id) => (openTaskId = id)} />
    </div>
  {/if}
</div>

<Toasts />

<Dialog bind:open={newListOpen} title="Create new list">
  <form id="new-list-form" onsubmit={submitNewList}>
    <label class="visually-hidden" for="new-list-input">List name</label>
    <!-- svelte-ignore a11y_autofocus -->
    <input id="new-list-input" class="text-input" placeholder="Enter name" bind:value={newListTitle} maxlength="200" autofocus />
  </form>
  {#snippet actions()}
    <button type="button" class="btn-text" onclick={() => (newListOpen = false)}>Cancel</button>
    <button type="submit" form="new-list-form" class="btn-primary" disabled={!newListTitle.trim()}>Done</button>
  {/snippet}
</Dialog>

<Dialog bind:open={createOpen} title="New task" wide>
  <form id="create-form" class="form-stack" onsubmit={submitCreate}>
    <label>
      Title
      <!-- svelte-ignore a11y_autofocus -->
      <input class="text-input" bind:value={draft.title} placeholder="What needs doing?" autofocus />
    </label>
    <label>
      Details
      <textarea class="text-input area" bind:value={draft.notes} rows="3" placeholder="Add details"></textarea>
    </label>
    <div class="two">
      <label>
        Date
        <input class="text-input" type="date" bind:value={draft.dueDate} />
      </label>
      <label>
        List
        <select class="text-input" bind:value={draft.listId}>
          {#each lists as l (l.id)}<option value={l.id}>{l.title}</option>{/each}
        </select>
      </label>
    </div>
    <label>
      Priority
      <select class="text-input" bind:value={draft.priority}>
        {#each [...PRIORITY_CHOICES].reverse() as c (c.label)}<option value={c.value}>{c.label}</option>{/each}
      </select>
    </label>
  </form>
  {#snippet actions()}
    <button type="button" class="btn-text" onclick={() => (createOpen = false)}>Cancel</button>
    <button type="submit" form="create-form" class="btn-primary" disabled={!draft.title.trim()}>Save</button>
  {/snippet}
</Dialog>

<Dialog bind:open={passwordOpen} title={user.hasPassword ? 'Change password' : 'Set a password'}>
  {#if pw.done}
    <p>Your password has been saved. Other devices stay signed in.</p>
  {:else}
    <form id="pw-form" class="form-stack" onsubmit={changePassword}>
      <input class="visually-hidden" tabindex="-1" aria-hidden="true" autocomplete="username" value={user.username} readonly />
      {#if user.hasPassword}
        <label>Current password<input class="text-input" type="password" autocomplete="current-password" bind:value={pw.current} /></label>
      {/if}
      <label>New password<input class="text-input" type="password" autocomplete="new-password" bind:value={pw.next} /></label>
      <label>Confirm new password<input class="text-input" type="password" autocomplete="new-password" bind:value={pw.confirm} /></label>
      {#if pw.error}<p class="form-error" role="alert">{pw.error}</p>{/if}
    </form>
  {/if}
  {#snippet actions()}
    {#if pw.done}
      <button type="button" class="btn-primary" onclick={() => (passwordOpen = false)}>Done</button>
    {:else}
      <button type="button" class="btn-text" onclick={() => (passwordOpen = false)}>Cancel</button>
      <button type="submit" form="pw-form" class="btn-primary" disabled={pw.busy}>Save</button>
    {/if}
  {/snippet}
</Dialog>

<style>
  .shell {
    display: grid;
    grid-template-columns: 0 1fr auto;
    grid-template-rows: var(--header-height) 1fr auto;
    height: 100vh;
    height: 100dvh;
    overflow: hidden;
  }

  .shell.with-sidebar {
    grid-template-columns: var(--sidebar-width) 1fr auto;
  }

  .topbar {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 16px 0 12px;
    border-bottom: 1px solid var(--border);
  }

  .brand {
    display: flex;
    align-items: center;
    padding: 4px;
    color: var(--fg);
  }

  .brand:hover {
    text-decoration: none;
  }

  .grow {
    flex: 1;
  }

  .avatar {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--accent-purple);
    color: var(--on-accent);
    font-size: var(--text-md);
    font-weight: 700;
  }

  .avatar.big {
    width: 48px;
    height: 48px;
    flex: none;
    font-size: 22px;
  }

  .account {
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 8px 16px;
    min-width: 260px;
  }

  .who {
    display: flex;
    flex-direction: column;
    min-width: 0;
    color: var(--muted);
    font-size: var(--text-xs);
  }

  .who strong {
    color: var(--fg);
    font-size: var(--text-sm);
  }

  .who span {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .via {
    color: var(--accent-cyan);
  }

  .sidebar {
    grid-row: 2;
    grid-column: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: var(--sidebar-width);
    padding: 16px 12px 24px 0;
    overflow-y: auto;
    visibility: hidden;
  }

  .sidebar.open {
    visibility: visible;
  }

  .scrim {
    display: none;
  }

  .create {
    display: flex;
    align-items: center;
    gap: 12px;
    align-self: flex-start;
    height: 48px;
    margin: 0 0 16px 16px;
    padding: 0 24px 0 12px;
    border: 1px solid var(--border);
    border-radius: 16px;
    background: var(--bg);
    color: var(--fg);
    font-size: var(--text-sm);
    font-weight: 700;
    box-shadow: var(--shadow);
  }

  .create:hover {
    background: var(--surface-hover);
  }

  .create-icon {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--brand-rule);
    color: #fff;
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: 16px;
    height: 40px;
    padding: 0 16px 0 24px;
    border: 0;
    border-radius: 0 20px 20px 0;
    background: transparent;
    color: var(--fg);
    font-size: var(--text-sm);
    text-align: left;
  }

  .nav-item > span:not(.count):not(.nav-marker) {
    flex: 1;
  }

  .nav-item:hover {
    background: var(--surface-hover);
  }

  .nav-item.active {
    background: var(--accent-soft);
    color: var(--accent-purple);
    font-weight: 700;
  }

  .nav-marker {
    display: grid;
    place-items: center;
    width: 20px;
  }

  .count {
    color: var(--muted);
    font-size: var(--text-xs);
    font-weight: 400;
  }

  .lists-head {
    margin-top: 12px;
  }

  .lists-toggle {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    height: 40px;
    padding: 0 16px 0 24px;
    border: 0;
    border-radius: 0 20px 20px 0;
    background: transparent;
    color: var(--muted);
    font-size: var(--text-xs);
    font-weight: 700;
    letter-spacing: 0.6px;
    text-transform: uppercase;
  }

  .lists-toggle:hover {
    background: var(--surface-hover);
  }

  .list-item {
    display: flex;
    align-items: center;
    gap: 16px;
    height: 40px;
    padding: 0 16px 0 24px;
    border-radius: 0 20px 20px 0;
    cursor: pointer;
  }

  .list-item:hover {
    background: var(--surface-hover);
  }

  .list-item input {
    flex: none;
    width: 18px;
    height: 18px;
    margin: 0;
    accent-color: var(--accent-purple);
  }

  .list-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .new-list {
    color: var(--accent-purple);
  }

  .board {
    grid-row: 2;
    grid-column: 2;
    min-width: 0;
    overflow: auto;
  }

  .notice {
    display: flex;
    align-items: center;
    gap: 16px;
    margin: 16px 24px 0;
    padding: 6px 8px 6px 16px;
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent-purple);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--muted);
  }

  .notice p {
    flex: 1;
  }

  .notice button {
    flex: none;
  }

  .columns {
    display: flex;
    align-items: flex-start;
    gap: 16px;
    height: 100%;
    padding: 24px;
  }

  .column-like {
    width: min(600px, 100%);
    max-height: 100%;
    overflow-y: auto;
    padding: 16px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  .column-like h2 {
    padding: 0 16px 12px;
    font-size: 18px;
    line-height: 24px;
  }

  .empty-star {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 32px 24px;
    color: var(--muted);
    text-align: center;
  }

  .empty-star :global(svg) {
    color: var(--accent-orange);
    margin-bottom: 8px;
  }

  .empty-star .big {
    color: var(--fg);
    font-size: var(--text-md);
  }

  .status {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    height: 100%;
    padding: 24px;
    color: var(--muted);
    text-align: center;
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

  .shell > :global(.auth-footer) {
    grid-row: 3;
    grid-column: 2;
    margin: 0 40px;
  }

  .brand-heading {
    margin: 0;
    font-size: 24px;
    line-height: 32px;
    font-weight: 400;
  }

  .detail-slot {
    grid-row: 2 / 4;
    grid-column: 3;
    min-height: 0;
  }

  .two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .area {
    height: auto;
    padding: 8px 12px;
    resize: vertical;
    font-size: var(--text-sm);
  }

  @media (max-width: 899px) {
    .shell,
    .shell.with-sidebar {
      grid-template-columns: 1fr;
    }

    .sidebar {
      position: fixed;
      top: var(--header-height);
      bottom: 0;
      left: 0;
      z-index: 35;
      background: var(--bg);
      border-right: 1px solid var(--border);
      transform: translateX(-100%);
      transition:
        transform 0.2s ease,
        visibility 0.2s;
    }

    .sidebar.open {
      transform: none;
    }

    .scrim {
      display: block;
      position: fixed;
      inset: var(--header-height) 0 0 0;
      z-index: 34;
      border: 0;
      background: var(--overlay);
    }

    .board,
    .shell > :global(.auth-footer) {
      grid-column: 1;
    }
  }

  @media (max-width: 599px) {
    .shell > :global(.auth-footer) {
      margin: 0;
      padding: 0 24px 14px;
    }
  }

  @media (max-width: 699px) {
    .notice {
      margin: 16px 16px 0;
    }

    .columns {
      flex-direction: column;
      align-items: stretch;
      height: auto;
      padding: 16px;
    }

    .column-like {
      width: 100%;
      max-height: none;
    }

    .two {
      grid-template-columns: 1fr;
    }
  }
</style>
