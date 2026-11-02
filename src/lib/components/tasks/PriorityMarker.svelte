<script lang="ts">
	import type { Priority } from '#lib/domain/tasks.js';

	/**
	 * The Priority marker: three bars like a signal meter, as many filled as the level (Low 1,
	 * Medium 2, High 3), so the levels differ by shape as well as colour (High accent-pink, Medium
	 * accent-orange, Low accent-cyan). With no Priority every bar is an outline in the muted colour.
	 * Decorative: the surrounding control carries the accessible name.
	 */
	let { priority, size = 16 }: { priority: Priority | null; size?: number } = $props();

	const LEVEL: Record<Priority, number> = { low: 1, medium: 2, high: 3 };
	const level = $derived(priority ? LEVEL[priority] : 0);
	const bars = [
		{ x: 1.5, height: 5 },
		{ x: 6.5, height: 8.5 },
		{ x: 11.5, height: 12 }
	];
</script>

<svg
	class="marker {priority ?? 'none'}"
	viewBox="0 0 16 16"
	width={size}
	height={size}
	aria-hidden="true"
>
	{#each bars as bar, index (bar.x)}
		<rect
			x={bar.x}
			y={14.5 - bar.height}
			width="3"
			height={bar.height}
			rx="0.75"
			class:filled={index < level}
		/>
	{/each}
</svg>

<style>
	.marker {
		flex: none;
	}

	rect {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.25;
		opacity: 0.45;
	}

	rect.filled {
		fill: currentColor;
		opacity: 1;
	}

	.high {
		color: var(--accent-pink);
	}

	.medium {
		color: var(--accent-orange);
	}

	.low {
		color: var(--accent-cyan);
	}

	.none {
		color: var(--muted);
	}
</style>
