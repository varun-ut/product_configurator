/**
 * analytics.js
 * ------------
 * First-party analytics layer. Replaces the previous PostHog integration —
 * events now flow to our own FastAPI backend (POST /api/events) which writes
 * them to a SQLite DB. Public API (initAnalytics / track / identify /
 * resetAnalytics / setConsent / hasGrantedConsent / onConsentChange) is
 * unchanged so existing call sites across the app keep working without
 * edits.
 *
 * Behaviour summary:
 *   - Strict opt-in: nothing is sent until the consent banner is accepted
 *     (or `setConsent(true)` is called from anywhere).
 *   - Events queue in memory and are flushed in small batches every 10 s,
 *     when the buffer reaches 20 events, or on visibilitychange/pagehide
 *     via navigator.sendBeacon (so events survive a tab close).
 *   - anon_id: stable UUID persisted in localStorage (key uv_anon_id).
 *     Replaces PostHog's distinct_id — identifies an anonymous returning
 *     visitor across visits without any personal data.
 *   - session_id: rotated per page load and after 30 min of inactivity.
 *   - user_id: attached when identify() has been called (e.g. after login)
 *     and cleared on resetAnalytics().
 *   - When POSTHOG_KEY is missing we used to disable analytics entirely;
 *     equivalent now is REACT_APP_ANALYTICS_DISABLED=1 (mostly useful for
 *     local dev to keep your traffic out of the live dataset).
 */

const ENDPOINT = `${process.env.REACT_APP_BACKEND_URL || "http://localhost:8001"}/api/events`;
const DISABLED = process.env.REACT_APP_ANALYTICS_DISABLED === "1";

const CONSENT_KEY = "uv_analytics_consent"; // 'granted' | 'denied'
const ANON_ID_KEY = "uv_anon_id";
const SESSION_ID_KEY = "uv_session_id";
const SESSION_TS_KEY = "uv_session_ts";
const SESSION_IDLE_MS = 30 * 60 * 1000; // 30 min idle resets session

const FLUSH_INTERVAL_MS = 10_000;
const FLUSH_BATCH_SIZE = 20;
const MAX_BUFFER = 200; // hard cap on in-memory queue size

let initialized = false;
let userId = null;
let buffer = [];
let flushTimer = null;

// ── Tiny utilities ────────────────────────────────────────────────────────
function uuid() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for very old browsers — non-cryptographic but unique enough
  // for an analytics distinct_id.
  return "x-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function safeGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function safeSet(key, val) { try { localStorage.setItem(key, val); } catch { /* private mode */ } }
function safeRemove(key) { try { localStorage.removeItem(key); } catch { /* noop */ } }

/**
 * Mirror an event onto window.dataLayer for Google Tag Manager.
 *
 * GTM (container GTM-MKPS77QV) watches the dataLayer and forwards events on to
 * GA4 and Brevo.  This is a one-way announcement — no vendor SDK runs in the
 * app, and nothing here affects the first-party pipeline above.
 *
 * Pushed regardless of cookie consent on purpose: GTM holds its own triggers
 * behind `uv_analytics_consent === "granted"`, so it stays silent until the
 * banner is accepted.  The REACT_APP_ANALYTICS_DISABLED kill-switch still
 * silences this, because callers only reach it once `initialized` is true.
 *
 * `_clear: true` resets GTM's data model before applying the push, so a value
 * from one event can't leak into the next (without it, `result: "saved"` from
 * a save would still be attached to the following `zoom_in`).
 */
function pushToDataLayer(eventName, props) {
  try {
    if (typeof window === "undefined") return;
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({ event: eventName, uv: props || {}, _clear: true });
  } catch { /* never let analytics break the app */ }
}

function getAnonId() {
  let id = safeGet(ANON_ID_KEY);
  if (!id) {
    id = uuid();
    safeSet(ANON_ID_KEY, id);
  }
  return id;
}

function getSessionId() {
  const last = parseInt(safeGet(SESSION_TS_KEY) || "0", 10);
  const now = Date.now();
  let id = safeGet(SESSION_ID_KEY);
  if (!id || (now - last) > SESSION_IDLE_MS) {
    id = uuid();
    safeSet(SESSION_ID_KEY, id);
  }
  safeSet(SESSION_TS_KEY, String(now));
  return id;
}

// ── Consent helpers (unchanged API) ───────────────────────────────────────
export function getConsent() {
  return safeGet(CONSENT_KEY); // null | 'granted' | 'denied'
}
export function hasDecidedConsent() {
  return getConsent() !== null;
}
export function hasGrantedConsent() {
  return getConsent() === "granted";
}

/** Persist consent choice and notify listeners. */
export function setConsent(granted) {
  safeSet(CONSENT_KEY, granted ? "granted" : "denied");
  // If consent flipped from denied → granted, flush whatever's already queued
  // (events queued before consent are kept in memory but not sent).
  if (granted && initialized) {
    scheduleFlush();
  } else if (!granted) {
    // Withdraw consent: drop everything pending; future events won't be sent.
    buffer = [];
  }
  // Tell GTM consent just landed, so its tags can start in THIS page load
  // rather than waiting for the next one.  On later visits GTM reads the
  // stored uv_analytics_consent value at page load instead.
  if (granted) {
    try {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({ event: "uv_consent_granted" });
    } catch { /* never let analytics break the app */ }
  }
  try {
    window.dispatchEvent(new CustomEvent("uv-consent-changed"));
  } catch { /* SSR / non-browser */ }
}

/** Subscribe to consent changes. Returns an unsubscribe fn. */
export function onConsentChange(handler) {
  const listener = () => handler(getConsent());
  window.addEventListener("uv-consent-changed", listener);
  return () => window.removeEventListener("uv-consent-changed", listener);
}

