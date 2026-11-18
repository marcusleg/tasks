<script>
  /** Side panel (full screen on phones) for editing one task. Saves as you type. */
  import Icon from './Icon.svelte';
  import TaskRow from './TaskRow.svelte';
  import RepeatDialog from './RepeatDialog.svelte';
  import PriorityMarker from './PriorityMarker.svelte';
  import { PRIORITY_CHOICES } from '../lib/priority.js';
  import { describeRule } from '../../server/recurrence.js';
  import {
    store,
    taskById,
    sortedLists,
    updateTask,
    setStarred,
    setCompleted,
    deleteTask,
    subtasks,
    createTask,
    moveTask
  } from '../lib/store.svelte.js';
  import { todayKey, addDays, formatDue } from '../lib/dates.js';

  let { taskId, onclose, onopen } = $props();

  const task = $derived(taskById(taskId));
  const parent = $derived(task?.parentId ? taskById(task.parentId) : null);
  const subs = $derived(task ? subtasks(task.id, true) : []);

  let title = $state('');
  let notes = $state('');
  let loadedId = null;
  let timers = {};
  let newSub = $state('');
  let repeatOpen = $state(false);
  let titleEl = $state(null);

  $effect(() => {
    if (task && task.id !== loadedId) {
      loadedId = task.id;
      title = task.title;
      notes = task.notes;
      queueMicrotask(() => {
        if (!task.title) titleEl?.focus();
      });
    }
  });

  $effect(() => {
    if (!task && loadedId) onclose();
  });

  function save(field, value) {
    clearTimeout(timers[field]);
    timers[field] = setTimeout(() => updateTask(taskId, { [field]: value }), 400);
  }

  function autosize(el) {
    const fit = () => {
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    };
    fit();
    el.addEventListener('input', fit);
    return { destroy: () => el.removeEventListener('input', fit) };
  }

  function flush() {
    for (const k of Object.keys(timers)) clearTimeout(timers[k]);
    if (task && title !== task.title) updateTask(taskId, { title });
    if (task && notes !== task.notes) updateTask(taskId, { notes });
  }

  function close() {
    flush();
    onclose();
  }

  function setDate(value) {
    updateTask(taskId, { dueDate: value || null, ...(value ? {} : { dueTime: null }) });
  }

  async function addSub(e) {
    e.preventDefault();
    const t = newSub.trim();
    if (!t) return;
    newSub = '';
    await createTask({ listId: task.listId, parentId: task.id, title: t, placement: 'bottom' });
  }

  function changeList(listId) {
    flush();
    moveTask(task.id, { listId, parentId: null, beforeId: null });
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && !document.querySelector('dialog[open]') && close()} />

