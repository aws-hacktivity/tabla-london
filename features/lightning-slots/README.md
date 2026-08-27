# lightning-slots

Five lightning-talk slots, first come first served. Thirty phones tap
"claim" at once; exactly five people win, exactly one per slot, and the
losers see who beat them instantly. The store decides the winner, not
whoever shouts first.

## The race, and the verb that wins it

Two phones POST a claim for slot 3 in the same millisecond. Exactly one
must win, as a guarantee, not a hope.

The slot number is the **sort key** and the claim is written with
**`putIfAbsent`**. The first write to `SLOT#3` returns `true` (that caller
owns it); every later write to `SLOT#3` returns `false` (someone else got
there first). In production this is a DynamoDB conditional `PutItem`
(`attribute_not_exists(sk)`) evaluated inside the single-item write, so two
concurrent claims on one slot cannot both succeed.

This is the inverse of reactions: reactions puts the caller id IN the sort
key to get one-per-person; here the slot number is the key and the caller
id is the item VALUE, so the key is contended on purpose and exactly one
caller can own it. `put` would be last-writer-wins - two owners - so it is
the wrong verb.

## Requirements (EARS style)

- WHEN a caller POSTs `/api/lightning-slots/claim` with `{session, slot}`
  (slot an integer 1-5) and the slot is free, THE SYSTEM SHALL award it to
  that caller and respond `201 {ok:true, won:true, slot, claimedBy}`.
- WHEN a caller claims an already-claimed slot (including losing the race),
  THE SYSTEM SHALL leave the claim untouched and respond
  `409 {ok:true, won:false, slot, claimedBy:<winner>}` so the loser learns
  who beat them in the same response.
- WHEN two or more callers claim one free slot concurrently, THE SYSTEM
  SHALL award it to exactly one; all others get the 409 loser response.
- WHEN `session` is missing/non-string, THE SYSTEM SHALL respond `400` and
  record nothing.
- WHEN `slot` is missing, non-integer, or outside 1-5, THE SYSTEM SHALL
  respond `400 {error:"slot must be an integer 1-5"}` and record nothing.
- WHEN a caller POSTs `/api/lightning-slots/release` with `{session, slot}`
  and owns that slot, THE SYSTEM SHALL free it and respond
  `200 {ok:true, released:true, slot}`.
- WHEN a caller releases a slot they do NOT own (someone else's, or free),
  THE SYSTEM SHALL change nothing and respond `403 {ok:true, released:false,
  slot}`. Only the owner can release their own slot.
- WHEN a caller GETs `/api/lightning-slots?session=<id>`, THE SYSTEM SHALL
  return all five slots in order:
  `{slots:[{slot, claimed, claimedBy, mine}, ...]}` where `mine` is true for
  the requester's own slots and free slots report `claimed:false,
  claimedBy:null`.

## Store keys

| pk                  | sk         | item                    |
| ------------------- | ---------- | ----------------------- |
| `SESSION#<session>` | `SLOT#<n>` | `{slot, callerId, at}`  |

`n` is 1-5. A free slot is the ABSENCE of its `SLOT#<n>` item; release is a
`delete`. Ownership lives in the item value, and the contended slot-keyed
`putIfAbsent` is what makes first-come-first-served a database guarantee.

## What the loser sees

The claim POST returns `409` with `claimedBy` = the winner's caller id in
the same round trip, and the board card (re-rendered every few seconds)
shows that same winner on the slot. Nothing to argue about: the store
already decided, and both the response and the shared board agree.

## The card

Server-rendered for the projector board, so it has no per-viewer
`callerId`. Free slots show a Claim button; taken slots show the owner's
short id and a Release button. The `/release` route's owner-only check is
the real guard, so a non-owner tapping Release just gets a harmless 403.
Uses `window.tabla.post()` exactly as the reactions card does.
