# Undo is its own operation, with its "before" state on the server

Undo used to be made of other operations: Reopen, a move back, and a restore of Tasks the browser kept. Those can't put back the exact previous state, because an action also changes things the browser never gets to name, such as a parent's Subtask template and changed state. So Undo is now its own operation (`src/lib/server/undo.ts`, `POST /api/undo`): the server records what an action touched and puts that back, without knowing what the action was. Reopen keeps its own rules (CONTEXT.md → Reopen).

**The record.** `undo_records` has one row per User: the latest action that can be undone, as the toast only ever offers that one. A newer action replaces the row and using it deletes it, so it can't grow without limit. The row holds whole `tasks` rows as JSON, as they were (`before`) and as the action left them (`after`), for every family the action touched (a top-level Task and its Subtasks).

**What was touched.** `undoable()` compares all of the User's Tasks before and after the mutation, so a mutation can't forget to declare something, and foreign key effects are caught too (deleting an Occurrence clears `generated_from_task_id` on the next one, even in another List). This means two extra reads and a comparison of the User's Tasks per undoable action, on the one thread that serves all requests: about 15 ms at 1,000 Tasks and 150 ms at 10,000. We accept that at the size of a personal task list. Narrowing the comparison to the Lists an action names would miss that foreign key effect; any cheaper way of finding the changes stays inside `undoable()`, without touching its callers.

**When the state has moved on.** Undo refuses with a 409, and the browser shows a toast and reloads with nothing written, if, apart from `updatedAt`:

- a Task Undo would write or delete isn't as the action left it, or one it would put back has returned by id;
- the top-level Task of a family the action touched isn't as the action left it;
- the action changed more of that top-level Task than marking it as changed, and any Task of the family isn't as the action left it, or a new Subtask has joined it;
- a List to put a Task back into is gone.

Anything else doesn't get in the way, and a later change that doesn't conflict stays. So after deleting Cake from a plain Task, adding the Subtask Balloons leaves Undo working, and the Subtasks end up Cake, Candles and Balloons. Refusing there would lose Cake for nothing, as Undo writes neither the parent nor Balloons.

The second case is a deliberately simple rule. It keeps a Subtask from coming back to a parent that has been completed, deleted or given another template, and it also refuses unrelated edits to the parent, such as a rename, even where Undo wouldn't write the parent. Those are rare within the toast's lifetime, and a list of the fields that matter would be one more thing to keep right.

The third case is why families are recorded whole. If the action changed the parent's fields or template, Undo writes the parent's changed state and template back, and that would lose what a later change to a sibling meant for the series. For example, deleting a Subtask with "This Occurrence" gives the parent a template; a sibling added with "This Occurrence" then writes nothing to the parent, but removing that template would pass the sibling on to future Occurrences. Likewise, a new Occurrence that Undo would delete takes its later Subtasks with it, so those refuse too.

A sibling's `position` counts like its other fields there. Reordering a sibling also marks it as changed, and the same loss applies: without the template it kept, the next Occurrence would copy the new order.

Marking the parent as changed doesn't count for the third case, or every Occurrence after the first would lose its Subtask until its first change. Delete Fern from an unchanged generated Occurrence and add Reed: Undo brings Fern back. It puts the parent's changed state back only if the family is otherwise as the action left it. After Reed the parent stays marked, as Reed is a real change: reopening the previous Occurrence gives a one-off Task, and the current Occurrence stays with its Subtasks. Without a later change, the current Occurrence gives way, as it would have before the action.

**Whose action.** The action's answer carries a random `undo` id, and the record is looked up by that id and the signed-in User. Another User's id, an older action's, a used one and one whose record went with a deleted List all get the same 404. Without the id, a toast left open in one tab could undo an action taken in another.

## Consequences

- Answers of undoable actions are `TaskChanges` plus `undo` (ADR 0003 otherwise holds): the store applies the action optimistically, and Undo's answer is `TaskChanges` too. A failed Undo reloads the page data like any failed request.
- To make an action undoable: wrap the mutation in `undoable()` where it is known to offer Undo, put `undo` in the answer, and have the store's toast send it to `api.undo`. `expectUndoRestoresLists` (`src/lib/server/testing/undo.ts`) is the spec for it.
- Wrap only actions whose toast offers Undo. Any other replaces the record while the toast of the action before it is still showing, and turns that Undo into a 404. So the move endpoint must wrap only moves between Lists: it also serves moves within a List, which show no toast.
- An action that isn't wrapped, such as an edit, doesn't replace the record. Whether that Undo still applies is up to the rule above.
- Undo puts back a row's old `position`, unless a sibling has taken that key since: then the Task goes right before that sibling (`restoredPosition`), as tied keys would make dragging between them fail. Undo restores a row's old `updatedAt` too, which nothing reads for now.
- A record that can't be read, or whose rows don't have exactly the current `tasks` columns, gets a 409 instead of being written back, as that would lose fields without a word. A migration that changes what a `tasks` column means without renaming it should clear `undo_records`.
- A deleted Task's title and description stay in the record until the User's next undoable action, until a List it mentions is deleted, or until the User is. There's no time limit: a User who rarely deletes keeps that one record for an Undo offered for about 6 seconds. We accept that, as nothing is shared between Users and #60 makes every check-off replace it.
