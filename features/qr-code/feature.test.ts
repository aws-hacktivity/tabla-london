import { test } from "node:test";
import assert from "node:assert/strict";
import { Router } from "../../src/spine/router.ts";
import { MemoryStore } from "../../src/spine/store.ts";
import qrCode from "./feature.ts";

function setup() {
  return new Router([qrCode], new MemoryStore());
}

const S = "sess-1";
const URL1 = "https://abc123.lambda-url.us-east-1.on.aws/";
const URL2 = "https://def456.lambda-url.us-east-1.on.aws/";

test("a valid url is stored and read back", async () => {
  const r = setup();
  const post = await r.dispatch("POST", "/api/qr-code", { session: S, url: URL1 }, "fac");
  assert.equal(post.status, 200);
  assert.deepEqual(post.body, { ok: true, url: URL1 });

  const get = await r.dispatch("GET", `/api/qr-code?session=${S}`, undefined, "x");
  assert.equal(get.status, 200);
  assert.deepEqual(get.body, { url: URL1 });
});

test("re-posting replaces the url (latest-wins)", async () => {
  const r = setup();
  await r.dispatch("POST", "/api/qr-code", { session: S, url: URL1 }, "fac");
  await r.dispatch("POST", "/api/qr-code", { session: S, url: URL2 }, "fac");
  const get = await r.dispatch("GET", `/api/qr-code?session=${S}`, undefined, "x");
  assert.deepEqual(get.body, { url: URL2 });
});

test("a non-http(s) url is rejected and stored nothing", async () => {
  const r = setup();
  const bad = await r.dispatch(
    "POST",
    "/api/qr-code",
    { session: S, url: "javascript:alert(1)" },
    "fac",
  );
  assert.equal(bad.status, 400);
  const get = await r.dispatch("GET", `/api/qr-code?session=${S}`, undefined, "x");
  assert.deepEqual(get.body, { url: null });
});

test("a missing url is a 400", async () => {
  const r = setup();
  const res = await r.dispatch("POST", "/api/qr-code", { session: S }, "fac");
  assert.equal(res.status, 400);
});

test("missing session is a 400 on both routes", async () => {
  const r = setup();
  const post = await r.dispatch("POST", "/api/qr-code", { url: URL1 }, "fac");
  assert.equal(post.status, 400);
  const get = await r.dispatch("GET", "/api/qr-code", undefined, "x");
  assert.equal(get.status, 400);
});

test("a whitespace-only session is a 400 on both routes and stores nothing", async () => {
  // Retain the store so we can inspect partitions directly, rather than
  // inferring "no write" from an unrelated session read.
  const store = new MemoryStore();
  const r = new Router([qrCode], store);
  const WS = "   ";
  const post = await r.dispatch("POST", "/api/qr-code", { session: WS, url: URL1 }, "fac");
  assert.equal(post.status, 400);
  // GET carries the whitespace url-encoded so it survives to the handler.
  const get = await r.dispatch("GET", "/api/qr-code?session=%20%20%20", undefined, "x");
  assert.equal(get.status, 400);
  // Direct proof: no CONFIG#url item exists under the untrimmed whitespace
  // key (SESSION#"   ") nor under an empty normalized key (SESSION#"").
  // store.get returns undefined when the partition/item was never written.
  assert.equal(await store.get(`SESSION#${WS}`, "CONFIG#url"), undefined);
  assert.equal(await store.get("SESSION#", "CONFIG#url"), undefined);
});

test("session ids are trimmed consistently across POST and GET", async () => {
  const r = setup();
  // POST with surrounding whitespace...
  const post = await r.dispatch("POST", "/api/qr-code", { session: "  pad-1  ", url: URL1 }, "fac");
  assert.equal(post.status, 200);
  // ...reads back under the trimmed id (no whitespace).
  const get = await r.dispatch("GET", "/api/qr-code?session=pad-1", undefined, "x");
  assert.deepEqual(get.body, { url: URL1 });
  // And a padded GET normalizes to the same session.
  const paddedGet = await r.dispatch("GET", "/api/qr-code?session=%20%20pad-1%20%20", undefined, "x");
  assert.deepEqual(paddedGet.body, { url: URL1 });
});

test("sessions are isolated", async () => {
  const r = setup();
  await r.dispatch("POST", "/api/qr-code", { session: "one", url: URL1 }, "fac");
  const other = await r.dispatch("GET", "/api/qr-code?session=two", undefined, "x");
  assert.deepEqual(other.body, { url: null });
});

test("card shows a setup hint when no url is configured", async () => {
  const store = new MemoryStore();
  const html = await qrCode.card!(S, store);
  assert.match(html, /No board URL set yet/);
  assert.doesNotMatch(html, /api\.qrserver\.com/);
});

test("card renders a QR image encoding exactly the configured url", async () => {
  const store = new MemoryStore();
  const r = new Router([qrCode], store);
  await r.dispatch("POST", "/api/qr-code", { session: S, url: URL1 }, "fac");

  const html = await qrCode.card!(S, store);
  // The payload the QR encodes: the exact url in the data= parameter.
  assert.match(html, new RegExp(`data=${encodeURIComponent(URL1)}`));
  assert.match(html, /api\.qrserver\.com\/v1\/create-qr-code/);
  // Readable fallback link is present too.
  assert.ok(html.includes(`>${URL1}</a>`));
});
