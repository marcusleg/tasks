<script>
  /** Manage Calendar Links: secret URLs that publish your dated, open tasks to a calendar app. */
  import Icon from './Icon.svelte';
  import Dialog from './Dialog.svelte';
  import { api } from '../lib/api.js';
  import { sortedLists, toast } from '../lib/store.svelte.js';

  let { preview = false } = $props();

  let links = $state([]);
  let loaded = $state(false);
  let loadError = $state('');
  let copiedId = $state(null);

  let editOpen = $state(false);
  let editing = $state(null); // null = new link
  let form = $state({ name: '', allLists: true, listIds: [], error: '', busy: false });
  let deleteOpen = $state(false);
  let deleting = $state(null);

  const lists = $derived(sortedLists());

  async function refresh() {
    if (preview) {
      loaded = true;
      return;
    }
    try {
      links = (await api('GET', '/api/calendar-links')).links;
      loadError = '';
    } catch (err) {
      loadError = err.message;
    } finally {
      loaded = true;
    }
  }
  refresh();

  function openNew() {
    editing = null;
    form = { name: '', allLists: true, listIds: [], error: '', busy: false };
    editOpen = true;
  }

  function openEdit(link) {
    editing = link;
    form = { name: link.name, allLists: link.allLists, listIds: link.allLists ? lists.map((l) => l.id) : [...link.listIds], error: '', busy: false };
    editOpen = true;
  }

  function toggleList(id) {
    form.listIds = form.listIds.includes(id) ? form.listIds.filter((x) => x !== id) : [...form.listIds, id];
  }

  async function save(e) {
    e.preventDefault();
    if (!form.name.trim()) return (form.error = 'Enter a name.');
    if (!form.allLists && !form.listIds.length) return (form.error = 'Choose at least one list.');
    form.busy = true;
    form.error = '';
    const payload = { name: form.name.trim(), allLists: form.allLists, ...(form.allLists ? {} : { listIds: form.listIds }) };
    try {
      if (editing) {
        const { link } = await api('PATCH', `/api/calendar-links/${editing.id}`, payload);
        links = links.map((l) => (l.id === link.id ? link : l));
      } else {
        const { link } = await api('POST', '/api/calendar-links', payload);
        links = [...links, link];
      }
      editOpen = false;
    } catch (err) {
      form.error = err.message;
    } finally {
      form.busy = false;
    }
  }

  async function remove() {
    const link = deleting;
    deleteOpen = false;
    try {
      await api('DELETE', `/api/calendar-links/${link.id}`);
      links = links.filter((l) => l.id !== link.id);
      toast(`“${link.name}” deleted. Calendars using it stop updating.`);
    } catch (err) {
      toast(err.message);
    }
  }

  async function copy(link, input) {
    try {
      await navigator.clipboard.writeText(link.url);
      copiedId = link.id;
      setTimeout(() => (copiedId = copiedId === link.id ? null : copiedId), 2000);
    } catch {
      input?.select();
      toast('Press Ctrl+C (or ⌘C) to copy the address');
    }
  }

  function coverage(link) {
    if (link.allLists) return 'All lists (including ones created later)';
    const names = link.listIds.map((id) => lists.find((l) => l.id === id)?.title).filter(Boolean);
    return names.length ? names.join(', ') : 'No lists';
  }

  function lastAccessed(iso) {
    if (!iso) return 'never';
    const seconds = Math.round((new Date(iso).getTime() - Date.now()) / 1000);
    const fmt = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
    for (const [unit, size] of [['day', 86400], ['hour', 3600], ['minute', 60]]) {
      if (Math.abs(seconds) >= size) return fmt.format(Math.round(seconds / size), unit);
    }
    return 'just now';
  }
</script>

