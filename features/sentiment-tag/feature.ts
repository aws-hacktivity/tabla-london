import type { Feature, Store, TablaRequest, TablaResponse, Route } from "../../src/spine/types.ts";

/**
 * Sentiment tag feature: tag short sentences with 🙂 😐 🙁 using a
 * rule-based keyword scorer with negation awareness.
 *
 * Scoring: positive words +1, negative words −1, negation flips the next
 * sentiment word's polarity. Score > 0 → 🙂, = 0 → 😐, < 0 → 🙁.
 */

// ─── Word lists ──────────────────────────────────────────────────────────────

const POSITIVE: readonly string[] = [
  "good", "great", "love", "happy", "excellent", "amazing", "awesome",
  "fantastic", "wonderful", "enjoy", "helpful", "fun", "easy", "smooth",
  "clear", "fast", "nice", "like", "pleased", "confident", "brilliant",
  "perfect", "beautiful", "exciting", "impressive", "outstanding",
  "superb", "terrific", "delightful", "glad", "cheerful", "satisfied",
  "thrilled", "grateful", "blessed", "inspired", "motivated",
  "productive", "comfortable", "friendly", "supportive", "creative",
  "elegant", "refreshing", "rewarding", "successful", "joyful",
  "peaceful", "bright", "warm",
];

const NEGATIVE: readonly string[] = [
  "bad", "terrible", "hate", "awful", "slow", "confusing", "hard",
  "frustrating", "annoying", "boring", "ugly", "broken", "wrong",
  "stuck", "painful", "difficult", "lost", "worst", "fail", "useless",
  "horrible", "dreadful", "disappointing", "exhausting", "miserable",
  "stressful", "overwhelming", "clunky", "tedious", "irritating",
  "lousy", "weak", "poor", "messy", "complicated", "unclear", "buggy",
  "laggy", "crashing", "frozen", "bloated", "chaotic", "draining",
  "hopeless", "nightmare", "rough", "tiresome", "wasteful", "unfair",
  "depressing",
];

const NEUTRAL: readonly string[] = [
  "okay", "fine", "alright", "meh", "whatever", "so-so", "average",
  "normal", "moderate", "fair", "decent", "passable", "adequate",
  "mediocre", "standard", "typical", "regular", "ordinary", "acceptable",
  "unremarkable",
];

const NEGATORS: ReadonlySet<string> = new Set([
  "not", "no", "don't", "doesn't", "isn't", "aren't", "wasn't",
  "weren't", "won't", "can't", "couldn't", "shouldn't", "wouldn't",
  "never", "neither", "nobody", "nothing", "nowhere", "hardly",
  "barely", "scarcely",
]);

const positiveSet: ReadonlySet<string> = new Set(POSITIVE);
const negativeSet: ReadonlySet<string> = new Set(NEGATIVE);
const neutralSet: ReadonlySet<string> = new Set(NEUTRAL);

let seqCounter = 0;

// ─── Scorer ──────────────────────────────────────────────────────────────────

type Face = "🙂" | "😐" | "🙁";

interface ScoreResult {
  face: Face;
  score: number;
}

