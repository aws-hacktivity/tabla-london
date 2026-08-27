# Back in Ten Minutes — Requirements

## Overview

A break timer for the board. The facilitator sets a break duration once;
every phone and the projector show the same countdown ("Break — back at
14:05 (3 min left)"). When time is up the card says so. Multiple timers
can run concurrently — the card stacks them all.

## Actors

| Actor        | Description                                      |
| ------------ | ------------------------------------------------ |
| Facilitator  | The person running the session — sets timers      |
| Participant  | Anyone in the room viewing the board              |

## Requirements (EARS style)

### Setting a timer

- REQ-1: WHEN a caller POSTs `/api/back-in-ten-minutes` with
  `{ "session": "<id>", "duration": <minutes> }` and `duration` is a
  positive number, THE SYSTEM SHALL record a new timer with an `endTime`
  computed as now + duration minutes and respond `201`.

- REQ-2: WHEN a caller POSTs with `duration` that is not a number or is
  ≤ 0, THE SYSTEM SHALL respond `400` with an error message and store
  nothing.

- REQ-3: WHEN a caller POSTs with a missing or empty `session`, THE
  SYSTEM SHALL respond `400`.

- REQ-4: WHEN one or more timers are already running for the session and
  a new valid POST arrives, THE SYSTEM SHALL add the new timer alongside
  the existing ones (concurrent timers allowed).

### Reading timer state

- REQ-5: WHEN a caller GETs `/api/back-in-ten-minutes?session=<id>`, THE
  SYSTEM SHALL return all timers for the session as an array, each with:
  `{ "endTime": <ISO string>, "status": "running" | "expired",
  "remainingSeconds": <number or null> }`.

### Board card display

- REQ-6: WHEN no timer has been set for the session, the card SHALL show:
  **"Break soon, don't worry!"**

- REQ-7: WHEN one or more timers exist, the card SHALL show all of them
  stacked vertically. Each running timer shows:
  **"Break — back at HH:MM (N min left)"** where HH:MM is the end time
  and N is the whole minutes remaining (rounded up).

- REQ-8: WHEN a timer has expired (now ≥ endTime), its line on the card
  SHALL change to: **"Time's up!"** and remain visible.

- REQ-9: WHEN all timers have been expired for more than 5 minutes, the
  card SHALL return to showing **"Break soon, don't worry!"**.

### Non-functional

- REQ-10: The card does NOT tick every second. It re-renders server-side
  every few seconds, and that cadence is sufficient.

- REQ-11: No authentication — any caller can set a timer. This matches
  the room's trust model (shared URL, shared board).

- REQ-12: There is no upper limit on duration. The facilitator may set a
  timer for any positive number of minutes.

## Design decisions (confirmed)

| # | Question | Answer | Rationale |
|---|----------|--------|-----------|
| 1 | Duration or end time in the request? | **Duration in minutes** | Simpler for the facilitator; server computes end time from its own clock so all cards agree. |
| 2 | New timer while one is running? | **Allow multiple concurrent** | The facilitator may set several breaks or checkpoints; stacking them on the card gives everyone full visibility. |
| 3 | What shows before any timer? | **"Break soon, don't worry!"** | Friendly placeholder that reassures the room. |
| 4 | Card layout with multiple timers? | **Stacked vertically** | Each timer gets its own line showing either countdown or "Time's up!". |
| 5 | Expired timer behavior? | **Stay visible as "Time's up!"** | Clears after all timers expired 5+ minutes, then card reverts to placeholder. |