<div class="page">
  <section class="card" aria-labelledby="cal-title">
    <div class="head">
      <h2 id="cal-title">Calendar links</h2>
      <button type="button" class="btn-primary" onclick={openNew} disabled={preview}><Icon name="plus" size={18} />New calendar link</button>
    </div>
    <p class="lead">
      A calendar link is a secret address that shows your open tasks with a date as a read-only calendar. Anyone with the address can see those
      tasks, so delete the link to stop sharing.
    </p>

    {#if preview}
      <p class="notice">Calendar links need the app running on your own server, so calendar apps have an address to fetch. They’re turned off in this preview.</p>
    {:else if !loaded}
      <span class="spinner" aria-label="Loading"></span>
    {:else if loadError}
      <p class="notice">{loadError} <button type="button" class="btn-text" onclick={refresh}>Try again</button></p>
    {:else if !links.length}
      <p class="empty">No calendar links yet.</p>
    {:else}
      <ul class="links">
        {#each links as link (link.id)}
          {@const inputId = `cal-url-${link.id}`}
          <li class="link">
            <div class="link-head">
              <h3><Icon name="calendar" size={18} />{link.name}</h3>
              <div class="link-actions">
                <button type="button" class="btn-text" onclick={() => openEdit(link)}>Edit</button>
                <button
                  type="button"
                  class="btn-text danger"
                  onclick={() => {
                    deleting = link;
                    deleteOpen = true;
                  }}>Delete</button
                >
              </div>
            </div>
            <dl>
              <dt>Lists</dt>
              <dd>{coverage(link)}</dd>
              <dt>Last fetched</dt>
              <dd>{lastAccessed(link.lastAccessedAt)}</dd>
            </dl>
            <div class="url-row">
              <label class="visually-hidden" for={inputId}>Address of {link.name}</label>
              <input id={inputId} class="text-input url" readonly value={link.url} onfocus={(e) => e.currentTarget.select()} />
              <button type="button" class="btn-primary" onclick={(e) => copy(link, e.currentTarget.previousElementSibling)}>
                {copiedId === link.id ? 'Copied' : 'Copy'}
              </button>
            </div>
          </li>
        {/each}
      </ul>
    {/if}

    <details class="help">
      <summary>How to add a calendar link to your calendar app</summary>
      <ol>
        <li>Copy the address of a calendar link above.</li>
        <li>In your calendar app, look for an option to subscribe to a calendar or add one from a URL (“From URL”, “Subscribe”, “Add by URL”).</li>
        <li>Paste the address, give the calendar a name and save.</li>
      </ol>
      <p>Calendar apps refresh subscribed calendars on their own schedule, often only every few hours, so changes may not show up right away. Repeating tasks appear as repeating events.</p>
    </details>
  </section>
</div>

<Dialog bind:open={editOpen} title={editing ? 'Edit calendar link' : 'New calendar link'} wide>
  <form id="cal-form" class="form-stack" onsubmit={save}>
    <label>
      Name
      <!-- svelte-ignore a11y_autofocus -->
      <input class="text-input" bind:value={form.name} maxlength="100" placeholder="e.g. Phone calendar" autofocus />
    </label>
    <fieldset class="cover">
      <legend>Lists</legend>
      <label class="radio"><input type="radio" name="cover" value={true} bind:group={form.allLists} /> All lists (including ones created later)</label>
      <label class="radio"><input type="radio" name="cover" value={false} bind:group={form.allLists} /> Only these lists:</label>
      <div class="choices" class:disabled={form.allLists}>
        {#each lists as l (l.id)}
          <label class="check">
            <input type="checkbox" checked={form.listIds.includes(l.id)} disabled={form.allLists} onchange={() => toggleList(l.id)} />
            {l.title}
          </label>
        {/each}
      </div>
    </fieldset>
    {#if form.error}<p class="form-error" role="alert">{form.error}</p>{/if}
  </form>
  {#snippet actions()}
    <button type="button" class="btn-text" onclick={() => (editOpen = false)}>Cancel</button>
    <button type="submit" form="cal-form" class="btn-primary" disabled={form.busy}>{editing ? 'Save' : 'Create'}</button>
  {/snippet}
</Dialog>

<Dialog bind:open={deleteOpen} title="Delete calendar link?">
  <p>Delete “{deleting?.name}”? Calendar apps subscribed to its address stop receiving updates immediately.</p>
  {#snippet actions()}
    <button type="button" class="btn-text" onclick={() => (deleteOpen = false)}>Cancel</button>
    <button type="button" class="btn-primary danger" onclick={remove}>Delete</button>
  {/snippet}
</Dialog>

<style>
  .page {
    padding: 24px;
  }

  .card {
    max-width: 720px;
    padding: 24px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    flex-wrap: wrap;
  }

  h2 {
    font-size: 22px;
    line-height: 28px;
    font-weight: 400;
  }

  .head .btn-primary {
    gap: 8px;
    padding: 0 16px 0 12px;
  }

  .lead {
    margin-top: 12px;
    color: var(--muted);
  }

  .notice {
    margin-top: 16px;
    padding: 12px 16px;
    border-left: 3px solid var(--accent-purple);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--muted);
  }

  .empty {
    margin-top: 24px;
    color: var(--muted);
  }

  .links {
    display: flex;
    flex-direction: column;
    gap: 12px;
    margin-top: 20px;
  }

  .link {
    padding: 16px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--bg);
  }

  .link-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  h3 {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    font-size: var(--text-md);
    line-height: 24px;
  }

  h3 :global(svg) {
    color: var(--accent-purple);
    flex: none;
  }

  .link-actions {
    display: flex;
    flex: none;
  }

  .danger {
    color: var(--accent-pink);
  }

  dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 4px 16px;
    margin: 8px 0 12px;
    font-size: var(--text-xs);
  }

  dt {
    color: var(--muted);
  }

  dd {
    margin: 0;
  }

  .url-row {
    display: flex;
    gap: 8px;
  }

  .url {
    flex: 1;
    min-width: 0;
    font-family: ui-monospace, monospace;
    font-size: var(--text-xs);
  }

  .help {
    margin-top: 24px;
    color: var(--muted);
  }

  .help summary {
    color: var(--accent-purple);
    cursor: pointer;
  }

  .help ol {
    margin: 12px 0;
    padding-left: 20px;
  }

  .help li + li {
    margin-top: 4px;
  }

  .spinner {
    display: block;
    width: 28px;
    height: 28px;
    margin: 24px auto;
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

  .cover {
    margin: 0;
    padding: 0;
    border: 0;
    color: var(--fg);
  }

  .cover legend {
    margin-bottom: 8px;
    padding: 0;
    color: var(--muted);
    font-size: var(--text-xs);
  }

  .radio,
  .check {
    display: flex !important;
    flex-direction: row !important;
    align-items: center;
    gap: 12px !important;
    min-height: 36px;
    color: var(--fg) !important;
    font-size: var(--text-sm) !important;
    cursor: pointer;
  }

  .radio input,
  .check input {
    width: 18px;
    height: 18px;
    margin: 0;
    accent-color: var(--accent-purple);
  }

  .choices {
    padding-left: 30px;
  }

  .choices.disabled {
    opacity: 0.5;
  }

  @media (max-width: 599px) {
    .page {
      padding: 16px;
    }

    .card {
      padding: 16px;
    }
  }
</style>