export function score(text: string): ScoreResult {
  const tokens = text.toLowerCase().split(/[^a-z0-9']+/).filter(Boolean);
  let total = 0;
  let negated = false;

  for (const token of tokens) {
    if (!token) continue;

    if (NEGATORS.has(token)) {
      negated = true;
      continue;
    }

    if (positiveSet.has(token)) {
      total += negated ? -1 : 1;
    } else if (negativeSet.has(token)) {
      total += negated ? 1 : -1;
    }
    // neutral or unknown: no score change

    negated = false;
  }

  const face: Face = total > 0 ? "🙂" : total < 0 ? "🙁" : "😐";
  return { face, score: total };
}

// ─── Routes ──────────────────────────────────────────────────────────────────

const SESSION = (id: string) => `SESSION#${id}`;

const routes: Route[] = [
  {
    method: "POST",
    path: "/",
    handler: async (req: TablaRequest, store: Store): Promise<TablaResponse> => {
      const body = req.body as { session?: string; text?: string } | undefined;
      const session = typeof body?.session === "string" ? body.session.trim() : "";
      const text = body?.text;

      if (!session) {
        return { status: 400, body: { error: "missing session" } };
      }
      if (!text || typeof text !== "string" || text.trim().length === 0) {
        return { status: 400, body: { error: "missing or empty text" } };
      }
      if (text.length > 280) {
        return { status: 400, body: { error: "text exceeds 280 characters" } };
      }

      const result = score(text);
      const at = new Date().toISOString();
      const uid = String(seqCounter++).padStart(6, "0");
      const sk = `SENTIMENT#${at}#${req.callerId}#${uid}`;

      await store.put(SESSION(session), sk, {
        face: result.face,
        score: result.score,
        text,
        callerId: req.callerId,
        at,
      });

      return { status: 201, body: { face: result.face, score: result.score, text, at } };
    },
  },
  {
    method: "GET",
    path: "/",
    handler: async (req: TablaRequest, store: Store): Promise<TablaResponse> => {
      const session = typeof req.query["session"] === "string" ? req.query["session"].trim() : "";
      if (!session) {
        return { status: 400, body: { error: "missing ?session=" } };
      }

      const items = await store.query(SESSION(session), "SENTIMENT#");
      return { status: 200, body: items.reverse() };
    },
  },
];

// ─── Card ────────────────────────────────────────────────────────────────────

async function card(sessionId: string, store: Store): Promise<string> {
  const items = await store.query(SESSION(sessionId), "SENTIMENT#");

  let positiveCount = 0;
  let neutralCount = 0;
  let negativeCount = 0;

  for (const item of items) {
    const face = item["face"] as string;
    if (face === "🙂") positiveCount++;
    else if (face === "🙁") negativeCount++;
    else neutralCount++;
  }

  const total = items.length || 1; // avoid division by zero
  const positivePercent = positiveCount || 1;
  const negativePercent = negativeCount || 1;
  const neutralPercent = neutralCount || 1;

  const recent = items.slice(-10).reverse();

  const entriesHtml = recent.length > 0
    ? recent.map((item) =>
        `<li style="padding:10px 14px;border-radius:10px;background:#fff;border:1px solid #ebe7e2;display:flex;align-items:center;gap:10px;font-size:0.9em;"><span style="font-size:1.3em;">${item["face"]}</span><span style="color:#4a4540;">${escapeHtml(item["text"] as string)}</span></li>`
      ).join("")
    : `<li style="padding:20px;text-align:center;color:#9b9590;font-style:italic;">Type how you're feeling — the room's mood appears here</li>`;

  return `<section class="card" style="background:#f8f6f2;border:1px solid #e8e4de;border-radius:14px;padding:24px;color:#2d2a26;font-family:system-ui,-apple-system,sans-serif;">
  <h2 style="margin:0 0 16px;font-size:1.3em;font-weight:600;color:#3d3832;">🎭 Sentiment Pulse</h2>
  <div style="margin-bottom:20px;">
    <div style="display:flex;gap:3px;height:28px;border-radius:8px;overflow:hidden;margin-bottom:8px;">
      <div style="flex:${positivePercent};background:#a8d5a2;border-radius:6px;"></div>
      <div style="flex:${neutralPercent};background:#f5d98c;border-radius:6px;"></div>
      <div style="flex:${negativePercent};background:#e8a9a0;border-radius:6px;"></div>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:0.85em;color:#6b6560;">
      <span>🙂 ${positiveCount}</span>
      <span>😐 ${neutralCount}</span>
      <span>🙁 ${negativeCount}</span>
    </div>
  </div>
  <form onsubmit="event.preventDefault();var t=this.querySelector('input');if(t.value.trim()){tabla.post('/api/sentiment-tag',{session:tabla.session,text:t.value});t.value='';}" style="display:flex;gap:8px;margin-bottom:20px;">
    <input type="text" maxlength="280" placeholder="How's it going?" style="flex:1;padding:12px 16px;border:1px solid #ddd8d2;border-radius:10px;background:#fff;color:#2d2a26;font-size:1em;outline:none;" />
    <button type="submit" style="padding:12px 20px;border:none;border-radius:10px;background:#3d3832;color:#f8f6f2;font-weight:600;cursor:pointer;font-size:1em;">Tag</button>
  </form>
  <ul style="list-style:none;margin:0;padding:0;max-height:200px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;">
    ${entriesHtml}
  </ul>
</section>`;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ─── Feature export ──────────────────────────────────────────────────────────

const feature: Feature = {
  name: "sentiment-tag",
  description: "Tag short sentences with a sentiment face using rule-based scoring.",
  routes,
  card,
};

export default feature;
