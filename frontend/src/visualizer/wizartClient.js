/**
 * Thin wrapper around the Wizart Visualizer API.
 *
 * Auth: every request carries `X-Api-Key` (the subscription token issued
 * to your Wizart account) plus a `Device-Token` (a per-session UUID that
 * Wizart uses for usage tracking).  The API key MUST be supplied via the
 * env var REACT_APP_WIZART_API_KEY — it never lives in source.  If absent,
 * `isWizartConfigured()` returns false so the UI can show a setup prompt
 * instead of throwing on every interaction.
 *
 * The `apply` endpoint takes a room photo + texture identifier and returns
 * a base64-encoded composited image showing the texture applied to the
 * detected wall surfaces.  Exact field names below are based on the public
 * docs and may need tweaking once you have access to the full API reference
 * — the TODO comments mark the spots most likely to need adjustment.
 */

const API_BASE = process.env.REACT_APP_WIZART_API_BASE || "https://rni.wizart.ai";
const API_KEY = process.env.REACT_APP_WIZART_API_KEY || "";

const SESSION_KEY = "uv-wizart-device-token";

export function isWizartConfigured() {
  return Boolean(API_KEY);
}

/**
 * Stable per-browser-session UUID used as Wizart's Device-Token header.
 * Stored in sessionStorage so a refresh keeps the same token (matches
 * Wizart's expectations for "one device-token per user session").
 */
function getDeviceToken() {
  let t = sessionStorage.getItem(SESSION_KEY);
  if (!t) {
    t = (typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : "uv-" + Math.random().toString(36).slice(2) + Date.now().toString(36));
    sessionStorage.setItem(SESSION_KEY, t);
  }
  return t;
}

/**
 * POST a room photo + the URL of one of our panel textures to Wizart and
 * receive back a composited preview as a `data:image/png;base64,...` URL.
 *
 * @param {File}   roomPhoto         The room image the user uploaded.
 * @param {string} panelTextureUrl   Public URL of the panel cutout we want
 *                                   applied to the detected wall.  Must be
 *                                   reachable from Wizart's servers (so an
 *                                   S3 / CloudFront URL, not localhost).
 * @returns {Promise<string>}        Data-URL of the composited image.
 */
export async function applyPanelToRoom(roomPhoto, panelTextureUrl) {
  if (!isWizartConfigured()) {
    throw new Error(
      "Wizart API key not configured. Set REACT_APP_WIZART_API_KEY in your .env.local and restart the dev server."
    );
  }

  // Wizart's `/apply` endpoint accepts multipart so we can ship the photo
  // bytes directly.  The texture is referenced by URL so they can fetch it
  // from our CDN (the cutouts under /static/images/vicstrip/panels/...).
  // TODO once you have docs access: confirm the exact field names below.
  // Public examples reference `/apply/custom?hash={hash}`; for first-pass
  // testing we use `/apply` without the hash and rely on the texture URL.
  const fd = new FormData();
  fd.append("room", roomPhoto);            // TODO: confirm field name (`image`? `photo`?)
  fd.append("texture_url", panelTextureUrl); // TODO: confirm
  fd.append("category", "wall_panels");    // Wizart segments by product family

  const res = await fetch(`${API_BASE}/apply/custom`, {
    method: "POST",
    headers: {
      "X-Api-Key": API_KEY,
      "Device-Token": getDeviceToken(),
      // Don't set Content-Type — browser auto-sets multipart boundary.
    },
    body: fd,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Wizart API failed (${res.status}): ${text || res.statusText}`);
  }

  const data = await res.json();
  // Response shape per docs: { image: "<base64>" } or { result: {...} }
  // — adjust if your account returns a different envelope.
  const base64 =
    data.image ||
    data.result?.image ||
    data.data?.image ||
    null;
  if (!base64) {
    throw new Error("Wizart response did not contain an image field. Inspect the response shape and update wizartClient.js.");
  }
  // Some accounts return raw base64, others a data: URL.  Normalise both.
  return base64.startsWith("data:") ? base64 : `data:image/png;base64,${base64}`;
}
