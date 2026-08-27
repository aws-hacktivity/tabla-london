# back-in-ten-minutes

A break timer for the board. The facilitator sets a duration; every screen
in the room counts down to the same moment.

## Requirements (EARS style)

- WHEN a caller POSTs `/api/back-in-ten-minutes` with `{ "session", "duration" }`
  and `duration` is a positive number, THE SYSTEM SHALL record a new timer with
  `endTime = now + duration minutes` and respond `201`.
- WHEN `duration` is not a number or ≤ 0, THE SYSTEM SHALL respond `400`.
- WHEN `session` is missing or empty, THE SYSTEM SHALL respond `400`.
- WHEN one or more timers already exist, a new POST SHALL add alongside them
  (multiple concurrent timers allowed).
- WHEN a caller GETs `/api/back-in-ten-minutes?session=<id>`, THE SYSTEM SHALL
  return all timers with status `"running"` or `"expired"` and `remainingSeconds`.
- WHEN no timer has been set, the card SHALL show "Break soon, don't worry!"
- WHEN timers are running, the card SHALL stack each as
  "Break — back at HH:MM (N min left)".
- WHEN a timer has expired, its line SHALL show "Time's up!" and remain visible
  until all timers have been expired for 5+ minutes.

## Store keys

| pk                  | sk                                  | item                     |
| ------------------- | ----------------------------------- | ------------------------ |
| `SESSION#<session>` | `TIMER#<ISO-timestamp-of-creation>` | `{ endTime, createdAt }` |

Uses `store.put` (not `putIfAbsent`) because each POST creates a distinct
timer keyed by its creation timestamp — no idempotency constraint needed.
