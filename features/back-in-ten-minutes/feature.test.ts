import { test } from "node:test";
import assert from "node:assert/strict";
import { Router } from "../../src/spine/router.ts";
import { MemoryStore } from "../../src/spine/store.ts";
import feature from "./feature.ts";

function setup() {
  return new Router([feature], new MemoryStore());
}

const S = "sess-timer";

test("POST with valid duration creates a timer", async () => {
  const r = setup();
  const res = await r.dispatch("POST", "/api/back-in-ten-minutes", { session: S, duration: 10 }, "facilitator");
  assert.equal(res.status, 201);
  const body = res.body as { ok: boolean; endTime: string };
  assert.equal(body.ok, true);
  assert.ok(body.endTime);
});

test("POST with missing session returns 400", async () => {
  const r = setup();
  const res = await r.dispatch("POST", "/api/back-in-ten-minutes", { duration: 5 }, "facilitator");
  assert.equal(res.status, 400);
});

test("POST with duration <= 0 returns 400", async () => {
  const r = setup();
  const res = await r.dispatch("POST", "/api/back-in-ten-minutes", { session: S, duration: 0 }, "facilitator");
  assert.equal(res.status, 400);
  const neg = await r.dispatch("POST", "/api/back-in-ten-minutes", { session: S, duration: -5 }, "facilitator");
  assert.equal(neg.status, 400);
});

test("POST with non-number duration returns 400", async () => {
  const r = setup();
  const res = await r.dispatch("POST", "/api/back-in-ten-minutes", { session: S, duration: "abc" }, "facilitator");
  assert.equal(res.status, 400);
});

test("GET returns running timer with correct status", async () => {
  const r = setup();
  await r.dispatch("POST", "/api/back-in-ten-minutes", { session: S, duration: 10 }, "facilitator");
  const res = await r.dispatch("GET", `/api/back-in-ten-minutes?session=${S}`, undefined, "viewer");
  assert.equal(res.status, 200);
  const timers = res.body as Array<{ status: string; remainingSeconds: number | null }>;
  assert.equal(timers.length, 1);
  assert.equal(timers[0].status, "running");
  assert.ok(typeof timers[0].remainingSeconds === "number");
  assert.ok(timers[0].remainingSeconds! > 0);
});

test("GET returns expired timer", async () => {
  const store = new MemoryStore();
  const r = new Router([feature], store);
  // Manually insert an already-expired timer
  const past = new Date(Date.now() - 60_000).toISOString();
  await store.put(`SESSION#${S}`, `TIMER#${past}`, { endTime: past, createdAt: past });
  const res = await r.dispatch("GET", `/api/back-in-ten-minutes?session=${S}`, undefined, "viewer");
  const timers = res.body as Array<{ status: string; remainingSeconds: number | null }>;
  assert.equal(timers[0].status, "expired");
  assert.equal(timers[0].remainingSeconds, null);
});

test("multiple POSTs create multiple concurrent timers", async () => {
  const r = setup();
  await r.dispatch("POST", "/api/back-in-ten-minutes", { session: S, duration: 5 }, "facilitator");
  await r.dispatch("POST", "/api/back-in-ten-minutes", { session: S, duration: 15 }, "facilitator");
  const res = await r.dispatch("GET", `/api/back-in-ten-minutes?session=${S}`, undefined, "viewer");
  const timers = res.body as Array<{ status: string }>;
  assert.equal(timers.length, 2);
});

test("GET with missing session returns 400", async () => {
  const r = setup();
  const res = await r.dispatch("GET", "/api/back-in-ten-minutes", undefined, "viewer");
  assert.equal(res.status, 400);
});

test("card shows placeholder when no timers set", async () => {
  const store = new MemoryStore();
  const html = await feature.card!("empty-session", store);
  assert.match(html, /Break soon, don't worry!/);
  assert.match(html, /tabla\.post\('\/api\/back-in-ten-minutes'/);
});

test("card shows countdown for running timer", async () => {
  const store = new MemoryStore();
  const r = new Router([feature], store);
  await r.dispatch("POST", "/api/back-in-ten-minutes", { session: S, duration: 10 }, "facilitator");
  const html = await feature.card!(S, store);
  assert.match(html, /left/);
  assert.match(html, /Back at/);
});

test("card shows Time's up! for expired timer", async () => {
  const store = new MemoryStore();
  // Insert a timer that expired 1 minute ago (within the 5-min visibility window)
  const past = new Date(Date.now() - 60_000).toISOString();
  await store.put(`SESSION#${S}`, `TIMER#${past}`, { endTime: past, createdAt: past });
  const html = await feature.card!(S, store);
  assert.match(html, /Time's up!/);
});

test("card hides timers expired more than 5 minutes", async () => {
  const store = new MemoryStore();
  // Insert a timer that expired 6 minutes ago
  const old = new Date(Date.now() - 6 * 60_000).toISOString();
  await store.put(`SESSION#${S}`, `TIMER#${old}`, { endTime: old, createdAt: old });
  const html = await feature.card!(S, store);
  assert.match(html, /Break soon, don't worry!/);
});
