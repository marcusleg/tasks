<script>
  import Icon from './Icon.svelte';
  import Menu from './Menu.svelte';
  import Dialog from './Dialog.svelte';
  import TaskRow from './TaskRow.svelte';
  import {
    store,
    activeTasks,
    subtasks,
    completedTasks,
    createTask,
    updateList,
    deleteList,
    clearCompleted
  } from '../lib/store.svelte.js';
  import { dateGroup } from '../lib/dates.js';
  import { drag, overList, dropOnList } from '../lib/drag.svelte.js';

  let { list, onopen } = $props();

  const sortLabels = { manual: 'My order', date: 'Date', priority: 'Priority', starred: 'Starred recently', title: 'Title' };
  const priorityGroup = (p) => ({ high: 'High priority', medium: 'Medium priority', low: 'Low priority' })[p] ?? 'No priority';

  let adding = $state(false);
  let newTitle = $state('');
  let addInput = $state(null);
  let showCompleted = $state(false);
  let menuOpen = $state(false);
  let renameOpen = $state(false);
  let renameValue = $state('');
  let deleteOpen = $state(false);

  const tasks = $derived(activeTasks(list.id, list.sortMode));
  const completed = $derived(completedTasks(list.id));
  const canDrag = $derived(list.sortMode === 'manual');
  const groups = $derived.by(() => {
    if (list.sortMode !== 'date' && list.sortMode !== 'priority') return [{ label: null, tasks }];
    const out = [];
    for (const t of tasks) {
      const label = list.sortMode === 'priority' ? priorityGroup(t.priority) : dateGroup(t.dueDate);
      if (!out.length || out.at(-1).label !== label) out.push({ label, tasks: [] });
      out.at(-1).tasks.push(t);
    }
    return out;
  });

  function startAdding() {
    adding = true;
    queueMicrotask(() => addInput?.focus());
  }

  async function submitNew(e) {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) return;
    newTitle = '';
    await createTask({ listId: list.id, title, placement: 'top' });
  }

  function onAddKey(e) {
    if (e.key === 'Escape') {
      adding = false;
      newTitle = '';
    }
  }

  function onAddBlur() {
    if (!newTitle.trim()) adding = false;
  }

  function saveRename(e) {
    e?.preventDefault();
    const title = renameValue.trim();
    if (title) updateList(list.id, { title });
    renameOpen = false;
  }
</script>

<section
  class="column"
  class:drop-target={drag.overList === list.id}
  aria-label={list.title}
  ondragover={(e) => canDrag && overList(e, list.id)}
  ondrop={(e) => canDrag && dropOnList(e, list.id)}
