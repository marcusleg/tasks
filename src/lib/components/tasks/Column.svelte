<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * The card a column of Tasks sits in: a List (`ListColumn`), or a Priority group in the
	 * Priority View (#13). Its width comes from the parent.
	 */
	type Props = {
		/** The id of the heading inside `header`, which names the column. */
		labelledBy: string;
		header: Snippet;
		children: Snippet;
	};

	let { labelledBy, header, children }: Props = $props();
</script>

<section class="column" aria-labelledby={labelledBy}>
	<header>{@render header()}</header>
	{@render children()}
</section>

<style>
	.column {
		display: flex;
		flex-direction: column;
		min-width: 0;
		padding: var(--space-2) var(--space-2) var(--space-3);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
	}

	header {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: 3rem;
		padding: 0 0 0 var(--space-3);
	}
</style>
