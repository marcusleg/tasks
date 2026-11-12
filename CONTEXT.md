# Tasks

A minimalist, self-hosted to-do app in the spirit of Google Tasks. Each User keeps private Lists of Tasks and can see their dated Tasks in an external calendar.

## Language

### Ownership

**User**:
A person who signs in through the configured identity provider. A User owns their Lists outright; nothing is shared between Users.
_Avoid_: Account, member

**Language**:
The language a User sees the app in: detected from their browser, or chosen by them and then the same on every device. Dates and times are written the way that Language writes them. Things a User has created, like the first List, keep the name they got, whatever the Language later becomes. A Calendar Link speaks its owner's chosen Language, otherwise English. The app is called Tasks in every Language.
_Avoid_: Locale, translation

**List**:
A named, ordered collection of Tasks owned by one User.
_Avoid_: To-Do list, project, folder, board

**Hidden List**:
A List the User has chosen not to show on the main page, on any device. Its Tasks are untouched and still count in the Priority View and Calendar Links. To see it again, the User shows it; a link can't open it while it stays hidden.
_Avoid_: Archived, collapsed, inactive

### Tasks

**Task**:
A single thing to do, belonging to exactly one List.
_Avoid_: Todo, item, entry

**Subtask**:
A Task that has a parent Task. Nesting is one level deep: a Subtask can't have Subtasks of its own. Apart from that it carries the same fields as any Task.
_Avoid_: Child task, sub-item, checklist item

**Planned Date**:
When the User intends to work on a Task. It is either unset, a date (all day), or a date with a time and a Duration, anchored to a time zone.
_Avoid_: Scheduled date, start date, do date

**Duration**:
How long a timed Planned Date lasts; 30 minutes unless changed. Only Planned Dates have one.
_Avoid_: Length, time block

**Due Date**:
When a Task must be done by. It is either unset, a date (all day), or a single point in time anchored to a time zone. It has no Duration. Planned Date normally falls on or before Due Date.
_Avoid_: Deadline, end date

**Priority**:
An optional importance level on a Task: High, Medium, or Low.
_Avoid_: Importance, urgency, star

**Completed**:
The state of a Task that has been checked off. Completing a Task completes all of its Subtasks too; a recurring Subtask completed this way doesn't get a next Occurrence. Completing the last open Subtask doesn't complete the parent. Reopening a Task puts it back as it was: only the Subtasks its completion closed are reopened.
_Avoid_: Done, finished, archived

**Reopen**:
Undoing a Task's Completed state. Reopen is not Undo and follows its own rules. Reopening a Subtask whose parent is Completed reopens the parent too (a Completed Task never has open Subtasks), but not its other Subtasks. If the Occurrence being reopened is the one that created the current Occurrence, and that current Occurrence hasn't been changed by the User, the reopened Occurrence takes its place again. In every other case it comes back as a one-off Task with no Recurrence.
_Avoid_: Uncomplete, uncheck, restore

**Undo**:
Putting back the exact state before the User's latest action, once, from the toast that action showed. It covers everything the action did, including to the parent and to future Occurrences. If putting that back would overwrite or lose a later change, Undo does nothing and says so: that means a later change to what the action changed, to the parent, or, if the action changed the parent's fields or Subtask template, to any of the parent's Subtasks. Other later changes stay, such as a new Subtask next to a deleted one that comes back, and they still count as changes for Reopen. Unlike Reopen, it follows no rules of its own about what comes back: the "Task completed" toast's Undo brings back the Occurrence and Subtasks exactly as they were (a final Occurrence keeps its Recurrence, a completed Subtask leaves its parent unmarked), whereas Reopen from the Completed section can bring back a one-off Task.
_Avoid_: Revert, rollback, restore

### Recurrence

**Recurrence**:
A rule that makes a Task repeat every N days, weeks (on chosen weekdays), months or years, with an optional end. Each step moves the Planned Date and Due Date forward together. It counts either from the scheduled date or from when the Task was completed. A recurring Task has at least one date. A Task and its Subtasks can't both recur: either the parent recurs, or some of its Subtasks do.
_Avoid_: Repeat, schedule, series

**Occurrence**:
One instance of a recurring Task. Only the current Occurrence exists in a List; later ones are projected from the Recurrence. When an Occurrence is completed it stays Completed, and the next Occurrence appears as a new open Task, with its Subtasks reopened and their dates shifted. You can edit or delete just the current Occurrence (deleting it skips to the next), or the current Occurrence and all future ones. Changes to its Subtasks work the same way; completing a Subtask is progress on the current Occurrence, not a change to the series: it never asks which Occurrences it reaches. It does count as a change for Reopen, though, as it marks the Occurrence as worked on; Undo of that completion leaves the Occurrence unmarked again.
_Avoid_: Instance, copy, repetition

### Ordering and views

**Custom Order**:
The User's hand-arranged order of Tasks within a List (and of Subtasks within their parent). It is always kept, whichever Sort Mode is showing.
_Avoid_: Manual order, position, rank

**Sort Mode**:
How a List is currently displayed: Custom Order, by Planned Date, by Due Date, by Priority, or by Title. Each List remembers its own Sort Mode.
_Avoid_: View, ordering

**Priority View**:
A view across all Lists that groups every open Task that has a Priority into High, Medium and Low.
_Avoid_: Starred, dashboard, focus view

### Calendar

**Calendar Link**:
A User-named secret URL that a calendar app subscribes to as one read-only calendar. It publishes the Planned and Due Dates of open Tasks from the Lists it covers.
_Avoid_: Feed, subscription, ICS URL, export
