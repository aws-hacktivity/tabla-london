# voting

Rate the current session from 1 to 5. Each caller's first vote is permanent.
The board card shows the crowd's average rating and the number of voters behind
it.

## Emoji scale

| Score | Emoji |
|------:|:-----:|
| 1 | 😡 |
| 2 | 😕 |
| 3 | 😐 |
| 4 | 🙂 |
| 5 | 🤩 |

## Requirements (EARS style)

- WHEN a caller POSTs `/api/voting` with `{ session, score }`, where `session`
  is a non-empty string and `score` is an integer from 1 through 5, THE SYSTEM
  SHALL record exactly one vote for that caller in that session and respond
  201 with `{ ok: true, counted: true }` for the first vote.
- WHEN a caller who has already voted in a session POSTs another valid score,
  THE SYSTEM SHALL preserve the original vote and respond 200 with
  `{ ok: true, counted: false }`.
- WHEN a caller POSTs with a missing or empty session, or a score that is not
  an integer from 1 through 5, THE SYSTEM SHALL respond 400 and record nothing.
- WHEN a caller GETs `/api/voting?session=<id>` with a non-empty session, THE
  SYSTEM SHALL return `{ average, count }`, where `average` is the arithmetic
  mean rounded to one decimal place and `count` is the number of distinct
  voters. With no votes, THE SYSTEM SHALL return
  `{ average: 0, count: 0 }`.
- WHEN a caller GETs `/api/voting` without a non-empty session, THE SYSTEM
  SHALL respond 400.
- THE SYSTEM SHALL render a board card with five emoji buttons in score order.
  Each button SHALL submit through `window.tabla.post()`. Before any votes the
  card SHALL show `No votes yet`; afterward it SHALL show the nearest-score
  emoji, the average to one decimal place, and the total vote count.
- Votes stored in one session MUST NOT affect another session's aggregate.

## API

### Submit a vote

```http
POST /api/voting
Content-Type: application/json

{"session":"session-id","score":5}
```

| Outcome | Status | Body |
|---|---:|---|
| First valid vote | 201 | `{ "ok": true, "counted": true }` |
| Caller already voted | 200 | `{ "ok": true, "counted": false }` |
| Invalid session or score | 400 | Error object |

A successful repeat request is idempotent: it acknowledges that the caller was
already counted but never changes the stored score.

### Read the aggregate

```http
GET /api/voting?session=session-id
```

```json
{
  "average": 4.2,
  "count": 40
}
```

The average includes only one score per caller and is rounded to one decimal
place.

## Store keys

| pk | sk | item |
|---|---|---|
| `SESSION#<sessionId>` | `VOTE#<callerId>` | `{ score, at }` |

The stable anonymous caller ID is part of the sort key, so each caller has only
one possible vote record within a session. The POST route uses `putIfAbsent`
rather than `put`: DynamoDB or the local memory store creates the record only
when that exact partition/sort-key pair does not exist. Concurrent or repeated
submissions therefore cannot overwrite the first score or create a second vote.
A different session ID produces a different partition key, keeping sessions
isolated.
