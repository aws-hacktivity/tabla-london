import type { Feature, Store } from "../../src/spine/types.ts";

/**
 * lightning-slots - claim one of five lightning-talk slots, first come
 * first served, enforced by the store rather than by shouting.
 *
 * Key strategy is the INVERSE of reactions. reactions wants one-per-person,
 * so it puts the caller id in the sort key. This feature wants one-per-SLOT
 * awarded to the first caller, so the slot number is the sort key and the
 * caller id is the item VALUE:
 *
 *   pk = SESSION#<sessionId>
 *   sk = SLOT#<n>              (n = 1..5)
 *   item = { slot, callerId, at }
 *
 * The claim is a single store.putIfAbsent on that shared, deliberately
 * contended SLOT#<n> key. Exactly one concurrent write returns true (the
 * winner); every other returns false (the loser). In production this is a
 * DynamoDB conditional PutItem (attribute_not_exists(sk)) evaluated inside
 * the write, so two phones tapping in the same millisecond cannot both win.
 * That is what turns first-come-first-served from a convention into a
 * database invariant. plain `put` would be last-writer-wins and produce
 * two owners - wrong verb.
 *
 * A free slot is simply the ABSENCE of a SLOT#<n> item; release is a delete.
 */

const SLOT_COUNT = 5;
const SESSION = (id: string) => `SESSION#${id}`;
const SLOT = (n: number) => `SLOT#${n}`;

interface SlotView {
  slot: number;
  claimed: boolean;
  claimedBy: string | null;
  mine: boolean;
}

/** Integer in 1..SLOT_COUNT, or null for anything else. */
function parseSlot(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isInteger(raw)) return null;
  if (raw < 1 || raw > SLOT_COUNT) return null;
  return raw;
}

/** Short, projector-friendly form of the anonymous caller id. */
function short(callerId: string): string {
  return callerId.slice(0, 4);
}

/** HTML-escape a string before it is interpolated into rendered markup. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The trimmed session id, or null when the raw value is absent, not a
 * string, or empty/whitespace-only after trimming. Rejecting whitespace
 * here stops a mistyped `"   "` from forking the board into an orphan
 * `SESSION#   ` partition that no legitimate GET will ever read.
 */
function trimmedSession(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The five slots in order, with ownership. Shared by the GET route and the
 * card so the two can never drift. `mine` is meaningful only when a real
 * per-viewer callerId is passed (the board card has none - see `card`).
 */
async function slotState(
  sessionId: string,
  callerId: string | null,
  store: Store,
): Promise<SlotView[]> {
  const items = await store.query(SESSION(sessionId), "SLOT#");
  const owners = new Map<number, string>();
  for (const item of items) {
    const slot = item["slot"];
    const owner = item["callerId"];
    if (typeof slot === "number" && typeof owner === "string") {
      owners.set(slot, owner);
    }
  }
  const result: SlotView[] = [];
  for (let n = 1; n <= SLOT_COUNT; n += 1) {
    const owner = owners.get(n) ?? null;
    result.push({
      slot: n,
      claimed: owner !== null,
      claimedBy: owner,
      mine: owner !== null && owner === callerId,
    });
  }
  return result;
}

const feature: Feature = {
  name: "lightning-slots",
  description: "Claim one of five lightning-talk slots - first come, first served.",
  routes: [
    {
      method: "POST",
      path: "/claim",
      handler: async (req, store) => {
        const body = req.body as { session?: string; slot?: unknown } | undefined;
        const sessionId = trimmedSession(body?.session);
        if (sessionId === null) {
          return { status: 400, body: { error: "missing session" } };
        }
        const slot = parseSlot(body?.slot);
        if (slot === null) {
          return { status: 400, body: { error: "slot must be an integer 1-5" } };
        }
        const won = await store.putIfAbsent(SESSION(sessionId), SLOT(slot), {
          slot,
          callerId: req.callerId,
          at: new Date().toISOString(),
        });
        if (won) {
          return {
            status: 201,
            body: { ok: true, won: true, slot, claimedBy: req.callerId },
          };
        }
        // Lost the race - tell the loser who beat them, in the same round trip.
        const existing = await store.get(SESSION(sessionId), SLOT(slot));
        const claimedBy = (existing?.["callerId"] as string | undefined) ?? null;
        return {
          status: 409,
          body: { ok: true, won: false, slot, claimedBy },
        };
      },
    },
    {
      method: "POST",
      path: "/release",
      handler: async (req, store) => {
        const body = req.body as { session?: string; slot?: unknown } | undefined;
        const sessionId = trimmedSession(body?.session);
        if (sessionId === null) {
          return { status: 400, body: { error: "missing session" } };
        }
        const slot = parseSlot(body?.slot);
        if (slot === null) {
          return { status: 400, body: { error: "slot must be an integer 1-5" } };
        }
        const existing = await store.get(SESSION(sessionId), SLOT(slot));
        const owner = existing?.["callerId"] as string | undefined;
        // Only the current owner may release. Non-owner and free-slot both 403.
        if (owner !== undefined && owner === req.callerId) {
          await store.delete(SESSION(sessionId), SLOT(slot));
          return { status: 200, body: { ok: true, released: true, slot } };
        }
        return { status: 403, body: { ok: true, released: false, slot } };
      },
    },
    {
      method: "GET",
      path: "/",
      handler: async (req, store) => {
        const sessionId = trimmedSession(req.query["session"]);
        if (sessionId === null) {
          return { status: 400, body: { error: "missing ?session=" } };
        }
        return {
          status: 200,
          body: { slots: await slotState(sessionId, req.callerId, store) },
        };
      },
    },
  ],
  card: async (sessionId, store) => {
    // The card is server-rendered for the projector board and has no
    // per-viewer callerId, so it cannot compute a true `mine`. Every taken
    // slot shows its owner (short id) and offers a Release control; the
    // /release route's owner-only check is the real guard, so a non-owner
    // tap just gets a harmless 403.
    const slots = await slotState(sessionId, null, store);
    const rows = slots
      .map((s) => {
        if (!s.claimed) {
          return (
            `<li class="slot slot-free">` +
            `<span>Slot ${s.slot}</span>` +
            `<button class="react" onclick="tabla.post('/api/lightning-slots/claim',{session:tabla.session,slot:${s.slot}})">Claim slot ${s.slot}</button>` +
            `</li>`
          );
        }
        return (
          `<li class="slot slot-taken">` +
          `<span>Slot ${s.slot} - ${esc(short(s.claimedBy as string))}</span>` +
          `<button class="react" onclick="tabla.post('/api/lightning-slots/release',{session:tabla.session,slot:${s.slot}})">Release</button>` +
          `</li>`
        );
      })
      .join("");
    return `<section class="card"><h2>Lightning slots</h2><ul class="slot-list">${rows}</ul></section>`;
  },
};

export default feature;
