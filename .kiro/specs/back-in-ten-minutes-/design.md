# Back in Ten Minutes — Design

## Feature directory

```
features/back-in-ten-minutes/
  feature.ts          # Feature export: routes + card
  feature.test.ts     # Tests driven through the Router
  README.md           # This spec (requirements + store keys)
```

## Store layout

All timers live in the shared DynamoDB single-table under one session
partition. Each timer gets a unique sort key using an ISO timestamp as
its discriminator (guarantees ordering and uniqueness).

| pk                  | sk                                      | item                          |
| ------------------- | --------------------------------------- | ----------------------------- |
| `SESSION#<session>` | `TIMER#<ISO-timestamp-of-creation>`     | `{ endTime, createdAt }`      |

- **pk** follows the repo convention: `SESSION#<sessionId>`.
- **sk** uses prefix `TIMER#` followed by the creation timestamp (ISO
  8601, e.g. `TIMER#2026-08-27T14:05:00.000Z`). This makes `query` by
  prefix return all timers for the session, sorted by creation time.
- **item** stores `endTime` (ISO string — the moment the timer expires)
  and `createdAt` (same as the sk discriminator, for convenience).

### Store verb choice

- `store.put(pk, sk, item)` — plain put, no idempotency guard. Each POST
  creates a new timer; there is no per-caller uniqueness constraint (the
  facilitator may set multiple timers). `put` is correct because:
  - The sk includes a timestamp, so two POSTs a millisecond apart get
    different keys — no collision risk.
  - We intentionally allow duplicates (concurrent timers).

### Why not `putIfAbsent`?

`putIfAbsent` would make sense if we wanted one-timer-per-person (like
reactions). Here, the facilitator is allowed to stack timers, so we use
plain `put` with a unique sk each time.

## Routes

### POST `/api/back-in-ten-minutes`

**Purpose:** Create a new timer.

**Request body:** `{ "session": string, "duration": number }`

**Logic:**
1. Validate `session` is a non-empty string → 400 if missing.
2. Validate `duration` is a number > 0 → 400 if not.
3. Compute `endTime = new Date(Date.now() + duration * 60_000)`.
4. Compute `createdAt = new Date().toISOString()`.
5. `store.put(pk, sk, { endTime: endTime.toISOString(), createdAt })`.
6. Return `201` with `{ ok: true, endTime }`.

### GET `/api/back-in-ten-minutes`

**Purpose:** Return all timers for a session with their status.

**Query params:** `?session=<id>`

**Logic:**
1. Validate `session` query param → 400 if missing.
2. `store.query(pk, "TIMER#")` → all timer items.
3. For each item, compute status:
   - `now < endTime` → `"running"`, `remainingSeconds = Math.ceil((endTime - now) / 1000)`
   - `now >= endTime` → `"expired"`, `remainingSeconds = null`
4. Return `200` with the array.

## Card rendering

The `card` function receives `sessionId` and `store`, queries all timers,
and returns an HTML fragment.

**Algorithm:**
1. Query all timers: `store.query(SESSION(sessionId), "TIMER#")`.
2. Compute `now = Date.now()`.
3. Filter: keep timers where either:
   - `now < endTime` (still running), OR
   - `now >= endTime` AND `now - endTime < 5 * 60_000` (expired < 5 min)
4. If no timers survive the filter → return the placeholder card:
   `"Break soon, don't worry!"`
5. Otherwise, for each surviving timer:
   - Running → `"Break — back at HH:MM (N min left)"`
   - Expired → `"Time's up!"`
6. Stack the lines vertically in the card HTML.

**Time formatting:** `HH:MM` is the end time in the server's locale
(UTC in Lambda). Minutes remaining is `Math.ceil(remainingMs / 60_000)`.

## Card HTML structure

```html
<section class="card">
  <h2>Break Timer</h2>
  <div class="timer-stack">
    <p>Break — back at 14:05 (3 min left)</p>
    <p>Time's up!</p>
  </div>
</section>
```

Or, when empty:

```html
<section class="card">
  <h2>Break Timer</h2>
  <p>Break soon, don't worry!</p>
</section>
```

## Cleanup of stale timers

Expired timers older than 5 minutes are NOT deleted from the store —
they are simply filtered out at render time. This keeps the write path
simple (no background cleanup needed) and the store is scoped to one
session anyway (short-lived workshop data).

## Error responses

| Condition | Status | Body |
|-----------|--------|------|
| Missing/empty `session` | 400 | `{ "error": "missing session" }` |
| `duration` not a number or ≤ 0 | 400 | `{ "error": "duration must be a positive number" }` |

## Dependencies

None beyond the spine contract (`Feature`, `Store`, `TablaRequest`,
`TablaResponse` from `src/spine/types.ts`). No external packages.
