<script>
  /** Every open task with a priority, from all lists, grouped into High, Medium and Low. */
  import TaskRow from './TaskRow.svelte';
  import PriorityMarker from './PriorityMarker.svelte';
  import { store } from '../lib/store.svelte.js';

  let { onopen } = $props();

  const LEVELS = [
    ['high', 'High', 'No high-priority tasks'],
    ['medium', 'Medium', 'No medium-priority tasks'],
    ['low', 'Low', 'No low-priority tasks']
  ];

  function group(level) {
    const listIds = new Set(store.lists.map((l) => l.id));
    return store.tasks
      .filter((t) => t.priority === level && !t.completedAt && listIds.has(t.listId))
      .sort(
        (a, b) =>
          (a.dueDate || '9999') .localeCompare(b.dueDate || '9999') ||
          (a.dueTime || '99:99').localeCompare(b.dueTime || '99:99') ||
          a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
      );
  }
</script>

<div class="columns">
  {#each LEVELS as [level, label, empty] (level)}
    {@const tasks = group(level)}
    <section class="column-like" aria-label={`${label} priority tasks`}>
      <h2><PriorityMarker priority={level} size={18} />{label}<span class="count">{tasks.length || ''}</span></h2>
      {#if tasks.length}
        <div role="list">
          {#each tasks as task (task.id)}
            <TaskRow {task} showList flat {onopen} />
          {/each}
        </div>
      {:else}
        <p class="empty">{empty}</p>
      {/if}
    </section>
  {/each}
</div>

<style>
  .columns {
    display: flex;
    align-items: flex-start;
    gap: 16px;
    height: 100%;
    padding: 24px;
  }

  .column-like {
    flex: none;
    width: var(--column-width);
    max-height: 100%;
    overflow-y: auto;
    padding: 16px 8px;
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  h2 {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 16px 12px;
    font-size: 18px;
    line-height: 24px;
  }

  .count {
    margin-left: auto;
    color: var(--muted);
    font-size: var(--text-xs);
    font-weight: 400;
  }

  .empty {
    padding: 8px 16px 16px;
    color: var(--muted);
  }

  @media (max-width: 699px) {
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
  }
</style>
