<script lang="ts">
	import { linkify } from '#lib/domain/linkify.js';

	/**
	 * Plain text with its http(s) URLs as links. The text is only ever rendered as text nodes and
	 * attribute values, never as HTML. Wrap it in an element with `white-space: pre-wrap` to keep
	 * line breaks.
	 */
	let { text }: { text: string } = $props();

	const segments = $derived(linkify(text));
</script>

<!-- External links from the User's own text; resolve() is for app routes. -->
<!-- eslint-disable svelte/no-navigation-without-resolve -->
<!-- prettier-ignore -->
{#each segments as segment, index (index)}{#if segment.kind === 'link'}<a href={segment.href} target="_blank" rel="noopener noreferrer nofollow">{segment.text}</a>{:else}{segment.text}{/if}{/each}
