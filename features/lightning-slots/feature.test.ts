import { test } from "node:test";
import assert from "node:assert/strict";
import { Router } from "../../src/spine/router.ts";
import { MemoryStore } from "../../src/spine/store.ts";
import lightning from "./feature.ts";

function setup() {
  return new Router([lightning], new MemoryStore());
}

const S = "sess-1";

interface ClaimBody {
  ok: boolean;
  won: boolean;
  slot: number;
  claimedBy: string | null;
}
interface ReleaseBody {
  ok: boolean;
  released: boolean;
  slot: number;
}
interface SlotView {
  slot: number;
  claimed: boolean;
  claimedBy: string | null;
  mine: boolean;
}

function slots(body: unknown): SlotView[] {
  return (body as { slots: SlotView[] }).slots;
}

test("claim a free slot wins and shows up as claimed", async () => {
  const r = setup();
  const res = await r.dispatch("POST", "/api/lightning-slots/claim", { session: S, slot: 1 }, "alice");
  assert.equal(res.status, 201);
  assert.deepEqual(res.body, { ok: true, won: true, slot: 1, claimedBy: "alice" });

  const board = await r.dispatch("GET", `/api/lightning-slots?session=${S}`, undefined, "alice");
  const s1 = slots(board.body).find((s) => s.slot === 1)!;
  assert.equal(s1.claimed, true);
  assert.equal(s1.claimedBy, "alice");
  assert.equal(s1.mine, true);
});

test("THE RACE: two callers, one slot, exactly one winner and the loser sees who won", async () => {
  const r = setup();
  const a = await r.dispatch("POST", "/api/lightning-slots/claim", { session: S, slot: 3 }, "alice");
  assert.equal(a.status, 201);
  assert.equal((a.body as ClaimBody).won, true);

  const b = await r.dispatch("POST", "/api/lightning-slots/claim", { session: S, slot: 3 }, "bob");
  assert.equal(b.status, 409);
  assert.equal((b.body as ClaimBody).won, false);
  assert.equal((b.body as ClaimBody).claimedBy, "alice"); // loser learns the winner

  // exactly one owner on the board
  const board = await r.dispatch("GET", `/api/lightning-slots?session=${S}`, undefined, "x");
  const s3 = slots(board.body).find((s) => s.slot === 3)!;
  assert.equal(s3.claimedBy, "alice");
});

test("invalid slot values are rejected and nothing is written", async () => {
  const r = setup();
  for (const bad of [0, 6, 2.5, "x", undefined]) {
    const res = await r.dispatch("POST", "/api/lightning-slots/claim", { session: S, slot: bad }, "alice");
    assert.equal(res.status, 400, `slot=${String(bad)} should be 400`);
  }
  const board = await r.dispatch("GET", `/api/lightning-slots?session=${S}`, undefined, "alice");
  assert.equal(slots(board.body).every((s) => !s.claimed), true);
});

test("missing session is a 400 on claim", async () => {
  const r = setup();
  const res = await r.dispatch("POST", "/api/lightning-slots/claim", { slot: 1 }, "alice");
  assert.equal(res.status, 400);
});

test("owner can release, freeing the slot for anyone", async () => {
  const r = setup();
  await r.dispatch("POST", "/api/lightning-slots/claim", { session: S, slot: 2 }, "alice");

  const rel = await r.dispatch("POST", "/api/lightning-slots/release", { session: S, slot: 2 }, "alice");
  assert.equal(rel.status, 200);
  assert.deepEqual(rel.body, { ok: true, released: true, slot: 2 } as ReleaseBody);

  // a third caller can now claim it
  const bob = await r.dispatch("POST", "/api/lightning-slots/claim", { session: S, slot: 2 }, "bob");
  assert.equal(bob.status, 201);
  assert.equal((bob.body as ClaimBody).claimedBy, "bob");
});

test("non-owner cannot release someone else's slot", async () => {
  const r = setup();
  await r.dispatch("POST", "/api/lightning-slots/claim", { session: S, slot: 4 }, "alice");

  const rel = await r.dispatch("POST", "/api/lightning-slots/release", { session: S, slot: 4 }, "mallory");
  assert.equal(rel.status, 403);
  assert.equal((rel.body as ReleaseBody).released, false);

  const board = await r.dispatch("GET", `/api/lightning-slots?session=${S}`, undefined, "x");
  assert.equal(slots(board.body).find((s) => s.slot === 4)!.claimedBy, "alice");
});

