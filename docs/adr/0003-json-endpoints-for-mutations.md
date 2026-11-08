# Load functions for reads, JSON endpoints for mutations

Pages get their data from SvelteKit `load` functions, and every change goes through small JSON endpoints under `/api/` (typed client in `src/lib/client/api.ts`). Client-side stores (`src/lib/client/*.svelte.ts`) apply each change optimistically, send it, and replace their copy with what the server answers, so check-off, inline edits, drag-and-drop and Undo stay instant. Remote functions (`query`/`command` from `$app/server`) would fit this best, but in SvelteKit 3.1 they are still behind `kit.experimental.remoteFunctions`; form actions are built around HTML forms and reloading page data, which suits drag-and-drop, Undo and multi-Task changes poorly.

## Consequences

- Task mutations answer with `TaskChanges` (`{ upserted, deleted }`), so rules that touch several Tasks (completion cascade, next Occurrence) live on the server and the browser just applies the result.
- The browser generates the ids of new Lists and Tasks (`newId()`), so it can refer to them before the server has answered. A clashing id gets a 409.
- A store sends its requests one at a time, in order. If one fails, the page data is reloaded (`invalidate('app:tasks')` / `'app:lists'`) and a toast reports it.
- Open pages pick up changes made elsewhere by reloading their page data when the User comes back to them and every 60 seconds while visible (`src/lib/client/page-refresh.ts`). We assume a User works on one device at a time, so changes made at the same moment on two devices get no special handling: the latest save wins, field by field.
- Endpoints require an `application/json` body for POST/PATCH, which keeps cross-site form posts out on top of SvelteKit's origin check. The auth guard answers anonymous `/api/` requests with 401, and the client then sends the browser to the login page.
- If remote functions become stable, the endpoints and `api.ts` can be swapped for `command`s without touching the stores' interface.
- Error answers are `{ message }` with the status, in English. The errors a User can reach through the UI also carry a `code`, which the browser turns into a message in the User's Language (README → Translations); success answers are unchanged.
