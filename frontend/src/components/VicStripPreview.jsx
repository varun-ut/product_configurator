/**
 * VicStripPreview
 * ───────────────
 * Simple CSS-layer based preview for VicStrip Panels.
 *
 * No room scene / canvas — just displays the selected panel texture image
 * directly, with the same double-buffer loading behaviour as FlatEmbossedPreview:
 *   1. Spinner + blur appear immediately on selection change.
 *   2. New image decodes silently in the background (MIN_LOADING_MS minimum).
 *   3. After a short POST_LOAD_HOLD_MS, loader drops and new image is revealed.
 *
 * Falls back to a solid colour tile when no textureUrl is provided.
 */

import {
  useState,
  useEffect,
  useRef,
  forwardRef,
  useImperativeHandle,
  memo,
} from "react";
import { toPng } from "html-to-image";
import { saveImageFile } from "@/lib/downloadImageFile";
import { useRenderLog } from "@/hooks/use-render-log";

// ─── Transition timings ───────────────────────────────────────────────────────
/** Minimum ms the preloader is shown after a texture change */
const MIN_LOADING_MS = 400;
/** Extra ms the preloader holds after the image is ready (avoids hard cut) */
const POST_LOAD_HOLD_MS = 150;
/** Solid color shown over the preview while a transition is loading */
const TRANSITION_OVERLAY_COLOR = "#ffffff";

