<script lang="ts">
	import { tick } from 'svelte';
	import { api } from '#lib/client/api.js';
	import { getListStore } from '#lib/client/lists.svelte.js';
	import { getToasts } from '#lib/client/toasts.svelte.js';
	import { LANGUAGES, type Language, type LanguagePreference } from '#lib/language.js';
	import { m } from '#lib/paraglide/messages.js';
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

	/** Each Language in its own language, whatever the current one. Complete by type. */
	const languageNames: Record<Language, () => string> = {
		en: () => m.settings_language_en(),
		de: () => m.settings_language_de()
	};

	let languagePreference = $derived<LanguagePreference>(data.languagePreference);
	let languageError = $state('');
	let languageBusy = $state(false);

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
			? m.settings_calendar_link_all_lists()
			: link.listIds
					.map((id) => lists.get(id)?.name)
					.filter(Boolean)
					.join(', ') || m.settings_calendar_link_no_lists();

	const created = (iso: string) =>
		new Date(iso).toLocaleDateString(data.dateLocale, { dateStyle: 'medium' });

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
		if (!name.trim()) return void (error = m.settings_calendar_link_error_enter_name());
		if (!allLists && chosen.length === 0)
			return void (error = m.settings_calendar_link_error_choose_list());
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
			error = cause instanceof Error ? cause.message : m.settings_calendar_link_error_generic();
		} finally {
			busy = false;
		}
	}

	/**
	 * Stores the choice, then loads the page anew: the Language is read once per document
	 * (src/hooks.client.ts), so only a full page load shows the app in it.
	 */
	async function chooseLanguage(event: Event) {
		const select = event.currentTarget as HTMLSelectElement;
		const chosen = select.value as LanguagePreference;
		languageBusy = true;
		languageError = '';
		try {
			await api.setLanguagePreference(chosen);
			location.reload();
		} catch {
			select.value = languagePreference;
			languageError = m.settings_language_error();
			languageBusy = false;
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
			toasts.failed(m.toast_what_delete_calendar_link(), cause);
		}
	}
</script>

<svelte:head>
	<title>{m.settings_title()} · Tasks</title>
</svelte:head>

<div class="settings">
	<h1>{m.settings_title()}</h1>

	<section aria-labelledby="language-heading">
		<h2 id="language-heading">{m.settings_language()}</h2>
		<p class="muted">{m.settings_language_description()}</p>
		<select
			aria-labelledby="language-heading"
			value={languagePreference}
			disabled={languageBusy}
			onchange={chooseLanguage}
		>
			<option value="automatic">{m.settings_language_automatic()}</option>
			{#each LANGUAGES as language (language)}
				<option value={language} lang={language}>{languageNames[language]()}</option>
			{/each}
		</select>
		{#if languageError}
			<p class="error" role="alert">{languageError}</p>
		{/if}
	</section>

	<section aria-labelledby="calendar-links-heading">
		<div class="section-header">
			<h2 id="calendar-links-heading">{m.settings_calendar_links()}</h2>
			{#if editing === null}
				<button type="button" class="primary" onclick={() => startEditing()}>
					{m.settings_calendar_link_new()}
				</button>
			{/if}
		</div>
		<p class="muted">{m.settings_calendar_links_description()}</p>

		<details class="help">
			<summary>{m.settings_calendar_links_help()}</summary>
			<ol>
				<li>{m.settings_calendar_links_help_step_copy()}</li>
				<li>{m.settings_calendar_links_help_step_subscribe()}</li>
				<li>{m.settings_calendar_links_help_step_paste()}</li>
			</ol>
			<p class="muted">{m.settings_calendar_links_help_refresh()}</p>
		</details>

		{#if editing !== null}
			<form class="editor" onsubmit={save}>
				<h3>
					{editing === 'new'
						? m.settings_calendar_link_new()
						: m.settings_calendar_link_edit_title()}
				</h3>
				<label class="field">
					<span>{m.settings_calendar_link_name()}</span>
					<input
						bind:this={nameInput}
						bind:value={name}
						maxlength={MAX_CALENDAR_LINK_NAME_LENGTH}
						autocomplete="off"
						placeholder={m.settings_calendar_link_name_placeholder()}
					/>
				</label>
				<fieldset>
					<legend>{m.settings_calendar_link_lists()}</legend>
					<label class="check">
						<input type="checkbox" bind:checked={allLists} />
						{m.settings_calendar_link_all_lists_including_new()}
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
					<button type="button" class="secondary" onclick={cancel}>{m.settings_cancel()}</button>
					<button type="submit" class="primary" disabled={busy}>
						{editing === 'new'
							? m.settings_calendar_link_create()
							: m.settings_calendar_link_save()}
					</button>
				</div>
			</form>
		{/if}

		{#if links.length === 0 && editing === null}
			<p class="empty">{m.settings_calendar_links_empty()}</p>
		{:else}
			<ul class="links" aria-label={m.settings_calendar_links()}>
				{#each links as link (link.id)}
					<li>
						<article aria-label={link.name}>
							<h3>{link.name}</h3>
							<dl>
								<div>
									<dt>{m.settings_calendar_link_lists()}</dt>
									<dd>{listNames(link)}</dd>
								</div>
								<div>
									<dt>{m.settings_calendar_link_created()}</dt>
									<dd>{created(link.createdAt)}</dd>
								</div>
								<div>
									<dt>{m.settings_calendar_link_last_accessed()}</dt>
									<dd>{formatLastAccessed(link.lastAccessedAt, data.dateLocale)}</dd>
								</div>
							</dl>
							<div class="actions">
								<button type="button" class="secondary" onclick={() => copy(link)}>
									{copiedId === link.id
										? m.settings_calendar_link_copied()
										: m.settings_calendar_link_copy()}
								</button>
								<button type="button" class="secondary" onclick={() => startEditing(link)}>
									{m.settings_calendar_link_edit()}
								</button>
								<button
									type="button"
									class="secondary"
									onclick={() => {
										deleting = link;
										confirmOpen = true;
									}}
								>
									{m.settings_calendar_link_delete()}
								</button>
							</div>
							{#if manualUrl?.id === link.id}
								<label class="field">
									<span>{m.settings_calendar_link_copy_manual()}</span>
									<input
										readonly
										value={manualUrl.url}
										onfocus={selectAll}
										aria-label={m.settings_calendar_link_url()}
									/>
								</label>
							{/if}
						</article>
					</li>
				{/each}
			</ul>
		{/if}
		<p class="visually-hidden" role="status">
			{copiedId ? m.settings_calendar_link_url_copied() : ''}
		</p>
	</section>
</div>

<ConfirmDialog
	bind:open={confirmOpen}
	title={m.settings_calendar_link_delete_title()}
	message={m.settings_calendar_link_delete_message({ name: deleting?.name ?? '' })}
	confirmLabel={m.settings_calendar_link_delete()}
	cancelLabel={m.settings_cancel()}
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

	select,
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
