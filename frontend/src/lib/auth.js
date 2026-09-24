/**
 * auth.js
 * -------
 * Thin client wrapper around /api/auth/*. The backend (see backend/auth.py)
 * implements an OTP-based register flow and an email-only login flow per
 * the product decision documented there.
 *
 * Storage: JWT lives in localStorage under STORAGE_KEY. We also cache the
 * user object so the header can render "logged in as X" without an extra
 * /me round-trip on every paint.
 *
 * Auth header: getAuthHeaders() returns { Authorization: "Bearer <jwt>" }
 * when a token is present. Use this in any fetch/axios call that needs
 * to be authenticated. There is no global axios interceptor — kept
 * explicit so it's obvious which calls are authenticated.
 */

import axios from "axios";
import { identify, resetAnalytics, track } from "@/lib/analytics";
import { getSource } from "@/lib/attribution";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "http://localhost:8001";
const API = `${BACKEND_URL}/api/auth`;

const STORAGE_KEY = "univicoustic_auth";

// ── localStorage helpers ───────────────────────────────────────────────────
function readStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStored(data) {
  if (data) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
  // Custom event so other tabs / components can react to login/logout.
  // (localStorage 'storage' event only fires across tabs, not in the
  // tab that did the write — hence this synthetic event.)
  window.dispatchEvent(new CustomEvent("uv-auth-changed"));
}

// ── Public API ─────────────────────────────────────────────────────────────

/** Returns the cached { token, user } pair, or null when logged out. */
export function getAuth() {
  return readStored();
}

/** Returns just the JWT, or null. */
export function getToken() {
  return readStored()?.token ?? null;
}

/** Returns just the cached user object, or null. */
export function getUser() {
  return readStored()?.user ?? null;
}

/** True iff a (possibly stale) token is in storage. Doesn't verify the
 *  signature — call /api/auth/me if you need to confirm with the server. */
export function isAuthenticated() {
  return !!getToken();
}

/** Drop in the Authorization header for an authenticated request. */
export function getAuthHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Wipe local credentials. Doesn't call the server (JWTs are stateless). */
export function logout() {
  track("user_logged_out");
  writeStored(null);
  resetAnalytics(); // detach the analytics user so post-logout activity is anonymous again
}

/**
 * Subscribe to auth state changes (login/logout). Returns an unsubscribe fn.
 * Useful for header components that need to re-render when state changes.
 */
export function onAuthChange(handler) {
  const listener = () => handler(readStored());
  window.addEventListener("uv-auth-changed", listener);
  // Cross-tab updates fire 'storage' — handle those too.
  const storageListener = (e) => {
    if (e.key === STORAGE_KEY) handler(readStored());
  };
  window.addEventListener("storage", storageListener);
  return () => {
    window.removeEventListener("uv-auth-changed", listener);
    window.removeEventListener("storage", storageListener);
  };
}

// ── Network calls ──────────────────────────────────────────────────────────

function unwrapError(err) {
  // FastAPI returns {detail: "..."} for HTTPException. Normalise to a string.
  const detail = err?.response?.data?.detail;
  if (typeof detail === "string") return detail;
  return err?.message || "Something went wrong. Please try again.";
}

/**
 * Step 1 of register: ask the backend to send an OTP to `email`.
 * Resolves with { delivered_via, expires_in_minutes, resend_cooldown_seconds, _dev_otp? }.
 * Throws an Error with a user-friendly message on failure.
 */
export async function requestRegisterOtp(email, profile = null, marketingConsent = false) {
  try {
    // `profile` is the optional professional role from the sign-up form. Sent
    // on both register steps so it survives the OTP round-trip; the backend
    // stores it on the user account and stamps it onto every analytics event.
    // marketing_consent is a TOP-LEVEL field, not nested under `profile` —
    // `profile` is a role slug string, so a boolean cannot live inside it.
    // signup_source is the first-touch attribution record (attribution.js).
    // Sent only on registration — it describes where the ACCOUNT came from, so
    // a later login must never overwrite it.
    const res = await axios.post(`${API}/register/request-otp`, {
      email,
      profile,
      marketing_consent: Boolean(marketingConsent),
      signup_source: getSource() || undefined,
    });
    // TEMPORARY OTP bypass: when the backend has OTP_ENABLED=0 it returns a
    // token directly (no email step). Persist it so the caller can navigate
    // straight in. Harmless when OTP is on — no token is present then.
    if (res.data?.token) {
      writeStored({ token: res.data.token, user: res.data.user });
      identify(res.data.user?.id, {
        email: res.data.user?.email,
        marketing_consent: res.data.user?.marketing_consent,
        signup_source: res.data.user?.signup_source,
        signup_campaign: res.data.user?.signup_campaign,
      });
      track("user_registered", {
        method: "otp_bypassed",
        marketing_consent: Boolean(marketingConsent),
        signup_source: res.data.user?.signup_source,
        signup_campaign: res.data.user?.signup_campaign,
      });
    }
    return res.data;
  } catch (err) {
    throw new Error(unwrapError(err));
  }
}

/**
 * Step 2 of register: submit the OTP. On success, stores the JWT + user
 * in localStorage and resolves with the auth object so the caller can
 * navigate immediately.
 */
export async function verifyRegisterOtp(email, otp, profile = null, marketingConsent = false) {
  try {
    const res = await axios.post(`${API}/register/verify-otp`, {
      email,
      otp,
      profile,
      marketing_consent: Boolean(marketingConsent),
      signup_source: getSource() || undefined,
    });
    writeStored(res.data); // { token, user }
    // Stitch the anonymous pre-register session to the new user account.
    identify(res.data.user?.id, {
      email: res.data.user?.email,
      marketing_consent: res.data.user?.marketing_consent,
      signup_source: res.data.user?.signup_source,
      signup_campaign: res.data.user?.signup_campaign,
    });
    track("user_registered", {
      method: "email_otp",
      marketing_consent: Boolean(marketingConsent),
      signup_source: res.data.user?.signup_source,
      signup_campaign: res.data.user?.signup_campaign,
    });
    return res.data;
  } catch (err) {
    throw new Error(unwrapError(err));
  }
}

/**
 * Email-only login. Stores the JWT + user on success.
 * Note: intentionally insecure per product decision — see backend/auth.py.
 */
export async function login(email) {
  try {
    const res = await axios.post(`${API}/login`, { email });
    writeStored(res.data); // { token, user }
    identify(res.data.user?.id, {
      email: res.data.user?.email,
      marketing_consent: res.data.user?.marketing_consent,
      signup_source: res.data.user?.signup_source,
      signup_campaign: res.data.user?.signup_campaign,
    });
    track("user_logged_in", { method: "email_only" });
    return res.data;
  } catch (err) {
    throw new Error(unwrapError(err));
  }
}

/**
 * Verifies the cached token with the server and refreshes the cached user.
 * Returns the user on success, null if the token is missing/expired/invalid
 * (in which case it also clears the local cache so the UI flips to logged-out).
 */
export async function fetchMe() {
  const token = getToken();
  if (!token) return null;
  try {
    const res = await axios.get(`${API}/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    // Refresh the cached user (token unchanged).
    const stored = readStored();
    writeStored({ ...stored, user: res.data });
    return res.data;
  } catch (err) {
    // Token rejected → wipe so the UI redirects to /login.
    if (err?.response?.status === 401) {
      writeStored(null);
    }
    return null;
  }
}