// ─── Component ────────────────────────────────────────────────────────────────
const VicStripPreview = forwardRef(
  (
    {
      /** Resolved URL of the currently selected VicStrip texture image */
      textureUrl,
      /** Hex fallback colour when no image is available */
      fallbackColor = "#CCCCCC",
      /** Human-readable label for download filename */
      designLabel = "vicstrip",
      /** called with (isLoading: boolean) whenever the loading state changes */
      onLoadingChange = null,
    },
    ref
  ) => {
    const previewRef = useRef(null);

    // ── Double-buffer display state ────────────────────────────────────────
    // These stay FROZEN while the loader is visible.
    const [displayedTextureUrl, setDisplayedTextureUrl] = useState(textureUrl);
    const [displayedFallbackColor, setDisplayedFallbackColor] = useState(fallbackColor);

    const [isLoading, setIsLoading] = useState(false);
    const pendingTimerRef = useRef(null);

    // Notify parent when loading state changes
    useEffect(() => {
      onLoadingChange?.(isLoading);
    }, [isLoading, onLoadingChange]);

    // ── Render logging ─────────────────────────────────────────────────────
    useRenderLog("VicStripPreview", {
      textureUrl,
      fallbackColor,
      displayedTextureUrl,
      isLoading,
    });

    // ── Double-buffer transition ───────────────────────────────────────────
    useEffect(() => {
      let cancelled = false;

      const targetTextureUrl = textureUrl;
      const targetFallbackColor = fallbackColor;

      // Nothing changed — skip
      if (
        targetTextureUrl === displayedTextureUrl &&
        targetFallbackColor === displayedFallbackColor
      )
        return;

      // If there's nothing to show at all, clear immediately (no loader)
      if (!targetTextureUrl) {
        if (pendingTimerRef.current) {
          clearTimeout(pendingTimerRef.current);
          pendingTimerRef.current = null;
        }
        setDisplayedTextureUrl(null);
        setDisplayedFallbackColor(targetFallbackColor);
        setIsLoading(false);
        return;
      }

      // ── Color-only change ────────────────────────────────────────────
      // When ONLY fallbackColor changed (textureUrl unchanged), avoid
      // kicking off a loader + redundant decode of the still-displayed
      // image. This happens on every VicStrip panel click: the new
      // colour's hex updates on the first render after the click, but
      // useBlobPanel hasn't produced the new blob URL yet — so
      // textureUrl is still the previous blob. Running the full decode
      // path here would re-decode the OLD blob (visible as a "prev
      // panel" fetch in DevTools' Network tab) for no visual benefit:
      // fallbackColor is only painted when displayedTextureUrl is null.
      // The real texture swap happens once textureUrl actually changes.
      if (targetTextureUrl === displayedTextureUrl) {
        setDisplayedFallbackColor(targetFallbackColor);
        return;
      }

      setIsLoading(true);

      // Cancel any previously scheduled reveal
      if (pendingTimerRef.current) {
        clearTimeout(pendingTimerRef.current);
        pendingTimerRef.current = null;
      }

      // Decode the incoming image silently in the background
      const decodeImage = (src) => {
        const img = new Image();
        img.src = src;
        return img.decode
          ? img.decode().catch(() => {})
          : new Promise((resolve) => {
              img.onload = resolve;
              img.onerror = resolve;
            });
      };

      const _decodeStart = performance.now();
      const minTimePromise = new Promise((resolve) =>
        setTimeout(resolve, MIN_LOADING_MS)
      );

      Promise.all([decodeImage(targetTextureUrl), minTimePromise]).then(() => {
        if (cancelled) return;
        const _decodeMs = (performance.now() - _decodeStart).toFixed(0);
        console.log(
          `%c🖼 [VSP] Asset decoded in ${_decodeMs}ms — holding ${POST_LOAD_HOLD_MS}ms more`,
          "color:#b39ddb"
        );

        pendingTimerRef.current = setTimeout(() => {
          if (cancelled) return;
          pendingTimerRef.current = null;


          setDisplayedTextureUrl(targetTextureUrl);
          setDisplayedFallbackColor(targetFallbackColor);
          setIsLoading(false);
        }, POST_LOAD_HOLD_MS);
      });

      return () => {
        cancelled = true;
        if (pendingTimerRef.current) {
          clearTimeout(pendingTimerRef.current);
          pendingTimerRef.current = null;
        }
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [textureUrl, fallbackColor]);

    // ── Download ───────────────────────────────────────────────────────────
    // Strategy: when a real texture URL is present, fetch it directly so the
    // user gets the FULL-resolution source asset, not the scaled-down version
    // currently rendered on screen.  Fall back to html-to-image only when no
    // texture exists yet (solid-colour fallback state).
    useImperativeHandle(ref, () => ({
      downloadImage: async (overrideFilename, addHeader) => {
        const filename = overrideFilename || `univicoustic-${designLabel}-${Date.now()}.png`;

        // Helper: trigger a download, optionally piping the image source
        // through the addHeader callback first. Cleans up any object URL we
        // created so we don't leak memory.
        const finish = async (rawSrc, isObjectUrl) => {
          let outSrc = rawSrc;
          if (addHeader) {
            try { outSrc = await addHeader(rawSrc); }
            catch (err) { console.error("[VicStripPreview] header failed:", err); }
          }
          saveImageFile(outSrc, filename);
          if (isObjectUrl) setTimeout(() => URL.revokeObjectURL(rawSrc), 15000);
        };

        if (textureUrl) {
          try {
            const res = await fetch(textureUrl, { cache: "no-store" });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            await finish(url, true);
            return;
          } catch (err) {
            console.error("[VicStripPreview] full-res fetch failed, falling back to capture:", err);
            // Fall through to the html-to-image path below.
          }
        }
        const node = previewRef.current;
        if (!node) return;
        try {
          // pixelRatio:4 — ultra-high-res export, ~4x denser than the
          // on-screen render.  Matches FlatEmbossedPreview's download for
          // consistency; stays below 5 to avoid Safari's ~8192² canvas
          // ceiling and to keep memory in check on lower-end mobile devices.
          const dataUrl = await toPng(node, { cacheBust: true, pixelRatio: 4 });
          await finish(dataUrl, false);
        } catch (err) {
          console.error("[VicStripPreview] download failed:", err);
        }
      },
    }));

    return (
      <div
        className="w-full h-full flex items-center justify-center"
        data-testid="vicstrip-preview"
      >
        {/*
         * ── preview-canvas ───────────────────────────────────────────────
         * inline-block so it shrinks to the image dimensions.
         * All overlay layers (loader) are position: absolute inside this.
         */}
        <div
          ref={previewRef}
          style={{
            display: "inline-block",
            position: "relative",
            lineHeight: 0,
          }}
          data-testid="vicstrip-canvas"
        >
          {/* ── Texture image (or solid-colour fallback) ── */}
          {displayedTextureUrl ? (
            <img
              src={displayedTextureUrl}
              alt="VicStrip panel texture"
              style={{
                display: "block",
                maxWidth: "calc(100vw - 420px)",
                maxHeight: "calc(100vh - 80px)",
                objectFit: "contain",
                userSelect: "none",
                pointerEvents: "none",
              }}
              data-testid="vicstrip-texture-img"
            />
          ) : (
            /* Placeholder when no image is ready yet */
            <div
              style={{
                width:  "min(calc(100vw - 420px), 700px)",
                height: "min(calc(100vh - 80px),  500px)",
                backgroundColor: displayedFallbackColor,
                transition: "background-color 0.3s ease",
              }}
              data-testid="vicstrip-color-fallback"
            />
          )}

          {/* ── Preloader overlay (z-index 10) ── */}
          {isLoading && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                zIndex: 10,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: TRANSITION_OVERLAY_COLOR,
              }}
              data-testid="vicstrip-preloader"
            >
              <img src="/UV-loader.png" alt="Loading..." className="uv-loader" />
            </div>
          )}
        </div>
      </div>
    );
  }
);

VicStripPreview.displayName = "VicStripPreview";

// Memoised — see FlatEmbossedPreview for rationale. Props are primitives /
// stable handlers / hook-managed blob URLs, so a shallow compare skips
// re-renders triggered by unrelated parent state changes (pan, zoom, etc.).
export default memo(VicStripPreview);
