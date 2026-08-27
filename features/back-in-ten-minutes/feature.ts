import type { Feature, Store } from "../../src/spine/types.ts";

const SESSION = (id: string) => `SESSION#${id}`;

function formatTime(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

const feature: Feature = {
  name: "back-in-ten-minutes",
  description: "A break timer the whole room sees.",
  routes: [
    {
      method: "POST",
      path: "/",
      handler: async (req, store) => {
        const body = req.body as { session?: string; duration?: unknown } | undefined;
        const sessionId = body?.session;
        if (!sessionId || typeof sessionId !== "string") {
          return { status: 400, body: { error: "missing session" } };
        }
        const duration = Number(body?.duration);
        if (!Number.isFinite(duration) || duration <= 0) {
          return { status: 400, body: { error: "duration must be a positive number" } };
        }
        const now = new Date();
        const endTime = new Date(now.getTime() + duration * 60_000);
        const createdAt = now.toISOString();
        const uniqueId = `${createdAt}#${Math.random().toString(36).slice(2, 8)}`;
        await store.put(
          SESSION(sessionId),
          `TIMER#${uniqueId}`,
          { endTime: endTime.toISOString(), createdAt },
        );
        return { status: 201, body: { ok: true, endTime: endTime.toISOString() } };
      },
    },
    {
      method: "GET",
      path: "/",
      handler: async (req, store) => {
        const sessionId = req.query["session"];
        if (!sessionId) {
          return { status: 400, body: { error: "missing session" } };
        }
        const items = await store.query(SESSION(sessionId), "TIMER#");
        const now = Date.now();
        const timers = items.map((item) => {
          const endTime = item["endTime"] as string;
          const end = new Date(endTime).getTime();
          if (now < end) {
            return { endTime, status: "running", remainingSeconds: Math.ceil((end - now) / 1000) };
          }
          return { endTime, status: "expired", remainingSeconds: null };
        });
        return { status: 200, body: timers };
      },
    },
  ],
  card: async (sessionId, store) => {
    const items = await store.query(SESSION(sessionId), "TIMER#");
    const now = Date.now();
    const FIVE_MIN = 5 * 60_000;

    const visible = items.filter((item) => {
      const end = new Date(item["endTime"] as string).getTime();
      return now < end || now - end < FIVE_MIN;
    });

    const btnStyle = `class="react" style="width:100%;box-sizing:border-box;padding:0.4rem 0.6rem"`;
    const buttons = [5, 10, 15].map(
      (m) => `<button ${btnStyle} onclick="tabla.post('/api/back-in-ten-minutes',{session:tabla.session,duration:${m}})">${m} min</button>`
    ).join("");
    const inputStyle = `style="width:100%;box-sizing:border-box;padding:0.4rem 0.6rem;background:transparent;color:inherit;border:1px solid currentColor;border-radius:4px;text-align:center;font-size:inherit;-moz-appearance:textfield;appearance:textfield"`;
    const customInput = `<input id="custom-min" type="number" min="1" placeholder="custom" ${inputStyle}><button ${btnStyle} onclick="const m=document.getElementById('custom-min').value;if(m>0)tabla.post('/api/back-in-ten-minutes',{session:tabla.session,duration:Number(m)})">Set</button>`;
    const sidebar = `<div style="display:flex;flex-direction:column;gap:0.3rem;margin-left:1rem;width:5.75rem">${buttons}<div style="margin-top:0.3rem"></div>${customInput}</div>`;

    if (visible.length === 0) {
      return `<section class="card"><h2>Break Timer</h2><div style="display:flex;align-items:flex-start"><p style="flex:1">Break soon, don't worry!</p>${sidebar}</div></section>`;
    }

    const lines = visible.map((item) => {
      const endTime = item["endTime"] as string;
      const end = new Date(endTime).getTime();
      if (now >= end) {
        return `<p><strong>Time's up!</strong></p>`;
      }
      const totalSecs = Math.ceil((end - now) / 1000);
      const h = Math.floor(totalSecs / 3600);
      const m = Math.floor((totalSecs % 3600) / 60);
      const s = totalSecs % 60;
      const countdown = h > 0
        ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
        : `${m}:${String(s).padStart(2, "0")}`;
      return `<p>Back at ${formatTime(endTime)} — <strong>${countdown}</strong> left</p>`;
    });

    return `<section class="card"><h2>Break Timer</h2><div style="display:flex;align-items:flex-start"><div style="flex:1">${lines.join("")}</div>${sidebar}</div></section>`;
  },
};

export default feature;
