import { useRef } from "react";

/**
 * Master switch for ALL in-app render/perf console diagnostics (useRenderLog,
 * logImageLoad, CanvasPreview render logs, the long-task observer).
 *
 * OFF by default in every environment — the logging itself (console.log with
 * object diffing, on every render of a large component) is a measurable perf
 * cost, and it was the main source of dev-mode lag.  To re-enable while
 * debugging, run in the browser console and reload:
 *   localStorage.setItem('uv_debug', '1'); location.reload();
 * Turn back off with:
 *   localStorage.removeItem('uv_debug'); location.reload();
 *
 * Read once at module load (not per-render) so the flag check itself is free.
 */
export const RENDER_DEBUG = (() => {
  try { return localStorage.getItem('uv_debug') === '1'; } catch (_) { return false; }
})();

/**
 * useRenderLog
 * Drop this into any component to get console output on every render:
 *   - render count
 *   - ms since last render
 *   - which tracked values changed and what they changed to
 *
 * Usage:
 *   useRenderLog("MyComponent", { prop1, prop2, someState });
 */
export function useRenderLog(componentName, trackedValues = {}) {
  const renderCount = useRef(0);
  const lastRenderTime = useRef(performance.now());
  const prevValues = useRef(trackedValues);

  // Off unless the uv_debug flag is set (see RENDER_DEBUG).  The useRef calls
  // above still run unconditionally (hooks rule); everything below — the
  // console.log and its object diffing — is skipped when debugging is off.
  if (!RENDER_DEBUG) return;

  renderCount.current += 1;

  const now = performance.now();
  const msSinceLast = (now - lastRenderTime.current).toFixed(1);
  lastRenderTime.current = now;

  const changedKeys = Object.keys(trackedValues).filter(
    (k) => trackedValues[k] !== prevValues.current[k]
  );

  const changed = Object.fromEntries(
    changedKeys.map((k) => [
      k,
      { from: prevValues.current[k], to: trackedValues[k] },
    ])
  );

  prevValues.current = trackedValues;

  const label =
    renderCount.current === 1
      ? `%c⚡ [RENDER] ${componentName}  #1  (mount)`
      : `%c⚡ [RENDER] ${componentName}  #${renderCount.current}  +${msSinceLast}ms`;

  const style =
    renderCount.current === 1
      ? "color:#81c784;font-weight:bold"
      : msSinceLast < 50
      ? "color:#ff8a65;font-weight:bold"  // fast re-render — suspicious
      : "color:#4fc3f7;font-weight:bold";

  if (changedKeys.length > 0) {
    console.log(label, style, changed);
  } else {
    console.log(label, style);
  }
}

/**
 * logImageLoad
 * Call this before starting to load an image.
 * Returns a pair of callbacks: { onLoad, onError }
 * that log the result + timing to the console.
 */
export function logImageLoad(label, src) {
  // Off unless uv_debug is set — no-op callbacks so image loads don't each
  // fire a console.log.
  if (!RENDER_DEBUG) {
    return { onLoad: () => {}, onError: () => {} };
  }
  const start = performance.now();
  return {
    onLoad: () => {
      const ms = (performance.now() - start).toFixed(0);
      console.log(
        `%c🖼 [IMG LOAD] ${label}  ✓ ${ms}ms\n  ${src}`,
        "color:#a5d6a7"
      );
    },
    onError: () => {
      const ms = (performance.now() - start).toFixed(0);
      console.warn(`🖼 [IMG ERR]  ${label}  ✗ ${ms}ms\n  ${src}`);
    },
  };
}
