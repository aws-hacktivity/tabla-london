import { test } from "node:test";
import assert from "node:assert/strict";
import { Router } from "../../src/spine/router.ts";
import { MemoryStore } from "../../src/spine/store.ts";
import breakTimer from "./feature.ts";

function setup() {
  return new Router([breakTimer], new MemoryStore());
}

const S = "sess-1";

/** Returns an ISO timestamp `minutesFromNow` minutes in the future. */
function inMinutes(minutesFromNow: number): string {
  return new Date(Date.now() + minutesFromNow * 60 * 1000).toISOString();
}

test("POST sets a timer and GET returns it in running state", async () => {
  const r = setup();
  const endsAt = inMinutes(10);
  const post = await r.dispatch("POST", "/api/break-timer", { session: S, endsAt }, "facilitator");
  assert.equal(post.status, 200);
  assert.equal((post.body as { status: string }).status, "running");
  assert.equal((post.body as { endsAt: string }).endsAt, endsAt);

  const get = await r.dispatch("GET", `/api/break-timer?session=${S}`, undefined, "alice");
  assert.equal(get.status, 200);
  assert.equal((get.body as { status: string }).status, "running");
  assert.equal((get.body as { endsAt: string }).endsAt, endsAt);
  assert.ok((get.body as { minutesLeft: number }).minutesLeft > 0);
});

test("POST with invalid endsAt (not ISO-8601) returns 400", async () => {
  const r = setup();
  const res = await r.dispatch("POST", "/api/break-timer", { session: S, endsAt: "not-a-date" }, "f");
  assert.equal(res.status, 400);
  const get = await r.dispatch("GET", `/api/break-timer?session=${S}`, undefined, "a");
  assert.equal((get.body as { status: string }).status, "idle");
});

test("POST with past timestamp returns 400", async () => {
  const r = setup();
  const past = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const res = await r.dispatch("POST", "/api/break-timer", { session: S, endsAt: past }, "f");
  assert.equal(res.status, 400);
});

test("POST with endsAt more than 8 hours ahead returns 400", async () => {
  const r = setup();
  const tooFar = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString();
  const res = await r.dispatch("POST", "/api/break-timer", { session: S, endsAt: tooFar }, "f");
  assert.equal(res.status, 400);
});

test("POST replaces existing timer (latest-wins)", async () => {
  const r = setup();
  const first = inMinutes(10);
  await r.dispatch("POST", "/api/break-timer", { session: S, endsAt: first }, "f");

  const second = inMinutes(5);
  await r.dispatch("POST", "/api/break-timer", { session: S, endsAt: second }, "f");

  const get = await r.dispatch("GET", `/api/break-timer?session=${S}`, undefined, "a");
  assert.equal((get.body as { endsAt: string }).endsAt, second);
  assert.equal((get.body as { status: string }).status, "running");
});

test("GET with no timer returns idle state", async () => {
  const r = setup();
  const get = await r.dispatch("GET", `/api/break-timer?session=${S}`, undefined, "a");
  assert.equal(get.status, 200);
  assert.equal((get.body as { status: string }).status, "idle");
  assert.equal((get.body as { minutesLeft: null }).minutesLeft, null);
});

test("GET with expired timer returns expired state", async () => {
  const store = new MemoryStore();
  const r = new Router([breakTimer], store);

  // Set a timer that has already expired
  const expired = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  await store.put(`SESSION#${S}`, "BREAK#TIMER", { endsAt: expired, setAt: expired });

  const get = await r.dispatch("GET", `/api/break-timer?session=${S}`, undefined, "a");
  assert.equal(get.status, 200);
  assert.equal((get.body as { status: string }).status, "expired");
  assert.equal((get.body as { minutesLeft: number }).minutesLeft, 0);
});

test("card renders idle state when no timer is set", async () => {
  const store = new MemoryStore();
  await breakTimer.card!(S, store);
  const html = await breakTimer.card!(S, store);
  assert.match(html, /No break timer set/);
  assert.match(html, /Break Timer/);
});

test("card renders running state with countdown", async () => {
  const store = new MemoryStore();
  const r = new Router([breakTimer], store);
  const endsAt = inMinutes(10);
  await r.dispatch("POST", "/api/break-timer", { session: S, endsAt }, "f");

  const html = await breakTimer.card!(S, store);
  assert.match(html, /Break/);
  assert.match(html, /min left/);
});

test("card renders expired state", async () => {
  const store = new MemoryStore();
  const expired = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  await store.put(`SESSION#${S}`, "BREAK#TIMER", { endsAt: expired, setAt: expired });

  const html = await breakTimer.card!(S, store);
  assert.match(html, /Time's up!/);
});

test("sessions are isolated", async () => {
  const r = setup();
  await r.dispatch("POST", "/api/break-timer", { session: "one", endsAt: inMinutes(10) }, "f");
  const other = await r.dispatch("GET", `/api/break-timer?session=two`, undefined, "a");
  assert.equal((other.body as { status: string }).status, "idle");
});

test("missing session is 400 on both routes", async () => {
  const r = setup();
  const post = await r.dispatch("POST", "/api/break-timer", { endsAt: inMinutes(10) }, "a");
  assert.equal(post.status, 400);
  const get = await r.dispatch("GET", `/api/break-timer`, undefined, "a");
  assert.equal(get.status, 400);
});
