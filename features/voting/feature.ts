import type { Feature, Store } from "../../src/spine/types.ts";

const SCORE_EMOJIS = ["😡", "😕", "😐", "🙂", "🤩"] as const;
type Score = 1 | 2 | 3 | 4 | 5;

interface Aggregate {
  average: number;
  count: number;
}

const SESSION = (id: string) => `SESSION#${id}`;

function isScore(value: unknown): value is Score {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= SCORE_EMOJIS.length
  );
}

async function aggregateVotes(
  sessionId: string,
  store: Store,
): Promise<Aggregate> {
  const items = await store.query(SESSION(sessionId), "VOTE#");
  let sum = 0;
  let count = 0;

  for (const item of items) {
    const score = item["score"];
    if (!isScore(score)) continue;
    sum += score;
    count += 1;
  }

  return {
    average: count === 0 ? 0 : Math.round((sum / count) * 10) / 10,
    count,
  };
}

const feature: Feature = {
  name: "voting",
  description: "Rate the current session from 1 to 5.",
  routes: [
    {
      method: "POST",
      path: "/",
      handler: async (req, store) => {
        const body = req.body as
          | { session?: unknown; score?: unknown }
          | undefined;
        const session = body?.session;
        const score = body?.score;

        if (typeof session !== "string" || session.trim().length === 0) {
          return {
            status: 400,
            body: { error: "session must be a non-empty string" },
          };
        }
        if (!isScore(score)) {
          return {
            status: 400,
            body: { error: "score must be an integer from 1 to 5" },
          };
        }

        const counted = await store.putIfAbsent(
          SESSION(session.trim()),
          `VOTE#${req.callerId}`,
          { score, at: new Date().toISOString() },
        );
        return {
          status: counted ? 201 : 200,
          body: { ok: true, counted },
        };
      },
    },
    {
      method: "GET",
      path: "/",
      handler: async (req, store) => {
        const session = req.query["session"];
        if (typeof session !== "string" || session.trim().length === 0) {
          return {
            status: 400,
            body: { error: "session must be a non-empty string" },
          };
        }
        return {
          status: 200,
          body: await aggregateVotes(session.trim(), store),
        };
      },
    },
  ],
  card: async (sessionId, store) => {
    const aggregate = await aggregateVotes(sessionId, store);
    const buttons = SCORE_EMOJIS.map((emoji, index) => {
      const score = index + 1;
      return `<button class="react" aria-label="Vote ${score} out of 5" onclick="tabla.post('/api/voting',{session:tabla.session,score:${score}})">${emoji}<span>${score}</span></button>`;
    }).join("");

    const summary =
      aggregate.count === 0
        ? "<p>No votes yet</p>"
        : `<p><span aria-hidden="true">${SCORE_EMOJIS[Math.round(aggregate.average) - 1]}</span> <strong>${aggregate.average.toFixed(1)}</strong> from ${aggregate.count} ${aggregate.count === 1 ? "vote" : "votes"}</p>`;

    return `<section class="card"><h2>Voting</h2>${summary}<div class="react-row">${buttons}</div></section>`;
  },
};

export default feature;
