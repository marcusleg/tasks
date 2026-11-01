<script lang="ts">
	import { page } from '$app/state';

	const links = [
		{ href: '/priority', label: 'Priority' },
		{ href: '/settings', label: 'Settings' }
	] as const;
</script>

<nav aria-label="Main">
	<section>
		<h2>Lists</h2>
		<!-- #10 replaces this with the List visibility checkboxes. -->
		<p class="placeholder">Your Lists will appear here.</p>
	</section>

	<ul>
		{#each links as link (link.href)}
			<li>
				<!-- Routes don't exist yet (#13, #18); switch to resolve() once they do. -->
				<!-- eslint-disable svelte/no-navigation-without-resolve -->
				<a
					href={link.href}
					aria-current={page.url.pathname.startsWith(link.href) ? 'page' : undefined}
				>
					{link.label}
				</a>
				<!-- eslint-enable svelte/no-navigation-without-resolve -->
			</li>
		{/each}
	</ul>
</nav>

<style>
	nav {
		display: flex;
		flex-direction: column;
		gap: var(--space-5);
	}

	h2 {
		padding: 0 var(--space-3);
		margin-bottom: var(--space-2);
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--muted);
	}

	.placeholder {
		padding: 0 var(--space-3);
		font-size: 0.875rem;
		color: var(--muted);
	}

	ul {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		margin: 0;
		padding: 0;
		list-style: none;
	}

	a {
		display: block;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-md);
		color: var(--fg);
		text-decoration: none;
	}

	a:hover {
		background: var(--surface-hover);
		color: var(--fg);
	}

	a[aria-current='page'] {
		background: var(--surface);
		font-weight: 700;
	}
</style>
