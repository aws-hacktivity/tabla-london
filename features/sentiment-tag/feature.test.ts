import { test } from "node:test";
import assert from "node:assert/strict";
import { Router } from "../../src/spine/router.ts";
import { MemoryStore } from "../../src/spine/store.ts";
import sentimentTag, { score } from "./feature.ts";

function setup() {
  return new Router([sentimentTag], new MemoryStore());
}

const S = "sess-1";

// ─── Scorer unit tests ───────────────────────────────────────────────────────

test("score: 'good' → +1, 🙂", () => {
  const r = score("good");
  assert.equal(r.score, 1);
  assert.equal(r.face, "🙂");
});

test("score: 'bad' → -1, 🙁", () => {
  const r = score("bad");
  assert.equal(r.score, -1);
  assert.equal(r.face, "🙁");
});

test("score: 'okay' → 0, 😐", () => {
  const r = score("okay");
  assert.equal(r.score, 0);
  assert.equal(r.face, "😐");
});

test("score: 'not good' → -1, 🙁 (negation flips positive)", () => {
  const r = score("not good");
  assert.equal(r.score, -1);
  assert.equal(r.face, "🙁");
});

test("score: 'not bad' → +1, 🙂 (negation flips negative)", () => {
  const r = score("not bad");
  assert.equal(r.score, 1);
  assert.equal(r.face, "🙂");
});

test("score: 'good and bad' → 0, 😐 (cancel out)", () => {
  const r = score("good and bad");
  assert.equal(r.score, 0);
  assert.equal(r.face, "😐");
});

test("score: unknown words only → 0, 😐", () => {
  const r = score("the cat sat on a mat");
  assert.equal(r.score, 0);
  assert.equal(r.face, "😐");
});

test("score: empty string → 0, 😐", () => {
  const r = score("");
  assert.equal(r.score, 0);
  assert.equal(r.face, "😐");
});

test("score: punctuation is stripped before matching", () => {
  const r = score("good!!");
  assert.equal(r.score, 1);
  assert.equal(r.face, "🙂");
});

test("score: negation window is 1 word only", () => {
  // "not" negates "very" (not a sentiment word → no effect), "good" is un-negated
  const r = score("not very good");
  assert.equal(r.score, 1);
  assert.equal(r.face, "🙂");
});

test("score: multiple sentiment words accumulate", () => {
  const r = score("great and amazing and wonderful");
  assert.equal(r.score, 3);
  assert.equal(r.face, "🙂");
});

test("score: case insensitive", () => {
  const r = score("GOOD");
  assert.equal(r.score, 1);
  assert.equal(r.face, "🙂");
});

test("score: punctuation-separated words tokenize independently", () => {
  const r = score("good,bad");
  assert.equal(r.score, 0);
  assert.equal(r.face, "😐");
});

// ─── Route integration tests ─────────────────────────────────────────────────

test("POST valid text → 201 with correct face", async () => {
  const r = setup();
  const res = await r.dispatch("POST", "/api/sentiment-tag", { session: S, text: "this is great" }, "alice");
  assert.equal(res.status, 201);
  const body = res.body as Record<string, unknown>;
  assert.equal(body["face"], "🙂");
  assert.equal(body["score"], 1);
  assert.equal(body["text"], "this is great");
  assert.ok(body["at"]);
});

test("POST empty text → 400", async () => {
  const r = setup();
  const res = await r.dispatch("POST", "/api/sentiment-tag", { session: S, text: "" }, "alice");
  assert.equal(res.status, 400);
});

test("POST text > 280 chars → 400", async () => {
  const r = setup();
  const longText = "a".repeat(281);
  const res = await r.dispatch("POST", "/api/sentiment-tag", { session: S, text: longText }, "alice");
  assert.equal(res.status, 400);
});

test("POST missing session → 400", async () => {
  const r = setup();
  const res = await r.dispatch("POST", "/api/sentiment-tag", { text: "hello" }, "alice");
  assert.equal(res.status, 400);
});

test("POST whitespace-only session → 400", async () => {
  const r = setup();
  const res = await r.dispatch("POST", "/api/sentiment-tag", { session: "   ", text: "hello" }, "alice");
  assert.equal(res.status, 400);
});

test("GET whitespace-only session → 400", async () => {
  const r = setup();
  const res = await r.dispatch("GET", "/api/sentiment-tag?session=%20%20", undefined, "alice");
  assert.equal(res.status, 400);
});

test("GET with entries → returns newest-first array", async () => {
  const r = setup();
  await r.dispatch("POST", "/api/sentiment-tag", { session: S, text: "bad day" }, "alice");
  await r.dispatch("POST", "/api/sentiment-tag", { session: S, text: "good day" }, "bob");

  const res = await r.dispatch("GET", `/api/sentiment-tag?session=${S}`, undefined, "carol");
  assert.equal(res.status, 200);
  const items = res.body as Record<string, unknown>[];
  assert.equal(items.length, 2);
  // newest first: "good day" was submitted second
  assert.equal(items[0]["text"], "good day");
  assert.equal(items[1]["text"], "bad day");
});

test("GET missing session → 400", async () => {
  const r = setup();
  const res = await r.dispatch("GET", "/api/sentiment-tag", undefined, "alice");
  assert.equal(res.status, 400);
});

test("card renders mood bar and tabla.post", async () => {
  const store = new MemoryStore();
  const r = new Router([sentimentTag], store);
  await r.dispatch("POST", "/api/sentiment-tag", { session: S, text: "amazing" }, "alice");
  const html = await sentimentTag.card!(S, store);
  assert.match(html, /Sentiment Pulse/);
  assert.match(html, /tabla\.post\('\/api\/sentiment-tag'/);
  assert.match(html, /🙂 1/);
});