test("releasing a free slot is a 403", async () => {
  const r = setup();
  const rel = await r.dispatch("POST", "/api/lightning-slots/release", { session: S, slot: 5 }, "alice");
  assert.equal(rel.status, 403);
  assert.equal((rel.body as ReleaseBody).released, false);
});

test("GET returns five slots in order with per-caller mine and null free slots", async () => {
  const r = setup();
  await r.dispatch("POST", "/api/lightning-slots/claim", { session: S, slot: 1 }, "alice");
  await r.dispatch("POST", "/api/lightning-slots/claim", { session: S, slot: 2 }, "bob");

  const board = await r.dispatch("GET", `/api/lightning-slots?session=${S}`, undefined, "alice");
  const view = slots(board.body);
  assert.deepEqual(view.map((s) => s.slot), [1, 2, 3, 4, 5]);
  assert.equal(view[0]!.mine, true); // alice owns slot 1
  assert.equal(view[1]!.mine, false); // bob owns slot 2, not alice
  assert.deepEqual(view[2], { slot: 3, claimed: false, claimedBy: null, mine: false });
});

test("missing session is a 400 on GET", async () => {
  const r = setup();
  const res = await r.dispatch("GET", "/api/lightning-slots", undefined, "alice");
  assert.equal(res.status, 400);
});

test("whitespace-only session is rejected on all three routes and writes nothing", async () => {
  const r = setup();
  const claim = await r.dispatch("POST", "/api/lightning-slots/claim", { session: "   ", slot: 1 }, "alice");
  assert.equal(claim.status, 400);
  const release = await r.dispatch("POST", "/api/lightning-slots/release", { session: "   ", slot: 1 }, "alice");
  assert.equal(release.status, 400);
  const get = await r.dispatch("GET", "/api/lightning-slots?session=%20%20", undefined, "alice");
  assert.equal(get.status, 400);

  // no orphan partition was created
  const board = await r.dispatch("GET", `/api/lightning-slots?session=${S}`, undefined, "alice");
  assert.equal(slots(board.body).every((s) => !s.claimed), true);
});

test("session is trimmed so padded and clean ids address the same partition", async () => {
  const r = setup();
  await r.dispatch("POST", "/api/lightning-slots/claim", { session: "  pad  ", slot: 1 }, "alice");
  const board = await r.dispatch("GET", "/api/lightning-slots?session=pad", undefined, "alice");
  assert.equal(slots(board.body).find((s) => s.slot === 1)!.claimedBy, "alice");
});

test("card HTML-escapes the owner id so a markup caller id cannot inject", async () => {
  const store = new MemoryStore();
  const r = new Router([lightning], store);
  await r.dispatch("POST", "/api/lightning-slots/claim", { session: S, slot: 1 }, "<b>x");
  const html = await lightning.card!(S, store);
  assert.doesNotMatch(html, /Slot 1 - <b>/); // raw markup must not appear
  assert.match(html, /&lt;b&gt;/); // escaped form is present
});

test("card renders claim buttons for free slots and release for taken ones", async () => {
  const store = new MemoryStore();
  const r = new Router([lightning], store);
  await r.dispatch("POST", "/api/lightning-slots/claim", { session: S, slot: 1 }, "alice");
  const html = await lightning.card!(S, store);
  assert.match(html, /tabla\.post\('\/api\/lightning-slots\/claim'/); // free slots
  assert.match(html, /tabla\.post\('\/api\/lightning-slots\/release'/); // taken slot 1
  assert.match(html, /Slot 1 - alic/); // owner shown (short id)
});

test("sessions are isolated", async () => {
  const r = setup();
  await r.dispatch("POST", "/api/lightning-slots/claim", { session: "one", slot: 1 }, "alice");
  const other = await r.dispatch("GET", "/api/lightning-slots?session=two", undefined, "alice");
  assert.equal(slots(other.body).every((s) => !s.claimed), true);
});
