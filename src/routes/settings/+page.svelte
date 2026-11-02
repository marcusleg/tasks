<script lang="ts">
	import { tick } from 'svelte';
	import { api } from '#lib/client/api.js';
	import { getListStore } from '#lib/client/lists.svelte.js';
	import { getToasts } from '#lib/client/toasts.svelte.js';
	import {
		MAX_CALENDAR_LINK_NAME_LENGTH,
		formatLastAccessed,
		type SerializedCalendarLink
	} from '#lib/domain/calendar-links.js';
	import ConfirmDialog from '#lib/components/ConfirmDialog.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const lists = getListStore();
	const toasts = getToasts();

	let links = $derived<SerializedCalendarLink[]>(data.calendarLinks);

	/** The form is open for a new link (`'new'`) or for editing the link with this id. */
	let editing = $state<'new' | string | null>(null);
	let name = $state('');
	let allLists = $state(true);
	let chosen = $state<string[]>([]);
	let error = $state('');
	let busy = $state(false);
	let nameInput = $state<HTMLInputElement>();

	let deleting = $state<SerializedCalendarLink>();
	let confirmOpen = $state(false);
	/** Shown when the Clipboard API is unavailable or refused. */
	let manualUrl = $state<{ id: string; url: string } | null>(null);
	let copiedId = $state<string | null>(null);

	const listNames = (link: SerializedCalendarLink) =>
		link.allLists
			? 'All Lists'
			: link.listIds
					.map((id) => lists.get(id)?.name)
					.filter(Boolean)
					.join(', ') || 'No Lists';

	const created = (iso: string) => new Date(iso).toLocaleDateString('en', { dateStyle: 'medium' });

	async function startEditing(link?: SerializedCalendarLink) {
		editing = link ? link.id : 'new';
		name = link?.name ?? '';
		allLists = link?.allLists ?? true;
		chosen = link ? [...link.listIds] : [];
		error = '';
		await tick();
		nameInput?.focus();
	}

	function cancel() {
		editing = null;
		error = '';
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (!name.trim()) return void (error = 'Enter a name');
		if (!allLists && chosen.length === 0) return void (error = 'Choose at least one List');
		busy = true;
		error = '';
		try {
			const input = { name, allLists, ...(allLists ? {} : { listIds: chosen }) };
			if (editing === 'new') {
				const { calendarLink } = await api.createCalendarLink(input);
				links = [...links, calendarLink];
			} else if (editing) {
				const id = editing;
				const { calendarLink } = await api.updateCalendarLink(id, input);
				links = links.map((l) => (l.id === id ? calendarLink : l));
			}
			editing = null;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : 'Something went wrong';
		} finally {
			busy = false;
		}
	}

	async function copy(link: SerializedCalendarLink) {
		try {
			await navigator.clipboard.writeText(link.url);
			manualUrl = null;
			copiedId = link.id;
			setTimeout(() => {
				if (copiedId === link.id) copiedId = null;
			}, 3000);
		} catch {
			manualUrl = { id: link.id, url: link.url };
		}
	}

	function selectAll(event: Event) {
		(event.currentTarget as HTMLInputElement).select();
	}

	async function remove() {
		const link = deleting;
		if (!link) return;
		try {
			await api.deleteCalendarLink(link.id);
			links = links.filter((l) => l.id !== link.id);
		} catch (cause) {
			toasts.failed('delete the Calendar Link', cause);
		}
	}
</script>

<svelte:head>
	<title>Settings · Tasks</title>
</svelte:head>

