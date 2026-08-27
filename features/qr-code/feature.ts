import type { Feature, Store } from "../../src/spine/types.ts";

/**
 * Scan-to-join: renders the board's own public URL as a QR code, top card
 * on the projector so a latecomer can join without typing a Lambda URL.
 *
 * The board URL is not handed to features by the runtime, so it lives as
 * configuration in the shared table (latest-wins on one fixed key):
 *   pk = SESSION#<sessionId>
 *   sk = CONFIG#url             -> { url, at }
 *
 * The QR image is produced by the public api.qrserver.com service (no
 * runtime dependency, no existing QR asset in the repo); the URL travels
 * in the `data` query parameter, so the payload is inspectable at a glance.
 * See README.md for the trust model and the tradeoffs behind that choice.
 */

const SESSION = (id: string) => `SESSION#${id}`;
const CONFIG_SK = "CONFIG#url";
const QR_ENDPOINT = "https://api.qrserver.com/v1/create-qr-code/";

/**
 * Trim a session id at the boundary and reject whitespace-only input.
 * Returns the normalized (trimmed, non-empty) id, or null. Sharing one
 * function across both routes keeps normalization identical everywhere, so
 * "  s  " on POST and "s" on GET address the same stored session.
 */
function normalizeSession(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed === "" ? null : trimmed;
}

/** Accept only http(s) URLs; returns the normalized URL or null. */
function normalizeUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** Escape for double-quoted HTML attributes and text content. */
function esc(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function configuredUrl(
  sessionId: string,
  store: Store,
): Promise<string | null> {
  const cfg = await store.get(SESSION(sessionId), CONFIG_SK);
  const url = cfg?.["url"];
  return typeof url === "string" ? url : null;
}

const feature: Feature = {
  name: "qr-code",
  description: "Scan-to-join QR code of the board's public URL.",
  routes: [
    {
      // Facilitator sets the board's own public URL once (latest-wins).
      method: "POST",
      path: "/",
      handler: async (req, store) => {
        const body = req.body as
          | { session?: string; url?: string }
          | undefined;
        const sessionId = normalizeSession(body?.session);
        if (!sessionId) {
          return { status: 400, body: { error: "missing session" } };
        }
        const url = normalizeUrl(body?.url);
        if (!url) {
          return {
            status: 400,
            body: { error: "url must be a valid http(s) URL" },
          };
        }
        await store.put(SESSION(sessionId), CONFIG_SK, {
          url,
          at: new Date().toISOString(),
        });
        return { status: 200, body: { ok: true, url } };
      },
    },
    {
      method: "GET",
      path: "/",
      handler: async (req, store) => {
        const sessionId = normalizeSession(req.query["session"]);
        if (!sessionId) {
          return { status: 400, body: { error: "missing ?session=" } };
        }
        return {
          status: 200,
          body: { url: await configuredUrl(sessionId, store) },
        };
      },
    },
  ],
  card: async (sessionId, store) => {
    const url = await configuredUrl(sessionId, store);

    if (!url) {
      // No URL yet: show the facilitator how to set it once.
      const example = `curl -X POST &lt;board-url&gt;/api/qr-code -H 'content-type: application/json' -d '{"session":"${esc(
        sessionId,
      )}","url":"https://&lt;board-url&gt;/"}'`;
      return `<section class="card"><h2>Scan to join</h2>
<p class="sub">No board URL set yet. The facilitator can set it once:</p>
<p><code>${example}</code></p></section>`;
    }

    // data= carries the exact URL the QR encodes - verifiable at a glance.
    const qr = `${QR_ENDPOINT}?size=240x240&margin=8&data=${encodeURIComponent(
      url,
    )}`;
    return `<section class="card"><h2>Scan to join</h2>
<img src="${esc(qr)}" alt="QR code to open the board" width="240" height="240"
  style="background:#fff;border-radius:12px;padding:8px;display:block">
<p class="sub"><a href="${esc(url)}" style="color:var(--accent)">${esc(
      url,
    )}</a></p></section>`;
  },
};

export default feature;
