<script>
  /** Choose how a task repeats: every N days/weeks/months/years, weekdays, start date and when it ends. */
  import Dialog from './Dialog.svelte';
  import { describeRule, cleanRule } from '../../server/recurrence.js';
  import { todayKey, addDays, parseKey } from '../lib/dates.js';

  let { open = $bindable(false), rule = null, dueDate = null, dueTime = null, onsave } = $props();

  const DAYS = [
    [1, 'M', 'Monday'],
    [2, 'T', 'Tuesday'],
    [3, 'W', 'Wednesday'],
    [4, 'T', 'Thursday'],
    [5, 'F', 'Friday'],
    [6, 'S', 'Saturday'],
    [0, 'S', 'Sunday']
  ];

  let freq = $state('week');
  let interval = $state(1);
  let weekdays = $state([]);
  let start = $state(todayKey());
  let time = $state('');
  let endType = $state('never');
  let endDate = $state(addDays(todayKey(), 30));
  let endCount = $state(10);

  // Load the current values each time the dialog opens.
  $effect(() => {
    if (!open) return;
    const r = rule;
    start = dueDate || todayKey();
    time = dueTime || '';
    freq = r?.freq ?? 'week';
    interval = r?.interval ?? 1;
    weekdays = r?.weekdays?.length ? [...r.weekdays] : [parseKey(start).getDay()];
    endType = r?.end?.type ?? 'never';
    endDate = r?.end?.type === 'on' ? r.end.date : addDays(start, 30);
    endCount = r?.end?.type === 'after' ? r.end.count : 10;
  });

  const draft = $derived(
    cleanRule({
      freq,
      interval,
      weekdays: freq === 'week' ? weekdays : [],
      end: endType === 'on' ? { type: 'on', date: endDate } : endType === 'after' ? { type: 'after', count: endCount } : { type: 'never' }
    })
  );
  const summary = $derived(draft ? describeRule(draft, start) : '');
  const invalid = $derived(!start || (endType === 'on' && (!endDate || endDate < start)));

  function toggleDay(d) {
    weekdays = weekdays.includes(d) ? weekdays.filter((x) => x !== d) : [...weekdays, d];
  }

  function save(e) {
    e?.preventDefault();
    if (invalid || !draft) return;
    open = false;
    onsave({ repeat: draft, dueDate: start, dueTime: time || null });
  }
</script>

<Dialog bind:open title="Repeats" wide>
  <form id="repeat-form" class="repeat" onsubmit={save}>
    <div class="line">
      <label for="repeat-interval">Every</label>
      <input id="repeat-interval" class="text-input num" type="number" min="1" max="999" bind:value={interval} />
      <label class="visually-hidden" for="repeat-freq">Unit</label>
      <select id="repeat-freq" class="text-input unit" bind:value={freq}>
        <option value="day">{interval == 1 ? 'day' : 'days'}</option>
        <option value="week">{interval == 1 ? 'week' : 'weeks'}</option>
        <option value="month">{interval == 1 ? 'month' : 'months'}</option>
        <option value="year">{interval == 1 ? 'year' : 'years'}</option>
      </select>
    </div>

    {#if freq === 'week'}
      <div class="days" role="group" aria-label="On these days">
        {#each DAYS as [d, short, long] (d)}
          <button
            type="button"
            class="day"
            class:on={weekdays.includes(d)}
            aria-pressed={weekdays.includes(d)}
            aria-label={long}
            title={long}
            onclick={() => toggleDay(d)}>{short}</button
          >
        {/each}
      </div>
    {/if}

    <div class="two">
      <label class="field">
        Starts
        <input class="text-input" type="date" bind:value={start} required />
      </label>
      <label class="field">
        Time (optional)
        <input class="text-input" type="time" bind:value={time} />
      </label>
    </div>

    <fieldset>
      <legend>Ends</legend>
      <label class="radio"><input type="radio" name="end" value="never" bind:group={endType} /> Never</label>
      <label class="radio">
        <input type="radio" name="end" value="on" bind:group={endType} /> On
        <input class="text-input inline" type="date" bind:value={endDate} disabled={endType !== 'on'} aria-label="End date" />
      </label>
      <label class="radio">
        <input type="radio" name="end" value="after" bind:group={endType} /> After
        <input class="text-input inline num" type="number" min="1" max="999" bind:value={endCount} disabled={endType !== 'after'} aria-label="Number of times" />
        {endCount == 1 ? 'time' : 'times'}
      </label>
    </fieldset>

    <p class="summary" aria-live="polite">{invalid ? 'The end date must be after the start date.' : summary}</p>
  </form>

  {#snippet actions()}
    {#if rule}
      <button
        type="button"
        class="btn-text remove"
        onclick={() => {
          open = false;
          onsave({ repeat: null });
        }}>Don’t repeat</button
      >
    {/if}
    <button type="button" class="btn-text" onclick={() => (open = false)}>Cancel</button>
    <button type="submit" form="repeat-form" class="btn-primary" disabled={invalid}>Done</button>
  {/snippet}
</Dialog>

<style>
  .repeat {
    display: flex;
    flex-direction: column;
    gap: 20px;
    color: var(--fg);
  }

  .line {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .num {
    width: 80px;
  }

  .unit {
    width: auto;
    min-width: 120px;
  }

  .days {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .day {
    width: 36px;
    height: 36px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: 50%;
    background: transparent;
    color: var(--fg);
    font-size: var(--text-sm);
  }

  .day:hover {
    background: var(--surface-hover);
  }

  .day.on {
    border-color: var(--accent-purple);
    background: var(--accent-purple);
    color: var(--on-accent);
  }

  .two {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    color: var(--muted);
    font-size: var(--text-xs);
  }

  fieldset {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
    padding: 0;
    border: 0;
  }

  legend {
    margin-bottom: 8px;
    padding: 0;
    color: var(--muted);
    font-size: var(--text-xs);
  }

  .radio {
    display: flex;
    align-items: center;
    gap: 12px;
    min-height: 40px;
    cursor: pointer;
  }

  .radio input[type='radio'] {
    width: 18px;
    height: 18px;
    margin: 0;
    accent-color: var(--accent-purple);
  }

  .inline {
    width: auto;
  }

  .inline:disabled {
    opacity: 0.5;
  }

  .summary {
    color: var(--muted);
  }

  :global(.btn-text.remove) {
    margin-right: auto;
    color: var(--accent-pink);
  }

  @media (max-width: 479px) {
    .two {
      grid-template-columns: 1fr;
    }
  }
</style>
