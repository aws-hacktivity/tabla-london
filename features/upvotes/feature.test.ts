import { test } from "node:test";
import assert from "node:assert/strict";
import { Router } from "../../src/spine/router.ts";
import { MemoryStore } from "../../src/spine/store.ts";
import upvotes from "./feature.ts";

function setup() {
  return new Router([upvotes], new MemoryStore());
}

const S = "sess-1";

async function submit(r: Router, session: string, text: string, caller = "alice") {
  return r.dispatch("POST", "/api/upvotes", { session, text }, caller);
}

test("submitting a valid question returns 201 and it appears in the list", async () => {
  const r = setup();
  const post = await submit(r, S, "How does the spine discover features?");
  assert.equal(post.status, 201);
  const body = post.body as { id: string; text: string; votes: number };
  assert.match(body.id, /^q_[0-9a-f]{12}$/);
  assert.equal(body.votes, 0);

  const get = await r.dispatch("GET", `/api/upvotes?session=${S}`, undefined, "x");
  const list = get.body as { id: string; text: string; votes: number }[];
  assert.equal(list.length, 1);
  assert.equal(list[0]!.id, body.id);
});

test("word limit: 150 words accepted, 151 rejected and not stored", async () => {
  const r = setup();
  const at150 = Array.from({ length: 150 }, (_, i) => `w${i}`).join(" ");
  const at151 = Array.from({ length: 151 }, (_, i) => `w${i}`).join(" ");

  const ok = await submit(r, S, at150);
  assert.equal(ok.status, 201);

  const tooLong = await submit(r, S, at151);
  assert.equal(tooLong.status, 400);

  const get = await r.dispatch("GET", `/api/upvotes?session=${S}`, undefined, "x");
  assert.equal((get.body as unknown[]).length, 1); // only the 150-word one stored
});

test("blank or whitespace-only text is rejected 400 and stores nothing", async () => {
  const store = new MemoryStore();
  const r = new Router([upvotes], store);
  assert.equal((await submit(r, S, "")).status, 400);
  assert.equal((await submit(r, S, "   \t  ")).status, 400);
  assert.deepEqual(await store.query(`SESSION#${S}`, "QUESTION#"), []);
});

test("missing session is a 400 on submit, list, and vote", async () => {
  const r = setup();
  assert.equal((await r.dispatch("POST", "/api/upvotes", { text: "hi" }, "a")).status, 400);
  assert.equal((await r.dispatch("GET", "/api/upvotes", undefined, "a")).status, 400);
  assert.equal(
    (await r.dispatch("POST", "/api/upvotes/q_whatever/votes", {}, "a")).status,
    400,
  );
});

test("toggle: same caller votes then un-votes; a second caller adds one", async () => {
  const r = setup();
  const { id } = (await submit(r, S, "Toggle me")).body as { id: string };

  const on = await r.dispatch("POST", `/api/upvotes/${id}/votes`, { session: S }, "alice");
  assert.equal(on.status, 201);
  assert.deepEqual(on.body, { votes: 1, voted: true });

  const off = await r.dispatch("POST", `/api/upvotes/${id}/votes`, { session: S }, "alice");
  assert.equal(off.status, 200);
  assert.deepEqual(off.body, { votes: 0, voted: false });

  const bob = await r.dispatch("POST", `/api/upvotes/${id}/votes`, { session: S }, "bob");
  assert.equal(bob.status, 201);
  assert.deepEqual(bob.body, { votes: 1, voted: true });
});

test("two distinct callers each count once", async () => {
  const r = setup();
  const { id } = (await submit(r, S, "Count us")).body as { id: string };
  await r.dispatch("POST", `/api/upvotes/${id}/votes`, { session: S }, "alice");
  const second = await r.dispatch("POST", `/api/upvotes/${id}/votes`, { session: S }, "bob");
  assert.equal((second.body as { votes: number }).votes, 2);
});

test("voting on a non-existent question is a 404", async () => {
  const r = setup();
  const res = await r.dispatch("POST", "/api/upvotes/q_nope/votes", { session: S }, "alice");
  assert.equal(res.status, 404);
});

test("list is newest-first, even for same-millisecond submissions", async () => {
  const r = setup();
  // No delay: monotonic invTs must order these by submission order regardless
  // of whether Date.now() advanced between them.
  const first = (await submit(r, S, "first")).body as { id: string };
  const second = (await submit(r, S, "second")).body as { id: string };
  const third = (await submit(r, S, "third")).body as { id: string };

  const get = await r.dispatch("GET", `/api/upvotes?session=${S}`, undefined, "x");
  const list = get.body as { id: string }[];
  assert.deepEqual([list[0]!.id, list[1]!.id, list[2]!.id], [third.id, second.id, first.id]);
});

test("sessions are isolated", async () => {
  const r = setup();
  await submit(r, "one", "only in one");
  const other = await r.dispatch("GET", "/api/upvotes?session=two", undefined, "x");
  assert.deepEqual(other.body, []);
});

test("whitespace-only session is a 400 on submit, list, and vote and stores nothing", async () => {
  const store = new MemoryStore();
  const r = new Router([upvotes], store);
  const WS = "   ";
  assert.equal((await r.dispatch("POST", "/api/upvotes", { session: WS, text: "hi" }, "a")).status, 400);
  // GET carries the whitespace url-encoded so it survives to the handler.
  assert.equal((await r.dispatch("GET", "/api/upvotes?session=%20%20%20", undefined, "a")).status, 400);
  assert.equal(
    (await r.dispatch("POST", "/api/upvotes/q_whatever/votes", { session: WS }, "a")).status,
    400,
  );
  // No junk partition was minted under the untrimmed whitespace key.
  assert.deepEqual(await store.query(`SESSION#${WS}`, "QUESTION#"), []);
});

test("card renders input, add button, upvote buttons with counts, and escapes text", async () => {
  const store = new MemoryStore();
  const r = new Router([upvotes], store);
  const { id } = (await submit(r, S, '<b>x&y</b> "q"')).body as { id: string };
  await r.dispatch("POST", `/api/upvotes/${id}/votes`, { session: S }, "alice");

  const html = await upvotes.card!(S, store);
  assert.match(html, /id="upv-text"/); // text input
  assert.match(html, />Add question<\/button>/); // submit button
  assert.match(html, new RegExp(`/api/upvotes/${id}/votes`)); // upvote button target
  assert.match(html, /class="upvote-count">1</); // count reflects the vote
  assert.match(html, /&lt;b&gt;x&amp;y&lt;\/b&gt; &quot;q&quot;/); // <,>,&," all escaped
  assert.doesNotMatch(html, /<b>x&y<\/b>/); // raw markup never present
  assert.match(html, /Please type a question before submitting\./); // empty-guard
});

test("empty-guard alert is present and card does not post empty text", async () => {
  const store = new MemoryStore();
  const html = await upvotes.card!(S, store);
  // The submit handler alerts and returns before calling tabla.post on empty.
  assert.match(html, /if\(!v\)\{alert\(/);
});