// ── Initialisation ────────────────────────────────────────────────────────
/**
 * Initialise analytics once on app boot. Safe to call multiple times.
 * After init: track() begins queuing events; nothing is actually sent
 * until consent is granted.
 */
export function initAnalytics() {
  if (initialized) return;
  if (DISABLED) {
    // eslint-disable-next-line no-console
    console.info("[analytics] REACT_APP_ANALYTICS_DISABLED=1 — tracking disabled.");
    return;
  }
  initialized = true;

  // Establish anon + session IDs eagerly so they're cached.
  getAnonId();
  getSessionId();

  // Periodic flush — only sends when there's buffered data + consent granted.
  flushTimer = setInterval(scheduleFlush, FLUSH_INTERVAL_MS);

  // Best-effort delivery on tab close / hide. sendBeacon is fire-and-forget
  // and survives navigation, unlike fetch.
  const beaconFlush = () => flush({ beacon: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") beaconFlush();
  });
  window.addEventListener("pagehide", beaconFlush);
}

// ── Public tracking API ───────────────────────────────────────────────────
/**
 * track(eventName, properties)
 *
 * Single entry point for every analytics event. Properties are JSON-encoded
 * server-side. Safe to call before consent is granted — events just queue
 * silently and are dropped (or flushed, if consent is later granted).
 */
export function track(eventName, properties = {}) {
  if (!initialized || !eventName) return;
  // Mirror to GTM first so a full buffer (below) can never cost us the push.
  pushToDataLayer(eventName, properties);
  if (buffer.length >= MAX_BUFFER) buffer.shift(); // drop oldest if overflowing
  buffer.push({
    event_name: eventName,
    anon_id: getAnonId(),
    session_id: getSessionId(),
    user_id: userId || undefined,
    properties: properties && Object.keys(properties).length ? properties : undefined,
    url: typeof window !== "undefined" ? window.location.href : undefined,
    client_ts: Date.now(),
  });
  if (buffer.length >= FLUSH_BATCH_SIZE) scheduleFlush();
}

/** identify(userId, traits?) — stitch the anonymous session to a known user.
 *
 * Sets the in-memory userId so subsequent track() calls attach it to the
 * event row. ALSO emits a one-off `user_identified` event with the supplied
 * traits (e.g. email) so the analytics backend has a way to resolve
 * user_id → email without needing a separate identify endpoint.
 *
 * Idempotent — calling identify() repeatedly with the same id is a no-op
 * for the identify event itself (we only re-emit if id or email changed
 * since the last call). */
let _lastIdentified = null; // `${id}|${email}|${marketing_consent}`
export function identify(id, traits = {}) {
  if (!initialized || !id) return;
  const sid = String(id);
  userId = sid;
  const email = traits?.email || null;
  // May be undefined until the backend stores and returns it — GTM only maps
  // it to Brevo's VC_MARKETING_CONSENT when it is exactly true or false, so an
  // undefined value simply changes nothing downstream.
  const marketingConsent = traits?.marketing_consent;
  // Where the ACCOUNT came from, read back from the user object rather than
  // from this browser's localStorage — so it is correct on every device and
  // every login, not just the one the person signed up on.
  const signupSource = traits?.signup_source;
  const signupCampaign = traits?.signup_campaign;
  // Consent is part of the key: without it a user who later changes their
  // mailing preference would keep the same id+email, hit the early return, and
  // never re-announce the new value to Brevo. Same reasoning for the signup
  // fields — they arrive only once the backend returns them.
  const k = `${sid}|${email}|${marketingConsent}|${signupSource}|${signupCampaign}`;
  if (_lastIdentified === k) return; // already identified with these traits
  _lastIdentified = k;
  // Fire the event through the normal track() pipeline so it picks up
  // anon_id / session_id and gets buffered + flushed like everything else —
  // and so it reaches the dataLayer through the same path as every other event.
  track("user_identified", {
    email,
    user_id: sid,
    marketing_consent: marketingConsent,
    signup_source: signupSource,
    signup_campaign: signupCampaign,
  });
}

/** Clear the identified user (call on logout). */
export function resetAnalytics() {
  userId = null;
  _lastIdentified = null;
  // Force a new session so post-logout activity isn't lumped with the
  // logged-in session.
  safeRemove(SESSION_ID_KEY);
  safeRemove(SESSION_TS_KEY);
}

// ── Internal flush plumbing ───────────────────────────────────────────────
let flushScheduled = false;
function scheduleFlush() {
  if (flushScheduled) return;
  flushScheduled = true;
  // Yield one frame so multiple track() calls in the same tick coalesce.
  Promise.resolve().then(() => {
    flushScheduled = false;
    flush();
  });
}

function flush({ beacon = false } = {}) {
  if (!initialized) return;
  if (!hasGrantedConsent()) return; // strict opt-in; queue stays for later
  if (buffer.length === 0) return;

  const events = buffer;
  buffer = [];
  const payload = JSON.stringify({ events });

  // Beacon path: best-effort on tab close. Body must be a Blob or string;
  // we use a Blob with the JSON content type.
  if (beacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
    try {
      const blob = new Blob([payload], { type: "application/json" });
      const ok = navigator.sendBeacon(ENDPOINT, blob);
      if (!ok) {
        // Couldn't queue — restore events for the next attempt.
        buffer = events.concat(buffer);
      }
      return;
    } catch {
      // fall through to fetch
    }
  }

  // Normal path: fetch with keepalive so it survives a soft navigation too.
  fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
    keepalive: true,
    credentials: "omit",
  }).catch(() => {
    // Network blip — put the events back at the head of the buffer so the
    // next flush retries. Cap at MAX_BUFFER so we don't grow unbounded.
    buffer = events.concat(buffer).slice(-MAX_BUFFER);
  });
}
