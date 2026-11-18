<script>
  import Icon from './Icon.svelte';
  import { formatDue, formatCompleted } from '../lib/dates.js';
  import { describeRule } from '../../server/recurrence.js';
  import PriorityMarker from './PriorityMarker.svelte';
  import { PRIORITY_LABEL } from '../lib/priority.js';
  import { setCompleted, setStarred, deleteTask, isOverdue, subtasks, listById } from '../lib/store.svelte.js';
  import { drag, start, end, overRow, dropOnRow } from '../lib/drag.svelte.js';

  let { task, siblings = [], canDrag = false, showList = false, flat = false, onopen } = $props();

  const done = $derived(!!task.completedAt);
  const overdue = $derived(isOverdue(task));
  const subCount = $derived(subtasks(task.id, true).length);
  const subOpen = $derived(subtasks(task.id).length);
  const indicator = $derived(drag.overId === task.id ? (drag.after ? 'after' : 'before') : null);
</script>

<div
  class="row"
  class:sub={!!task.parentId && !done && !flat}
  class:done
  class:dragging={drag.id === task.id}
  data-drop={indicator}
  draggable={canDrag && !done}
  ondragstart={(e) => start(e, task)}
  ondragend={end}
  ondragover={(e) => canDrag && !done && overRow(e, task)}
  ondrop={(e) => canDrag && !done && dropOnRow(e, task, siblings)}
  role="listitem"
>
  <button
    type="button"
    class="check"
    aria-label={done ? `Mark “${task.title || 'untitled'}” as not complete` : `Mark “${task.title || 'untitled'}” as complete`}
    title={done ? 'Mark not complete' : 'Mark complete'}
    onclick={() => setCompleted(task.id, !done)}
  >
    <span class="circle"><Icon name="check" size={14} /></span>
  </button>

  <button type="button" class="content" onclick={() => onopen(task.id)}>
    <span class="title" class:empty={!task.title}>{task.title || 'Untitled task'}</span>
    {#if task.notes && !done}
      <span class="notes">{task.notes}</span>
    {/if}
    {#if done}
      <span class="meta">{formatCompleted(task.completedAt)}</span>
    {:else if task.dueDate || showList || (subCount > 0 && !task.parentId)}
      <span class="chips">
        {#if task.dueDate}
          <span class="chip" class:overdue><Icon name="calendar" size={14} />{formatDue(task.dueDate, task.dueTime)}</span>
          {#if task.repeat}
            <span class="chip plain" title={describeRule(task.repeat, task.dueDate)}>
              <Icon name="repeat" size={14} /><span class="visually-hidden">{describeRule(task.repeat, task.dueDate)}</span>
            </span>
          {/if}
        {/if}
        {#if showList}
          <span class="chip list">{listById(task.listId)?.title}</span>
        {/if}
        {#if subCount > 0 && !task.parentId}
          <span class="chip plain"><Icon name="subtask" size={14} />{subCount - subOpen}/{subCount}</span>
        {/if}
      </span>
    {/if}
  </button>

  {#if task.priority && !done}
    <span class="prio" title={`${PRIORITY_LABEL[task.priority]} priority`}>
      <PriorityMarker priority={task.priority} />
      <span class="visually-hidden">{PRIORITY_LABEL[task.priority]} priority</span>
    </span>
  {/if}
  {#if done}
    <button type="button" class="icon-btn side" aria-label="Delete task" title="Delete task" onclick={() => deleteTask(task.id)}>
      <Icon name="trash" size={20} />
    </button>
  {:else}
    <button
      type="button"
      class="icon-btn side star"
      class:on={!!task.starredAt}
      aria-label={task.starredAt ? 'Remove star' : 'Add star'}
      aria-pressed={!!task.starredAt}
      title={task.starredAt ? 'Remove star' : 'Add star'}
      onclick={() => setStarred(task.id, !task.starredAt)}
    >
      <Icon name="star" size={20} filled={!!task.starredAt} />
    </button>
  {/if}
</div>

<style>
  .row {
    position: relative;
    display: flex;
    align-items: flex-start;
    gap: 4px;
    padding: 4px 8px 4px 12px;
    border-radius: var(--radius-sm);
  }

  .row:hover {
    background: var(--surface-hover);
  }

  .row.sub {
    padding-left: 44px;
  }

  .row.dragging {
    opacity: 0.4;
  }

  .row[data-drop]::before {
    content: '';
    position: absolute;
    left: 12px;
    right: 8px;
    height: 2px;
    border-radius: 1px;
    background: var(--accent-purple);
  }

  .row[data-drop='before']::before {
    top: -1px;
  }

  .row[data-drop='after']::before {
    bottom: -1px;
  }

  .check {
    display: grid;
    place-items: center;
    flex: none;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--muted);
  }

  .circle {
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    border: 2px solid currentColor;
    border-radius: 50%;
  }

  .circle :global(svg) {
    opacity: 0;
    stroke-width: 3;
  }

  .check:hover {
    color: var(--accent-purple);
  }

  .check:hover .circle :global(svg) {
    opacity: 1;
  }

  .done .circle {
    border-color: var(--accent-purple);
    background: var(--accent-purple);
    color: var(--on-accent);
  }

  .done .circle :global(svg) {
    opacity: 1;
  }

  .content {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
    padding: 6px 4px;
    border: 0;
    background: transparent;
    color: var(--fg);
    text-align: left;
    cursor: pointer;
  }

  .title {
    font-size: var(--text-sm);
    line-height: 20px;
    overflow-wrap: anywhere;
  }

  .title.empty {
    color: var(--muted);
  }

  .done .title {
    color: var(--muted);
    text-decoration: line-through;
  }

  .notes {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    color: var(--muted);
    font-size: var(--text-xs);
    line-height: 16px;
    white-space: pre-line;
  }

  .meta {
    color: var(--muted);
    font-size: var(--text-xs);
    line-height: 16px;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 4px;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 24px;
    padding: 0 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-pill);
    color: var(--fg);
    font-size: var(--text-xs);
  }

  .chip.overdue {
    border-color: var(--accent-pink);
    background: var(--accent-pink);
    color: var(--on-accent);
    font-weight: 700;
  }

  .chip.list {
    color: var(--accent-cyan);
  }

  .chip.plain {
    border-color: transparent;
    padding: 0 4px;
    color: var(--muted);
  }

  .prio {
    display: grid;
    place-items: center;
    flex: none;
    width: 24px;
    height: 32px;
  }

  .side {
    flex: none;
    width: 32px;
    height: 32px;
    opacity: 0;
  }

  .row:hover .side,
  .side:focus-visible,
  .star.on {
    opacity: 1;
  }

  .star.on {
    color: var(--accent-orange);
  }

  @media (hover: none) {
    .side {
      opacity: 1;
    }
  }
</style>
