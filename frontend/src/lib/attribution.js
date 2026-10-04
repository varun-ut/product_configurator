/**
 * attribution.js
 * --------------
 * First-touch attribution: remembers where a visitor originally came from so a
 * sign-up can be credited to the campaign that produced it.
 *
 * "First-touch" is the point: the stored value is written once and never
 * overwritten by a later visit. Someone who arrives from the launch email,
 * leaves, and comes back a week later by typing the address still registers as
 * having come from the launch email.
 *
 * captureSource() must run BEFORE React renders — the configurator redirects
 * `/` to `/flat` on mount, and although that redirect now preserves the query
 * string, reading it here first means the capture never depends on that.
 *
 * Note this is per-browser (localStorage). Someone who lands on their phone and
 * signs up on a laptop is recorded as direct. That is why the value is stored
 * on the user record at registration (see auth.py): once it is on the account
 * it is correct on every device thereafter.
 */

const SRC_KEY = "uv_src";

function safeGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function safeSet(key, val) { try { localStorage.setItem(key, val); } catch { /* private mode */ } }

/**
 * Record where this visitor came from, unless we already know.
 * Safe to call on every page load — it is a no-op after the first.
 */
export function captureSource() {
  try {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search);
    const hasCampaign = q.get("utm_source") || q.get("utm_campaign");

    // A campaign link always wins, even if we already stored something: it is
    // a stronger signal than a guess made from the referrer on an earlier
    // visit, and it is the one marketing needs to attribute the sign-up.
    if (!hasCampaign && safeGet(SRC_KEY)) return;

    let payload;
    if (hasCampaign) {
      payload = {
        source: q.get("utm_source") || "",
        medium: q.get("utm_medium") || "",
        campaign: q.get("utm_campaign") || "",
        content: q.get("utm_content") || "",
      };
    } else {
      // No campaign params — classify from the referrer.
      const ref = document.referrer || "";
      let host = "";
      try { host = ref ? new URL(ref).hostname : ""; } catch { host = ""; }
      const source = !host || host === window.location.hostname
        ? "direct"
        : /univicoustic\.com$/.test(host) ? "website" : "referral";
      payload = {
        source,
        medium: host && host !== window.location.hostname ? "referral" : "none",
        campaign: "",
        content: "",
      };
    }

    safeSet(SRC_KEY, JSON.stringify({
      ...payload,
      landing: window.location.href,
      referrer: document.referrer || "",
      at: new Date().toISOString(),
    }));
  } catch { /* attribution must never break the app */ }
}

/** The stored first-touch record, or null. Shape as written above. */
export function getSource() {
  try {
    const raw = safeGet(SRC_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null; // corrupt JSON — treat as unknown rather than throwing
  }
}
