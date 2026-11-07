# Undo is its own operation, with its "before" state on the server

Undo used to be made of other operations: Reopen, a move back, and a restore of Tasks the browser kept. Those can't put back the exact previous state, because an action also changes things the browser never gets to name, such as a parent's Subtask template and changed state. So Undo is now its own operation (`src/lib/server/undo.ts`, `POST /api/undo`): the server records what an action touched and puts that back, without knowing what the action was. Reopen keeps its own rules (CONTEXT.md → Reopen).

**The record.** `undo_records` has one row per User: the latest action that can be undone, as the toast only ever offers that one. A newer action replaces the row and using it deletes it, so it can't grow without limit. The row holds whole `tasks` rows as JSON, as they were (`before`) and as the action left them (`after`), for every family the action touched (a top-level Task and its Subtasks).

**What was touched.** `undoable()` compares all of the User's Tasks before and after the mutation, so a mutation can't forget to declare something, and foreign key effects are caught too (deleting an Occurrence clears `generated_from_task_id` on the next one, even in another List). This means two extra reads and a comparison of the User's Tasks per undoable action, on the one thread that serves all requests: about 15 ms at 1,000 Tasks and 150 ms at 10,000. We accept that at the size of a personal task list; if it ever hurts, the comparison can narrow to the Lists the action names.

**When the state has moved on.** Undo applies only if the recorded families are exactly as the action left them, apart from `updatedAt`, and every Task to put back still has its List. Otherwise it answers 409, the browser shows a toast and reloads, and nothing is written. Comparing whole families rather than just the written rows is deliberate: adding a sibling writes nothing to an already-changed parent, yet putting the parent's changed state and template back would lose that sibling's effect on the series. Other Tasks of the List don't count, so working elsewhere doesn't take Undo away.

**Whose action.** The action's answer carries a random `undo` id, and the record is looked up by that id and the signed-in User. Another User's id, an older action's and a used one all get the same 404. Without the id, a toast left open in one tab could undo an action taken in another.

## Consequences

- Answers of undoable actions are `TaskChanges` plus `undo` (ADR 0003 otherwise holds): the store applies the action optimistically, and Undo's answer is `TaskChanges` too. A failed Undo reloads the page data like any failed request.
- To make an action undoable: wrap the mutation in `undoable()` in its endpoint, put `undo` in the answer, and have the store's toast send it to `api.undo`. `expectUndoRestoresLists` (`src/lib/server/testing/undo.ts`) is the spec for it.
- An action the record doesn't cover, such as an edit, doesn't replace the record. If it touches a recorded family, that Undo fails; otherwise that Undo still works.
- Undo restores a row's old `updatedAt` too, which nothing reads for now.
- A deleted Task's data stays in the record until the User's next undoable action. A migration that changes the `tasks` columns leaves old records that no longer compare as equal, which at worst fails that one Undo.
