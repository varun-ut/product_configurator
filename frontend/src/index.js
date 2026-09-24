import ReactDOM from "react-dom/client";
import "@/index.css";
import App from "@/App";
import { initAnalytics } from "@/lib/analytics";
import { captureSource } from "@/lib/attribution";

// Suppress benign ResizeObserver loop notification that React's dev overlay
// incorrectly surfaces as a blocking uncaught error.
const _origOnError = window.onerror;
window.onerror = (msg, source, line, col, err) => {
  if (typeof msg === "string" && msg.includes("ResizeObserver loop")) {
    return true; // prevent the error from bubbling
  }
  return _origOnError?.(msg, source, line, col, err);
};

// ── Page-load performance timing ────────────────────────────────────────────
const _pageStart = performance.now();
window.addEventListener("DOMContentLoaded", () =>
  console.log(`%c⏱ [PERF] DOMContentLoaded  +${(performance.now() - _pageStart).toFixed(0)}ms`, "color:#ffb74d;font-weight:bold")
);
window.addEventListener("load", () =>
  console.log(`%c⏱ [PERF] window.load (all assets)  +${(performance.now() - _pageStart).toFixed(0)}ms`, "color:#ff8a65;font-weight:bold")
);

// StrictMode intentionally removed so dev behaves like production — it
// double-invokes renders/effects in dev only, which made local testing an
// unfaithful proxy for prod (extra renders, doubled effect timing). Removing
// it puts dev and prod on the same footing.
// Initialise analytics BEFORE the first render, not inside App's mount effect.
// React runs child effects before parent ones, so a page component tracking an
// event on mount (configurator_loaded, visualizer_opened) fired while App's
// effect had not yet run — track() saw initialized === false and dropped it
// silently.  Calling it here means analytics is ready before anything mounts.
// The call in App.js is now a no-op (initAnalytics is idempotent) and is kept
// only so App still re-identifies a cached user.
initAnalytics();

// Read the campaign params off the landing URL before React mounts and starts
// rewriting the address bar. First-touch only — see attribution.js.
captureSource();

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<App />);
