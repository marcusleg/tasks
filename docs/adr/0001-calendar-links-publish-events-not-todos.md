# Calendar Links publish Tasks as events, not to-dos

Calendar Links represent each Task's Planned Date and Due Date as iCalendar `VEVENT`s rather than as a single `VTODO`, even though `VTODO` is the semantically correct component. Many calendar apps that subscribe to a URL ignore `VTODO` and show only events, so a `VTODO` feed would show up as an empty calendar there.

## Consequences

- One Task can produce up to two events (Planned and Due). Date-only values become all-day events. A timed Planned Date lasts for its Duration. A timed Due Date is a zero-length event.
- Recurring Tasks are published as one event series with an `RRULE`, so future Occurrences show up in the calendar before they exist in the app.
- There's no auth header support, so the secret lives in the URL. Calendar apps refresh subscribed calendars on their own schedule, often only every few hours, so changes are never immediate.
- `VTODO` output is out of scope for now, not rejected. It may be added later as an option for clients that support it, alongside the event output rather than replacing it.
