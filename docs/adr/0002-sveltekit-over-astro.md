# SvelteKit as the application framework

We use SvelteKit, running on the Node adapter, for both the server side (OIDC login, sessions, data endpoints, the Calendar Link `.ics` route) and the UI. Astro was the main alternative and would have worked. But nearly every screen in this app is interactive: drag-and-drop ordering across Lists, inline editing, collapsible Subtasks. Under Astro's islands model the whole app would have ended up as one large island with Astro as a thin shell around it. A full-stack app framework fits that shape directly.
