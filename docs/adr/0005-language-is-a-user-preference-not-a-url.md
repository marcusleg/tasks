# Language is a per-User preference, not part of the URL

The app speaks English and German (CONTEXT.md → Language). Most i18n setups put the language in the URL (`/de/lists/…`), but here every page is private and behind a login, so localized URLs bring no search visibility, and they would break existing bookmarks, shared links and the PWA's `start_url`. So URLs stay language-neutral. A User's Language comes from their stored choice in `user_preferences`, otherwise from `Accept-Language`. It is stored on the server, unlike the per-device theme, so that server-rendered HTML arrives in the right Language on every device, and so a Calendar Link, which is fetched without a session, can speak its owner's Language.

## Considered Options

- **URL prefix** (`/de/…`): rejected for the reasons above.
- **Browser only, no setting**: rejected, because a User on a borrowed or English-only browser couldn't pick German, and a calendar feed would have nothing to go by.
- **Per-device setting like theme**: rejected, because SSR would render the wrong Language until hydration, and a Calendar Link couldn't know it.

## Consequences

- Pages without a User (login, not-allowed, errors before sign-in) go by `Accept-Language`.
- A Calendar Link whose owner never chose a Language is English: a calendar app's request says nothing about the person.
- Messages are compiled with Paraglide JS. CI fails when a message is missing in any language, so there's no silent fallback to English.
