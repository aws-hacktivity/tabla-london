import type { Feature, Store } from "../../src/spine/types.ts";

/**
 * Break timer: a countdown the facilitator sets once and the whole room sees.
 *
 * Demonstrates:
 *   1. a write route  (POST /api/break-timer) — facilitator sets the end time
 *   2. a read route   (GET  /api/break-timer) — anyone reads the timer state
 *   3. a board card   (countdown rendered on each server-side poll)
 *
 * Store layout (see AGENTS.md for the key convention):
 *   pk = SESSION#<sessionId>
 *   sk = BREAK#TIMER                 -> { endsAt, setAt }
 *
 * A single item per session — `put` (not putIfAbsent) gives latest-wins
 * semantics: the facilitator can override a running timer by setting a new one.
 * The card recomputes "minutes left" on every render (every ~4s via /cards
 * poll), so the countdown stays in sync without client-side ticking.
 */

const SESSION = (id: string) => `SESSION#${id}`;
const TIMER_SK = "BREAK#TIMER";
const MAX_HOURS = 8;

interface TimerItem {
  endsAt: string;
  setAt: string;
}

interface TimerState {
  endsAt: string | null;
  status: "idle" | "running" | "expired";
  minutesLeft: number | null;
}

/** Validate and parse the endsAt field. Returns null if invalid. */
function parseEndsAt(raw: unknown): { ok: true; value: Date } | { ok: false; error: string } {
  if (typeof raw !== "string" || raw.length === 0) {
    return { ok: false, error: "endsAt must be an ISO-8601 timestamp" };
  }
  const parsed = new Date(raw);
  if (isNaN(parsed.getTime())) {
    return { ok: false, error: "endsAt must be an ISO-8601 timestamp" };
  }
  const now = Date.now();
  if (parsed.getTime() <= now) {
    return { ok: false, error: "endsAt must be in the future" };
  }
  const maxAhead = now + MAX_HOURS * 60 * 60 * 1000;
  if (parsed.getTime() > maxAhead) {
    return { ok: false, error: `endsAt must be within ${MAX_HOURS} hours` };
  }
  return { ok: true, value: parsed };
}

/** Read the timer from the store and compute its current state. */
async function readTimer(sessionId: string, store: Store): Promise<TimerState> {
  const items = await store.query(SESSION(sessionId), "BREAK#");
  if (items.length === 0) {
    return { endsAt: null, status: "idle", minutesLeft: null };
  }
  const item = items[0] as unknown as TimerItem;
  const endsAt = item.endsAt;
  const now = Date.now();
  const msLeft = new Date(endsAt).getTime() - now;
  if (msLeft <= 0) {
    return { endsAt, status: "expired", minutesLeft: 0 };
  }
  const minutesLeft = Math.ceil(msLeft / 60000);
  return { endsAt, status: "running", minutesLeft };
}

/** Format an ISO timestamp as HH:MM (24h, local-ish via UTC for consistency). */
function formatTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

const feature: Feature = {
  name: "break-timer",
  description: "A break countdown the facilitator sets and the whole room sees.",
  routes: [
    {
      method: "POST",
      path: "/",
      handler: async (req, store) => {
        const body = req.body as { session?: string; endsAt?: unknown } | undefined;
        const sessionId = body?.session;
        const endsAtRaw = body?.endsAt;

        if (!sessionId || typeof sessionId !== "string") {
          return { status: 400, body: { error: "missing session" } };
        }

        const result = parseEndsAt(endsAtRaw);
        if (!result.ok) {
          return { status: 400, body: { error: result.error } };
        }

        const endsAt = result.value.toISOString();
        const setAt = new Date().toISOString();

        await store.put(SESSION(sessionId), TIMER_SK, { endsAt, setAt });

        const now = Date.now();
        const minutesLeft = Math.ceil((result.value.getTime() - now) / 60000);

        return {
          status: 200,
          body: { ok: true, endsAt, status: "running", minutesLeft },
        };
      },
    },
    {
      method: "GET",
      path: "/",
      handler: async (req, store) => {
        const sessionId = req.query["session"];
        if (!sessionId) {
          return { status: 400, body: { error: "missing ?session=" } };
        }
        const state = await readTimer(sessionId, store);
        return { status: 200, body: state };
      },
    },
  ],
  card: async (sessionId, store) => {
    const state = await readTimer(sessionId, store);

    // Quick-set buttons post immediately on click — no form state to lose when
    // the board re-renders card HTML every ~4s. Each computes endsAt as
    // now + N minutes at click time (client clock). The POST route validates.
    const quickSet = (mins: number) =>
      `<button class="react" onclick="tabla.post('/api/break-timer',{session:tabla.session,endsAt:new Date(Date.now()+${mins}*60000).toISOString()})">${mins} min</button>`;
    // Clear resets to not-running. The POST route rejects past times, so we
    // post the soonest valid future instant (now + 1s); the timer then expires
    // on the next render, leaving the running state.
    const clearBtn = `<button class="react" onclick="tabla.post('/api/break-timer',{session:tabla.session,endsAt:new Date(Date.now()+1000).toISOString()})">Clear</button>`;
    const controls = `<div class="break-form">${quickSet(5)}${quickSet(10)}${quickSet(15)}${clearBtn}</div>`;

    if (state.status === "idle") {
      return `<section class="card"><h2>Break Timer</h2><p>No break timer set.</p><p class="dim">Facilitator: start a break below.</p>${controls}</section>`;
    }

    if (state.status === "expired") {
      return `<section class="card"><h2>Break</h2><p class="countdown">Time's up! (was ${formatTime(state.endsAt!)})</p>${controls}</section>`;
    }

    // running
    return `<section class="card"><h2>Break</h2><p class="countdown">Back at ${formatTime(state.endsAt!)} (${state.minutesLeft} min left)</p>${controls}</section>`;
  },
};

export default feature;
