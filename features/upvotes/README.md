# upvotes

Ask a question and upvote the ones you want answered. Attendees submit short
questions from their phones; anyone can upvote; the board shows them
newest-first with a live vote count. One vote per person per question, and
tapping again removes your vote (toggle).

## Requirements (EARS style)

### Submit (R1)

- WHEN a caller POSTs `/api/upvotes` with `{session, text}` and `text` is a
  non-empty string of 150 words or fewer, THE SYSTEM SHALL store the question
  with a new unique id and vote count 0 and respond `201` with
  `{id, text, votes: 0}`.
- WHEN `text` is missing, empty, or blank after trimming, THE SYSTEM SHALL
  respond `400` and store nothing.
- WHEN `text` exceeds 150 words, THE SYSTEM SHALL respond `400` naming the
  limit and store nothing.
- WHEN `session` is missing or blank after trimming, THE SYSTEM SHALL respond
  `400`.

### Upvote — toggle (R2)

- WHEN a caller POSTs `/api/upvotes/:id/votes` with `{session}` for a question
  they have NOT voted on, THE SYSTEM SHALL record the vote and respond `201`
  with `{votes, voted: true}`.
- WHEN the same caller POSTs it again, THE SYSTEM SHALL remove their vote and
  respond `200` with `{votes, voted: false}`.
- WHEN the question id does not exist in that session, THE SYSTEM SHALL respond
  `404`.
- WHEN `session` is missing or blank after trimming, THE SYSTEM SHALL respond
  `400`.

### Read (R3)

- WHEN a caller GETs `/api/upvotes?session=<id>`, THE SYSTEM SHALL return the
  session's questions as `{id, text, votes}`, sorted newest-first.
- WHEN `session` is missing, THE SYSTEM SHALL respond `400`.
- Questions in one session SHALL NOT appear in another's results.

### Board card (R4)

- THE SYSTEM SHALL render a "Questions" card with a text input, a submit
  button, and the newest-first list; each row shows the escaped text, its vote
  count, and an upvote button.
- WHEN an attendee submits with empty/whitespace input, THE SYSTEM SHALL show a
  browser `alert` ("Please type a question before submitting.") and SHALL NOT
  send the request.
- The card SHALL HTML-escape question text.

## Store keys

| pk                  | sk                              | item                             |
| ------------------- | ------------------------------- | -------------------------------- |
| `SESSION#<session>` | `QUESTION#<invTs>#<id>`         | `{ id, text, at }`               |
| `SESSION#<session>` | `VOTE#<questionId>#<callerId>`  | `{ questionId, callerId, at }`   |

`invTs` is a strictly-decreasing, 15-digit zero-padded inverted timestamp
(`10**15 - Date.now()`, then forced strictly below the previous value so
same-millisecond submissions still order correctly). The 15-digit ceiling
keeps every value within `Number.MAX_SAFE_INTEGER`, so no precision loss. Because
`query` returns items sorted by sort key ascending, this yields newest-first
with no extra sort. Putting `callerId` last in the vote key means one vote item
per caller per question; toggling is "does that item exist?" — `get` then `put`
(first tap) or `delete` (second tap). The vote count is derived by counting
`VOTE#<questionId>#*` items, never stored on the question, so a toggle cannot
drift the count.
