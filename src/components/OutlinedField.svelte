<script>
  /** Text field with its label resting on the outline, 56px tall. */
  import Icon from './Icon.svelte';
  let {
    id,
    label,
    value = $bindable(''),
    type = 'text',
    name = undefined,
    autocomplete = undefined,
    error = '',
    autofocus = false,
    input = $bindable(null),
    ...rest
  } = $props();

  $effect(() => {
    if (autofocus && input) input.focus();
  });
</script>

<div class="field" class:invalid={!!error}>
  <input
    bind:this={input}
    {id}
    {type}
    {name}
    {autocomplete}
    bind:value
    aria-invalid={error ? 'true' : undefined}
    aria-describedby={error ? `${id}-error` : undefined}
    spellcheck="false"
    autocapitalize="off"
    {...rest}
  />
  <label for={id}>{label}</label>
</div>
{#if error}
  <p class="error" id={`${id}-error`} role="alert"><Icon name="error" size={16} />{error}</p>
{/if}

<style>
  .field {
    position: relative;
    height: 56px;
  }

  input {
    width: 100%;
    height: 56px;
    padding: 13px 15px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--fg);
    font-size: var(--text-md);
    line-height: 24px;
    outline: none;
  }

  input:hover {
    border-color: var(--muted);
  }

  input:focus {
    border-color: var(--accent-purple);
    box-shadow: inset 0 0 0 1px var(--accent-purple);
  }

  label {
    position: absolute;
    top: -7px;
    left: 10px;
    max-width: calc(100% - 20px);
    padding: 0 4px;
    background: var(--bg);
    color: var(--muted);
    font-size: var(--text-xs);
    line-height: 16px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    pointer-events: none;
  }

  input:focus + label {
    color: var(--accent-purple);
  }

  .invalid input,
  .invalid input:focus {
    border-color: var(--accent-pink);
    box-shadow: inset 0 0 0 1px var(--accent-pink);
  }

  .invalid label {
    color: var(--accent-pink);
  }

  .error {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    padding-top: 8px;
    color: var(--accent-pink);
    font-size: var(--text-xs);
    line-height: 16px;
  }

  .error :global(svg) {
    flex: none;
  }
</style>