{#if task}
  <aside class="detail" aria-label="Task details">
    <header>
      <button type="button" class="icon-btn" aria-label="Close" title="Close" onclick={close}><Icon name="close" /></button>
      <div class="spacer"></div>
      <button
        type="button"
        class="icon-btn"
        class:starred={!!task.starredAt}
        aria-pressed={!!task.starredAt}
        aria-label={task.starredAt ? 'Remove star' : 'Add star'}
        title={task.starredAt ? 'Remove star' : 'Add star'}
        onclick={() => setStarred(task.id, !task.starredAt)}><Icon name="star" filled={!!task.starredAt} /></button
      >
      <button
        type="button"
        class="icon-btn"
        aria-label="Delete task"
        title="Delete task"
        onclick={() => {
          onclose();
          deleteTask(task.id);
        }}><Icon name="trash" /></button
      >
    </header>

    <div class="body">
      {#if parent}
        <button type="button" class="parent" onclick={() => { flush(); onopen(parent.id); }}>
          <Icon name="chevronLeft" size={18} />{parent.title || 'Untitled task'}
        </button>
      {/if}

      <label class="visually-hidden" for="detail-title">Title</label>
      <textarea
        id="detail-title"
        class="title"
        class:done={!!task.completedAt}
        rows="1"
        placeholder="Enter title"
        bind:this={titleEl}
        bind:value={title}
        use:autosize
        oninput={() => save('title', title)}
        onkeydown={(e) => e.key === 'Enter' && e.preventDefault()}
      ></textarea>

      <div class="field">
        <span class="field-icon"><Icon name="notes" size={20} /></span>
        <label class="visually-hidden" for="detail-notes">Details</label>
        <textarea
          id="detail-notes"
          rows="2"
          placeholder="Add details"
          bind:value={notes}
          use:autosize
          oninput={() => save('notes', notes)}
        ></textarea>
      </div>

      <div class="field">
        <span class="field-icon"><Icon name="calendar" size={20} /></span>
        <div class="date-area">
          <div class="quick">
            <button type="button" class="pill" class:active={task.dueDate === todayKey()} onclick={() => setDate(todayKey())}>Today</button>
            <button type="button" class="pill" class:active={task.dueDate === addDays(todayKey(), 1)} onclick={() => setDate(addDays(todayKey(), 1))}>Tomorrow</button>
            {#if task.dueDate}
              <button type="button" class="pill" onclick={() => setDate(null)}>Clear date</button>
            {/if}
          </div>
          <div class="inputs">
            <label>
              <span class="small">Date</span>
              <input type="date" value={task.dueDate ?? ''} onchange={(e) => setDate(e.currentTarget.value)} />
            </label>
            <label>
              <span class="small">Time</span>
              <input
                type="time"
                value={task.dueTime ?? ''}
                disabled={!task.dueDate}
                onchange={(e) => updateTask(task.id, { dueTime: e.currentTarget.value || null })}
              />
            </label>
          </div>
          {#if task.dueDate}<p class="due-text">Due {formatDue(task.dueDate, task.dueTime)}</p>{/if}
        </div>
      </div>

      <div class="field">
        <span class="field-icon"><PriorityMarker priority={task.priority} size={20} /></span>
        <div class="prio-area" role="radiogroup" aria-label="Priority">
          {#each PRIORITY_CHOICES as choice (choice.label)}
            <button
              type="button"
              class="pill prio-pill {choice.value ?? 'none'}"
              class:active={(task.priority ?? null) === choice.value}
              role="radio"
              aria-checked={(task.priority ?? null) === choice.value}
              onclick={() => updateTask(task.id, { priority: choice.value })}
            >
              {#if choice.value}<PriorityMarker priority={choice.value} size={14} />{/if}{choice.label}
            </button>
          {/each}
        </div>
      </div>

      {#if !task.parentId}
        <div class="field">
          <span class="field-icon"><Icon name="repeat" size={20} /></span>
          <div class="repeat-area">
            <button type="button" class="pill repeat-pill" class:active={!!task.repeat} onclick={() => (repeatOpen = true)}>
              {task.repeat ? describeRule(task.repeat, task.dueDate) : 'Repeat'}
            </button>
            {#if task.repeat}
              <button type="button" class="pill" onclick={() => updateTask(task.id, { repeat: null })}>Don’t repeat</button>
              <p class="due-text">When you complete it, the next one appears with its new date.</p>
            {/if}
          </div>
        </div>
      {/if}

      {#if !task.parentId}
        <div class="field">
          <span class="field-icon"><Icon name="list" size={20} /></span>
          <label class="select-label">
            <span class="small">List</span>
            <select value={task.listId} onchange={(e) => changeList(e.currentTarget.value)}>
              {#each sortedLists() as l (l.id)}
                <option value={l.id}>{l.title}</option>
              {/each}
            </select>
          </label>
        </div>

        <div class="field subs">
          <span class="field-icon"><Icon name="subtask" size={20} /></span>
          <div class="sub-area">
            <div role="list">
              {#each subs as s (s.id)}
                <TaskRow task={s} flat {onopen} />
              {/each}
            </div>
            <form class="sub-form" onsubmit={addSub}>
              <label class="visually-hidden" for="new-sub">Add subtask</label>
              <input id="new-sub" bind:value={newSub} placeholder="Add subtask" autocomplete="off" />
            </form>
          </div>
        </div>
      {/if}

      <div class="footer">
        <button type="button" class="btn-primary" onclick={() => { flush(); setCompleted(task.id, !task.completedAt); onclose(); }}>
          {task.completedAt ? 'Mark not completed' : 'Mark completed'}
        </button>
        <p class="stamp">Created {new Date(task.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</p>
      </div>
    </div>
  </aside>
{/if}

{#if task}
  <RepeatDialog
    bind:open={repeatOpen}
    rule={task.repeat}
    dueDate={task.dueDate}
    dueTime={task.dueTime}
    onsave={(patch) => updateTask(task.id, patch)}
  />
{/if}

<style>
  .detail {
    display: flex;
    flex-direction: column;
    width: 400px;
    height: 100%;
    border-left: 1px solid var(--border);
    background: var(--bg);
  }

  header {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px 12px;
  }

  .spacer {
    flex: 1;
  }

  .starred {
    color: var(--accent-orange);
  }

  .body {
    flex: 1;
    overflow-y: auto;
    padding: 0 24px 24px;
  }

  .parent {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin: 0 0 8px -6px;
    padding: 4px 8px 4px 2px;
    border: 0;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--accent-purple);
  }

  .parent:hover {
    background: var(--accent-soft);
  }

  textarea {
    display: block;
    width: 100%;
    resize: none;
    overflow: hidden;
    border: 0;
    border-bottom: 1px solid transparent;
    background: transparent;
    color: var(--fg);
    outline: none;
  }

  textarea:focus {
    border-bottom-color: var(--accent-purple);
  }

  .title {
    padding: 4px 0;
    font-size: 22px;
    line-height: 28px;
  }

  .title.done {
    text-decoration: line-through;
    color: var(--muted);
  }

  .field {
    display: flex;
    gap: 16px;
    padding: 16px 0 0;
  }

  .field-icon {
    flex: none;
    padding-top: 6px;
    color: var(--muted);
  }

  .field > textarea {
    padding: 6px 0;
    font-size: var(--text-sm);
    line-height: 20px;
    min-height: 32px;
  }

  .date-area,
  .sub-area,
  .select-label {
    flex: 1;
    min-width: 0;
  }

  .quick {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .pill {
    height: 32px;
    padding: 0 12px;
    border: 1px solid var(--border);
    border-radius: var(--radius-pill);
    background: transparent;
    color: var(--fg);
    font-size: var(--text-sm);
  }

  .pill:hover {
    background: var(--surface-hover);
  }

  .pill.active {
    border-color: var(--accent-purple);
    background: var(--accent-soft);
    color: var(--accent-purple);
  }

  .inputs {
    display: flex;
    gap: 12px;
    margin-top: 12px;
  }

  .inputs label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    flex: 1;
    min-width: 0;
  }

  .small {
    color: var(--muted);
    font-size: var(--text-xs);
    line-height: 16px;
  }

  input[type='date'],
  input[type='time'],
  select {
    width: 100%;
    height: 40px;
    padding: 0 10px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--fg);
  }

  input:disabled {
    opacity: 0.5;
  }

  .select-label {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .prio-area {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    flex: 1;
    min-width: 0;
  }

  .prio-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .prio-pill.high.active {
    border-color: var(--accent-pink);
    background: color-mix(in srgb, var(--accent-pink) 12%, transparent);
    color: var(--accent-pink);
  }

  .prio-pill.medium.active {
    border-color: var(--accent-orange);
    background: color-mix(in srgb, var(--accent-orange) 12%, transparent);
    color: var(--accent-orange);
  }

  .prio-pill.low.active {
    border-color: var(--accent-cyan);
    background: color-mix(in srgb, var(--accent-cyan) 12%, transparent);
    color: var(--accent-cyan);
  }

  .field-icon :global(.marker) {
    margin-top: 0;
  }

  .repeat-area {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    flex: 1;
    min-width: 0;
  }

  .repeat-area .due-text {
    width: 100%;
    margin-top: 0;
  }

  .repeat-pill {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .due-text {
    margin-top: 8px;
    color: var(--muted);
    font-size: var(--text-xs);
  }

  .sub-form input {
    width: 100%;
    height: 36px;
    padding: 0 4px;
    border: 0;
    border-bottom: 1px solid var(--border);
    background: transparent;
    outline: none;
  }

  .sub-form input:focus {
    border-bottom: 2px solid var(--accent-purple);
  }

  .footer {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 12px;
    margin-top: 32px;
  }

  .stamp {
    color: var(--muted);
    font-size: var(--text-xs);
  }

  @media (max-width: 899px) {
    .detail {
      position: fixed;
      inset: 0;
      z-index: 40;
      width: 100%;
      border-left: 0;
    }
  }
</style>
