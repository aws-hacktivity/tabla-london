# qr-code

Scan-to-join. The board is on the projector; someone walks in late and
wants on it without typing a 40-character Lambda URL. This card shows a QR
code of the board's own public URL. Point a phone camera at it, tap, done.

It renders as the **first card on the board** (feature cards sort by name,
and `qr-code` sorts before every other current feature), so it sits at the
top of the room's screen where a latecomer looks first.

## Where the URL comes from

Nothing in the runtime hands a feature the board's own public URL - the
Lambda only knows its table name, session, and title (see the Architecture
section of the root README). So the URL is **configuration stored in the
shared table**, set once per session:

- The facilitator POSTs the URL once (curl, or anything that can POST).
- The card reads it back and renders the QR.
- Until it is set, the card shows a one-line setup hint instead of a code.

Latest-wins on a single config key: re-POSTing replaces the URL, so a typo
is a quick fix, not a stuck board.

## Who can set it (the honest answer)

tabla has no auth by design - the board is a public, unauthenticated room
endpoint. So **anyone who can reach the board can set or change this URL.**
That is the same trust model as every other feature (anyone can react,
anyone can post). The mitigation is scope, not permission: the value is
validated to be an `http(s)` URL (a `javascript:` or garbage value is
rejected, so it cannot smuggle script into the card), and the board carries
nothing sensitive. In practice the facilitator sets it once at setup and
nobody touches it again. If that trust model ever needs teeth, it belongs
in the spine, not here.

## Requirements (EARS style)

- WHEN a caller POSTs `/api/qr-code` with `{session, url}` and `url` is a
  valid `http(s)` URL, THE SYSTEM SHALL store it as the session's board URL
  (latest-wins) and respond 200 with the stored URL.
- WHEN a caller POSTs a `url` that is missing or is not an `http(s)` URL,
  THE SYSTEM SHALL respond 400 and store nothing.
- WHEN a caller POSTs without a `session`, THE SYSTEM SHALL respond 400.
- WHEN a caller GETs `/api/qr-code?session=<id>`, THE SYSTEM SHALL return
  `{url}` - the configured URL, or `null` when none is set.
- WHEN the card renders and a URL is set, THE SYSTEM SHALL show a QR code
  encoding exactly that URL, plus the URL as readable text (a fallback for
  anyone who would rather type it, and for when the QR image cannot load).
- WHEN the card renders and no URL is set, THE SYSTEM SHALL show a setup
  hint instead of a code.

## Store keys

| pk                   | sk           | item        |
| -------------------- | ------------ | ----------- |
| `SESSION#<session>`  | `CONFIG#url` | `{url, at}` |

A single fixed sort key (`CONFIG#url`) with plain `put` gives latest-wins:
there is exactly one board URL per session, and the newest write is it.

## How the QR image is produced

No runtime dependency and no existing QR asset in the repo, so the card
delegates rendering to the public QR service `api.qrserver.com`, passing
the board URL as the `data` query parameter. Tradeoffs, stated plainly:

- **Third-party + online:** the phone fetches the QR image from that host.
  The board URL is public by design, so nothing sensitive leaks, but the
  code will not render if that host is blocked or offline. The visible URL
  text below the code is the fallback: worst case, people type it.
- **Alternative considered:** a self-contained pure-TS QR encoder (SVG, no
  network). Rejected for this feature: ~400 lines of Reed-Solomon and bit
  masking is neither "minimal" nor easy to review, and an undetected
  encoder bug produces an unscannable code. The service guarantees a valid,
  scannable code and keeps the payload trivially verifiable (it is right
  there in the `data=` parameter).
