# break-timer

A countdown timer the facilitator sets once and the whole room sees.
"Break — back at 14:05 (3 min left)." When time is up, the card says so.

## Requirements (EARS style)

- WHEN a facilitator POSTs `/api/break-timer` with `{session, endsAt}` where
  `endsAt` is an ISO-8601 timestamp in the future, THE SYSTEM SHALL store that
  end time and respond 200 with the timer state.
- WHEN a facilitator POSTs an `endsAt` that is not a valid ISO-8601 timestamp,
  in the past, or more than 8 hours ahead, THE SYSTEM SHALL respond 400 and
  record nothing.
- WHEN a facilitator POSTs a new `endsAt` while a timer is running, THE SYSTEM
  SHALL replace the existing timer (latest-wins, facilitator overrides).
- WHEN any client GETs `/api/break-timer?session=<id>`, THE SYSTEM SHALL return
  the current timer state: `{endsAt, status, minutesLeft}` where status is
  "idle" (no timer set), "running" (time remaining), or "expired" (time is up).
- WHEN the board renders the card and no timer is set, THE SYSTEM SHALL display
  an idle state with instructions for the facilitator.
- WHEN the board renders the card and the timer has expired, THE SYSTEM SHALL
  display "Time's up!" with the original end time.

## Design decisions

### Duration or end time?

End time (ISO-8601 timestamp). This is simpler and more robust than a duration:
every client's clock is irrelevant because the card recomputes "minutes left"
from `endsAt - now` on each server render. The facilitator sends one value; the
room sees a live countdown that never drifts.

### Nonsense values (negative, absurdly long, not a number)?

- Not a valid ISO-8601 string → 400, "endsAt must be an ISO-8601 timestamp"
- Valid timestamp but in the past → 400, "endsAt must be in the future"
- Valid timestamp but more than 8 hours ahead → 400, "endsAt must be within 8 hours"
  (an 8-hour cap prevents a stale timer from lingering on the board all day)

### Card states

| State        | Condition                          | Display                                         |
| ------------ | ---------------------------------- | ----------------------------------------------- |
| idle         | No timer set (store empty)         | "No break timer set" + curl hint for facilitator |
| running      | `now < endsAt`                     | "Break — back at HH:MM (N min left)"            |
| expired      | `now >= endsAt`                    | "Time's up! (was HH:MM)"                        |

The card recomputes on each server render (every ~4 seconds via /cards poll).
It does not tick every second — that is fine for a break timer.

### Setting a new timer while one runs

Replace (latest-wins). The facilitator is in control; if they set a new end
time, the old one is overwritten. This uses `put` (not `putIfAbsent`) because
we want the latest value to win — a single `BREAK#TIMER` key per session.

## Store keys

| pk                   | sk              | item                                    |
| -------------------- | --------------- | --------------------------------------- |
| `SESSION#<session>`  | `BREAK#TIMER`   | `{endsAt: ISO-8601, setAt: ISO-8601}`   |

A single item per session — `put` overwrites it. `query` by prefix `BREAK#`
returns the one timer (or none). The card reads it on every render.
