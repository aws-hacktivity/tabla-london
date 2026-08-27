import { test } from "node:test";
import assert from "node:assert/strict";
import { Router } from "../../src/spine/router.ts";
import { MemoryStore } from "../../src/spine/store.ts";
import voting from "./feature.ts";

function setup() {
  const store = new MemoryStore();
  return { router: new Router([voting], store), store };
}

const S = "session-1";

test("feature metadata matches the voting directory", () => {
  assert.equal(voting.name, "voting");
  assert.ok(voting.description.length > 0);
  assert.ok(Array.isArray(voting.routes));
});

test("a caller's first valid vote is counted", async () => {
  const { router } = setup();
  const response = await router.dispatch(
    "POST",
    "/api/voting",
    { session: S, score: 4 },
    "alice",
  );

  assert.equal(response.status, 201);
  assert.deepEqual(response.body, { ok: true, counted: true });

  const aggregate = await router.dispatch(
    "GET",
    `/api/voting?session=${S}`,
    undefined,
    "viewer",
  );
  assert.deepEqual(aggregate.body, { average: 4, count: 1 });
});

test("a repeat vote cannot replace the caller's first score", async () => {
  const { router } = setup();
  await router.dispatch(
    "POST",
    "/api/voting",
    { session: S, score: 2 },
    "alice",
  );
  const repeat = await router.dispatch(
    "POST",
    "/api/voting",
    { session: S, score: 5 },
    "alice",
  );

  assert.equal(repeat.status, 200);
  assert.deepEqual(repeat.body, { ok: true, counted: false });

  const aggregate = await router.dispatch(
    "GET",
    `/api/voting?session=${S}`,
    undefined,
    "viewer",
  );
  assert.deepEqual(aggregate.body, { average: 2, count: 1 });
});

test("different callers contribute independent votes", async () => {
  const { router } = setup();
  await router.dispatch(
    "POST",
    "/api/voting",
    { session: S, score: 1 },
    "alice",
  );
  await router.dispatch(
    "POST",
    "/api/voting",
    { session: S, score: 5 },
    "bob",
  );

  const aggregate = await router.dispatch(
    "GET",
    `/api/voting?session=${S}`,
    undefined,
    "viewer",
  );
  assert.deepEqual(aggregate.body, { average: 3, count: 2 });
});

test("invalid scores are rejected and not stored", async () => {
  const invalidScores: unknown[] = [0, 6, 2.5, "3", undefined, true, null];

  for (const [index, score] of invalidScores.entries()) {
    const { router, store } = setup();
    const response = await router.dispatch(
      "POST",
      "/api/voting",
      { session: S, score },
      `caller-${index}`,
    );

    assert.equal(response.status, 400, `score ${String(score)} should fail`);
    assert.deepEqual(await store.query(`SESSION#${S}`, "VOTE#"), []);
  }
});

test("missing and empty sessions are rejected on POST and GET", async () => {
  const { router, store } = setup();

  for (const session of [undefined, "", "   "]) {
    const post = await router.dispatch(
      "POST",
      "/api/voting",
      { session, score: 3 },
      "alice",
    );
    assert.equal(post.status, 400);
  }

  assert.equal(
    (await router.dispatch("GET", "/api/voting", undefined, "viewer")).status,
    400,
  );
  assert.equal(
    (
      await router.dispatch(
        "GET",
        "/api/voting?session=%20%20%20",
        undefined,
        "viewer",
      )
    ).status,
    400,
  );
  for (const partitionKey of ["SESSION#", "SESSION#undefined", "SESSION#   "]) {
    assert.deepEqual(await store.query(partitionKey, "VOTE#"), []);
  }
});

test("sessions have isolated aggregates", async () => {
  const { router } = setup();
  await router.dispatch(
    "POST",
    "/api/voting",
    { session: "session-one", score: 5 },
    "alice",
  );

  const first = await router.dispatch(
    "GET",
    "/api/voting?session=session-one",
    undefined,
    "viewer",
  );
  const second = await router.dispatch(
    "GET",
    "/api/voting?session=session-two",
    undefined,
    "viewer",
  );

  assert.deepEqual(first.body, { average: 5, count: 1 });
  assert.deepEqual(second.body, { average: 0, count: 0 });
});

test("an empty session has a zero aggregate", async () => {
  const { router } = setup();
  const response = await router.dispatch(
    "GET",
    "/api/voting?session=empty",
    undefined,
    "viewer",
  );

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { average: 0, count: 0 });
});

test("the aggregate ignores malformed records and rounds to one decimal", async () => {
  const { router, store } = setup();
  await router.dispatch(
    "POST",
    "/api/voting",
    { session: S, score: 1 },
    "alice",
  );
  await router.dispatch(
    "POST",
    "/api/voting",
    { session: S, score: 2 },
    "bob",
  );
  await router.dispatch(
    "POST",
    "/api/voting",
    { session: S, score: 2 },
    "carol",
  );
  await store.put(`SESSION#${S}`, "VOTE#malformed", {
    score: "5",
    at: new Date().toISOString(),
  });

  const response = await router.dispatch(
    "GET",
    `/api/voting?session=${S}`,
    undefined,
    "viewer",
  );
  assert.deepEqual(response.body, { average: 1.7, count: 3 });
});

test("the card renders five ordered emoji buttons with voting calls", async () => {
  const { store } = setup();
  const html = await voting.card!(S, store);
  const emojis = ["😡", "😕", "😐", "🙂", "🤩"];
  const positions = emojis.map((emoji) => html.indexOf(`>${emoji}<span>`));

  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  for (const [index] of emojis.entries()) {
    const score = index + 1;
    assert.ok(
      html.includes(
        `onclick="tabla.post('/api/voting',{session:tabla.session,score:${score}})"`,
      ),
    );
  }
});

test("the card renders no-vote, singular, and rounded plural summaries", async () => {
  const { router, store } = setup();
  const empty = await voting.card!(S, store);
  assert.match(empty, /<p>No votes yet<\/p>/);
  assert.doesNotMatch(empty, /<p><span aria-hidden="true">/);

  await router.dispatch(
    "POST",
    "/api/voting",
    { session: S, score: 4 },
    "alice",
  );
  const singular = await voting.card!(S, store);
  assert.match(
    singular,
    /<p><span aria-hidden="true">🙂<\/span> <strong>4\.0<\/strong> from 1 vote<\/p>/,
  );

  await router.dispatch(
    "POST",
    "/api/voting",
    { session: S, score: 5 },
    "bob",
  );
  const plural = await voting.card!(S, store);
  assert.match(
    plural,
    /<p><span aria-hidden="true">🤩<\/span> <strong>4\.5<\/strong> from 2 votes<\/p>/,
  );
});