>
  <header>
    <h2>{list.title}</h2>
    <Menu label="List options" bind:open={menuOpen}>
      {#snippet trigger()}<Icon name="more" size={20} />{/snippet}
      <div class="menu-label">Sort by</div>
      {#each Object.entries(sortLabels) as [mode, label] (mode)}
        <button
          type="button"
          class="menu-item"
          role="menuitemradio"
          aria-checked={list.sortMode === mode}
          data-close
          onclick={() => updateList(list.id, { sortMode: mode })}
        >
          <span class="tick">{#if list.sortMode === mode}<Icon name="check" size={18} />{/if}</span>{label}
        </button>
      {/each}
      <div class="menu-sep"></div>
      <button
        type="button"
        class="menu-item"
        data-close
        onclick={() => {
          renameValue = list.title;
          renameOpen = true;
        }}><span class="tick"></span>Rename list</button
      >
      <button
        type="button"
        class="menu-item"
        data-close
        disabled={store.lists.length <= 1}
        title={store.lists.length <= 1 ? 'You need at least one list' : undefined}
        onclick={() => (deleteOpen = true)}><span class="tick"></span>Delete list</button
      >
      <div class="menu-sep"></div>
      <button type="button" class="menu-item" data-close disabled={!completed.length} onclick={() => clearCompleted(list.id)}
        ><span class="tick"></span>Delete all completed tasks</button
      >
    </Menu>
  </header>

  <div class="add">
    {#if adding}
      <form class="add-form" onsubmit={submitNew}>
        <span class="add-circle" aria-hidden="true"></span>
        <label class="visually-hidden" for={`add-${list.id}`}>New task title</label>
        <input
          id={`add-${list.id}`}
          bind:this={addInput}
          bind:value={newTitle}
          placeholder="Title"
          autocomplete="off"
          onkeydown={onAddKey}
          onblur={onAddBlur}
        />
      </form>
    {:else}
      <button type="button" class="add-button" onclick={startAdding}>
        <Icon name="plus" size={20} /><span>Add a task</span>
      </button>
    {/if}
  </div>

  <div class="tasks" role="list">
    {#each groups as group (group.label)}
      {#if group.label}<h3 class="group" class:past={group.label === 'Past' || group.label === 'High priority'}>{group.label}</h3>{/if}
      {#each group.tasks as task (task.id)}
        <TaskRow {task} siblings={group.tasks} {canDrag} {onopen} />
        {#each subtasks(task.id) as sub (sub.id)}
          <TaskRow task={sub} siblings={subtasks(task.id)} {canDrag} {onopen} />
        {/each}
      {/each}
    {/each}

    {#if !tasks.length && !adding}
      <div class="empty">
        <svg width="96" height="72" viewBox="0 0 96 72" aria-hidden="true">
          <rect x="8" y="10" width="80" height="54" rx="8" fill="none" stroke="var(--border)" stroke-width="2" />
          <circle cx="26" cy="28" r="6" fill="none" stroke="var(--accent-purple)" stroke-width="2" />
          <path d="M38 28h36M38 46h26" stroke="var(--border)" stroke-width="2" stroke-linecap="round" />
          <circle cx="26" cy="46" r="6" fill="var(--accent-purple)" />
          <path d="M23 46l2 2 4-4" stroke="var(--on-accent)" stroke-width="1.6" fill="none" stroke-linecap="round" />
        </svg>
        {#if completed.length}
          <p class="empty-title">All tasks complete</p>
          <p>Nice work!</p>
        {:else}
          <p class="empty-title">No tasks yet</p>
          <p>Add your to-dos and keep track of them here.</p>
        {/if}
      </div>
    {/if}
  </div>

  {#if completed.length}
    <div class="completed">
      <button type="button" class="completed-toggle" aria-expanded={showCompleted} onclick={() => (showCompleted = !showCompleted)}>
        <Icon name={showCompleted ? 'chevronDown' : 'chevronRight'} size={20} />
        Completed ({completed.length})
      </button>
      {#if showCompleted}
        <div role="list">
          {#each completed as task (task.id)}
            <TaskRow {task} {onopen} />
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</section>

<Dialog bind:open={renameOpen} title="Rename list">
  <form id={`rename-${list.id}`} onsubmit={saveRename}>
    <label class="visually-hidden" for={`rename-input-${list.id}`}>List name</label>
    <!-- svelte-ignore a11y_autofocus -->
    <input id={`rename-input-${list.id}`} class="text-input" bind:value={renameValue} maxlength="200" autofocus />
  </form>
  {#snippet actions()}
    <button type="button" class="btn-text" onclick={() => (renameOpen = false)}>Cancel</button>
    <button type="submit" class="btn-primary" form={`rename-${list.id}`} disabled={!renameValue.trim()}>Done</button>
  {/snippet}
</Dialog>

<Dialog bind:open={deleteOpen} title="Delete this list?">
  <p>All tasks in “{list.title}” will be permanently deleted.</p>
  {#snippet actions()}
    <button type="button" class="btn-text" onclick={() => (deleteOpen = false)}>Cancel</button>
    <button
      type="button"
      class="btn-primary danger"
      onclick={() => {
        deleteOpen = false;
        deleteList(list.id);
      }}>Delete</button
    >
  {/snippet}
</Dialog>

<style>
  .column {
    display: flex;
    flex-direction: column;
    flex: none;
    width: var(--column-width);
    max-height: 100%;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
    overflow: hidden;
  }

  .column.drop-target {
    border-color: var(--accent-purple);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 8px 0 24px;
    min-height: 56px;
  }

  h2 {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 18px;
    line-height: 24px;
    font-weight: 700;
  }

  .add {
    padding: 0 8px;
  }

  .add-button {
    display: flex;
    align-items: center;
    gap: 16px;
    width: 100%;
    height: 40px;
    padding: 0 16px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--accent-purple);
    font-size: var(--text-sm);
    font-weight: 500;
    letter-spacing: 0.25px;
  }

  .add-button:hover {
    background: var(--accent-soft);
  }

  .add-form {
    display: flex;
    align-items: center;
    gap: 14px;
    height: 40px;
    padding: 0 8px 0 18px;
  }

  .add-circle {
    flex: none;
    width: 20px;
    height: 20px;
    border: 2px solid var(--muted);
    border-radius: 50%;
  }

  .add-form input {
    flex: 1;
    min-width: 0;
    height: 32px;
    padding: 0 4px;
    border: 0;
    border-bottom: 2px solid var(--accent-purple);
    background: transparent;
    outline: none;
  }

  .tasks {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 4px 8px 8px;
  }

  .group {
    padding: 16px 16px 4px;
    color: var(--accent-purple);
    font-size: var(--text-xs);
    line-height: 16px;
    font-weight: 700;
    letter-spacing: 0.4px;
    text-transform: uppercase;
  }

  .group.past {
    color: var(--accent-pink);
  }

  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 32px 24px 40px;
    color: var(--muted);
    text-align: center;
  }

  .empty svg {
    margin-bottom: 12px;
  }

  .empty-title {
    color: var(--fg);
    font-size: var(--text-md);
    line-height: 24px;
  }

  .completed {
    border-top: 1px solid var(--border);
    padding: 4px 8px 8px;
    max-height: 45%;
    overflow-y: auto;
  }

  .completed-toggle {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    height: 40px;
    padding: 0 16px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--muted);
    font-weight: 700;
  }

  .completed-toggle:hover {
    background: var(--surface-hover);
  }

  :global(.btn-primary.danger) {
    background: var(--accent-pink);
  }

  @media (max-width: 699px) {
    .column {
      width: 100%;
      max-height: none;
    }

    .tasks,
    .completed {
      overflow: visible;
      max-height: none;
    }
  }
</style>