<div class="settings">
	<h1>Settings</h1>

	<section aria-labelledby="calendar-links-heading">
		<div class="section-header">
			<h2 id="calendar-links-heading">Calendar Links</h2>
			{#if editing === null}
				<button type="button" class="primary" onclick={() => startEditing()}>
					New Calendar Link
				</button>
			{/if}
		</div>
		<p class="muted">
			A Calendar Link is a secret URL that publishes the Planned and Due Dates of your open Tasks as
			a read-only calendar. Anyone with the URL can see those Tasks, so delete the link to revoke
			access.
		</p>

		<details class="help">
			<summary>Add a Calendar Link to your calendar app</summary>
			<ol>
				<li>Copy the URL of a Calendar Link below.</li>
				<li>
					In your calendar app, look for an option to subscribe to a calendar or add one from a URL.
				</li>
				<li>Paste the URL, give the calendar a name and save.</li>
			</ol>
			<p class="muted">
				Calendar apps refresh subscribed calendars on their own schedule, often only every few
				hours, so changes may not show up right away.
			</p>
		</details>

		{#if editing !== null}
			<form class="editor" onsubmit={save}>
				<h3>{editing === 'new' ? 'New Calendar Link' : 'Edit Calendar Link'}</h3>
				<label class="field">
					<span>Name</span>
					<input
						bind:this={nameInput}
						bind:value={name}
						maxlength={MAX_CALENDAR_LINK_NAME_LENGTH}
						autocomplete="off"
						placeholder="e.g. Phone calendar"
					/>
				</label>
				<fieldset>
					<legend>Lists</legend>
					<label class="check">
						<input type="checkbox" bind:checked={allLists} />
						All Lists (including ones created later)
					</label>
					{#if !allLists}
						{#each lists.all as list (list.id)}
							<label class="check">
								<input type="checkbox" value={list.id} bind:group={chosen} />
								{list.name}
							</label>
						{/each}
					{/if}
				</fieldset>
				{#if error}
					<p class="error" role="alert">{error}</p>
				{/if}
				<div class="actions">
					<button type="button" class="secondary" onclick={cancel}>Cancel</button>
					<button type="submit" class="primary" disabled={busy}>
						{editing === 'new' ? 'Create' : 'Save'}
					</button>
				</div>
			</form>
		{/if}

		{#if links.length === 0 && editing === null}
			<p class="empty">No Calendar Links yet.</p>
		{:else}
			<ul class="links" aria-label="Calendar Links">
				{#each links as link (link.id)}
					<li>
						<article aria-label={link.name}>
							<h3>{link.name}</h3>
							<dl>
								<div>
									<dt>Lists</dt>
									<dd>{listNames(link)}</dd>
								</div>
								<div>
									<dt>Created</dt>
									<dd>{created(link.createdAt)}</dd>
								</div>
								<div>
									<dt>Last accessed</dt>
									<dd>{formatLastAccessed(link.lastAccessedAt)}</dd>
								</div>
							</dl>
							<div class="actions">
								<button type="button" class="secondary" onclick={() => copy(link)}>
									{copiedId === link.id ? 'Copied' : 'Copy URL'}
								</button>
								<button type="button" class="secondary" onclick={() => startEditing(link)}>
									Edit
								</button>
								<button
									type="button"
									class="secondary"
									onclick={() => {
										deleting = link;
										confirmOpen = true;
									}}
								>
									Delete
								</button>
							</div>
							{#if manualUrl?.id === link.id}
								<label class="field">
									<span>Press Ctrl+C to copy the URL</span>
									<input readonly value={manualUrl.url} onfocus={selectAll} aria-label="URL" />
								</label>
							{/if}
						</article>
					</li>
				{/each}
			</ul>
		{/if}
		<p class="visually-hidden" role="status">{copiedId ? 'URL copied' : ''}</p>
	</section>
</div>

<ConfirmDialog
	bind:open={confirmOpen}
	title="Delete Calendar Link"
	message={`Delete "${deleting?.name ?? ''}"? Calendar apps subscribed to its URL will stop receiving updates immediately.`}
	confirmLabel="Delete"
	onConfirm={remove}
/>

<style>
	.settings {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
		max-width: 44rem;
	}

	section {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	.section-header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.muted,
	dt,
	.empty {
		color: var(--muted);
	}

	.help {
		padding: var(--space-3) var(--space-4);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
	}

	.help summary {
		cursor: pointer;
		font-weight: 700;
	}

	.help ol {
		margin: var(--space-3) 0;
		padding-left: var(--space-5);
	}

	.links {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	article,
	.editor {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		padding: var(--space-4);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
	}

	h3 {
		font-size: 1rem;
		overflow-wrap: anywhere;
	}

	dl {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin: 0;
	}

	dl > div {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-1) var(--space-3);
	}

	dt {
		min-width: 7rem;
	}

	dd {
		margin: 0;
		min-width: 0;
		overflow-wrap: anywhere;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.editor .actions {
		justify-content: flex-end;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
	}

	.field span,
	legend {
		font-size: 0.875rem;
		color: var(--muted);
	}

	input:not([type='checkbox']) {
		width: 100%;
		padding: var(--space-2) var(--space-3);
		background: var(--bg);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
	}

	fieldset {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		margin: 0;
		padding: 0;
		border: none;
	}

	.check {
		display: flex;
		align-items: center;
		gap: var(--space-2);
	}

	.error {
		color: var(--accent-pink);
	}

	button {
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius-md);
		font-weight: 700;
	}

	.primary {
		background: var(--accent-purple);
		border: 1px solid var(--accent-purple);
		color: var(--on-accent);
	}

	.secondary {
		background: transparent;
		border: 1px solid var(--border);
	}

	.secondary:hover {
		background: var(--surface-hover);
	}

	button:disabled {
		opacity: 0.6;
		cursor: default;
	}
</style>
