import type { Feature, Store } from "../../src/spine/types.ts";

/**
 * upvotes - ask a question, upvote the ones you want answered.
 *
 * Attendees submit short questions; anyone can upvote; the board shows them
 * newest-first with a live vote count. Modeled on the reactions feature.
 *
 * Store layout (see AGENTS.md for the key convention):
 *   pk = SESSION#<sessionId>
 *   Question: sk = QUESTION#<invTs>#<id>   -> { id, text, at }
 *   Vote:     sk = VOTE#<questionId>#<callerId> -> { questionId, callerId, at }
 *
 * invTs is an inverted, zero-padded timestamp so that query() - which returns
 * items sorted by sk ASCENDING - yields questions newest-first with no extra
 * sort. Votes are toggled: a caller's vote item exists (1) or does not (0),
 * so the count can never double-count. voteCount derives the tally on read.
 */

interface Question {
  id: string;
  text: string;
  at: string;
}

const WORD_LIMIT = 150;
// 15-digit ceiling: MAX - Date.now() stays within Number.MAX_SAFE_INTEGER
// (~9.007e15), so every inverted timestamp is exactly representable and the
// ascending sort key is a faithful reverse-chronological order (R3). A
// 16-digit ceiling would exceed the safe range and let 1ms-apart submissions
// collide on the same invTs.
const MAX = 10 ** 15;

const SESSION = (id: string) => `SESSION#${id}`;

// Strictly-decreasing inverted timestamp. Each call returns a value strictly
// smaller than the previous one, so ascending sort-key order is always true
// submission order — even for two questions minted in the same millisecond
// (which would otherwise share an invTs and tiebreak on the random id). All
// values stay within Number.MAX_SAFE_INTEGER given the 15-digit MAX ceiling.
let lastInv = MAX;
const invTs = (ms: number) => {
  const candidate = MAX - ms;
  lastInv = candidate < lastInv ? candidate : lastInv - 1;
  return String(lastInv).padStart(15, "0");
};
const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

const esc = (s: string) =>
  s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!,
  );

async function listQuestions(sessionId: string, store: Store): Promise<Question[]> {
  const rows = await store.query(SESSION(sessionId), "QUESTION#");
  return rows.map((r) => ({
    id: String(r["id"]),
    text: String(r["text"]),
    at: String(r["at"]),
  }));
}

async function voteCount(pk: string, questionId: string, store: Store): Promise<number> {
  return (await store.query(pk, `VOTE#${questionId}#`)).length;
}

const feature: Feature = {
  name: "upvotes",
  description: "Ask a question and upvote the ones you want answered.",
  routes: [
    // Submit a question (R1).
    {
      method: "POST",
      path: "/",
      handler: async (req, store) => {
        const body = req.body as { session?: unknown; text?: unknown } | undefined;
        const sessionId = typeof body?.session === "string" ? body.session.trim() : "";
        if (!sessionId) {
          return { status: 400, body: { error: "missing session" } };
        }
        const text = typeof body?.text === "string" ? body.text.trim() : "";
        if (text === "") {
          return { status: 400, body: { error: "question text is required" } };
        }
        if (wordCount(text) > WORD_LIMIT) {
          return {
            status: 400,
            body: { error: `question must be ${WORD_LIMIT} words or fewer` },
          };
        }
        const id = "q_" + crypto.randomUUID().replace(/-/g, "").slice(0, 12);
        const at = new Date().toISOString();
        await store.put(SESSION(sessionId), `QUESTION#${invTs(Date.now())}#${id}`, {
          id,
          text,
          at,
        });
        return { status: 201, body: { id, text, votes: 0 } };
      },
    },
    // List questions, newest-first (R3).
    {
      method: "GET",
      path: "/",
      handler: async (req, store) => {
        const sessionId = (req.query["session"] ?? "").trim();
        if (!sessionId) {
          return { status: 400, body: { error: "missing ?session=" } };
        }
        const pk = SESSION(sessionId);
        const questions = await listQuestions(sessionId, store);
        const out = [];
        for (const q of questions) {
          out.push({ id: q.id, text: q.text, votes: await voteCount(pk, q.id, store) });
        }
        return { status: 200, body: out };
      },
    },
    // Toggle this caller's vote on a question (R2).
    {
      method: "POST",
      path: "/:id/votes",
      handler: async (req, store) => {
        const body = req.body as { session?: unknown } | undefined;
        const sessionId = typeof body?.session === "string" ? body.session.trim() : "";
        if (!sessionId) {
          return { status: 400, body: { error: "missing session" } };
        }
        const pk = SESSION(sessionId);
        const questionId = req.params["id"] ?? "";
        const questions = await listQuestions(sessionId, store);
        if (!questions.some((q) => q.id === questionId)) {
          return { status: 404, body: { error: "no such question" } };
        }
        const voteSk = `VOTE#${questionId}#${req.callerId}`;
        const existing = await store.get(pk, voteSk);
        if (existing) {
          await store.delete(pk, voteSk);
          const votes = await voteCount(pk, questionId, store);
          return { status: 200, body: { votes, voted: false } };
        }
        const vote = {
          questionId,
          callerId: req.callerId,
          at: new Date().toISOString(),
        };
        await store.put(pk, voteSk, vote);
        const votes = await voteCount(pk, questionId, store);
        return { status: 201, body: { votes, voted: true } };
      },
    },
  ],
  card: async (sessionId, store) => {
    const pk = SESSION(sessionId);
    const questions = await listQuestions(sessionId, store);
    const rows: string[] = [];
    for (const q of questions) {
      const votes = await voteCount(pk, q.id, store);
      rows.push(
        `<li class="upvote-row">` +
          `<span class="upvote-text">${esc(q.text)}</span>` +
          `<button class="upvote-btn" onclick="tabla.post('/api/upvotes/${q.id}/votes',{session:tabla.session})">` +
          `▲ <span class="upvote-count">${votes}</span></button>` +
          `</li>`,
      );
    }
    const list = rows.length
      ? `<ul class="upvote-list">${rows.join("")}</ul>`
      : `<p class="upvote-empty">No questions yet - be the first to ask.</p>`;

    // Empty-guard submit (R4.6/R4.7): trim, alert on empty, never POST empty.
    const submit =
      "(function(){" +
      "var el=document.getElementById('upv-text');" +
      "var v=(el.value||'').trim();" +
      "if(!v){alert('Please type a question before submitting.');return;}" +
      "tabla.post('/api/upvotes',{session:tabla.session,text:v});" +
      "el.value='';" +
      "})()";

    return (
      `<section class="card"><h2>Questions</h2>` +
      `<div class="upvote-input-row">` +
      `<input id="upv-text" type="text" placeholder="Ask a question…" maxlength="1000" />` +
      `<button class="upvote-add" onclick="${esc(submit)}">Add question</button>` +
      `</div>` +
      list +
      `</section>`
    );
  },
};

export default feature;
