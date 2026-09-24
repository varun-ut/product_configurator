/**
 * FlatEmbossedPreview
 * ───────────────────
 * CSS-layer based room-scene preview for Flat / Embossed VMT Panels.
 *
 * Layer stack (bottom → top, z-index order):
 *   2  Pattern layer  — repeating panel columns (portrait mode)
 *   3  Tpatti layer   — optional decorative overlay PNG (below emboss)
 *   4  Emboss layer   — optional emboss/groove overlay PNG (above T-Patti)
 *   5  Furniture      — room photo with transparent wall cutout (DRIVES SIZING)
 *  10  Preloader      — spinner + blur during texture transitions
 *
 * Sizing principle:
 *   The <img> for the furniture is the ONLY element in normal flow
 *   (display: block, max-height: calc(100vh - 220px)).
 *   The wall-canvas wrapper is display: inline-block so it shrink-wraps
 *   to the furniture image. Every other layer is position: absolute and
 *   stretches to 100% of that bounding box.
 *
 * To add a new category:
 *   1. Add an entry to FLAT_EMBOSSED_VMT_CONFIG in src/data/skus.js
 *   2. Drop the furniture PNG, tpatti PNG, and panel textures in
 *      the corresponding /images/flat-embossed-vmt/… folders.
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
import {
  FLAT_EMBOSSED_VMT_CONFIG,
  FLAT_EMBOSSED_VMT_DEFAULT_CONFIG,
} from "@/data/skus";

// ─── Transition timings ───────────────────────────────────────────────────────
/** Minimum ms the preloader is shown after a texture/category change */
const MIN_LOADING_MS = 400;
/** Solid color shown over the preview while a transition is loading.
 *  Swap to any CSS color value — e.g. "#f5f5f5", "rgba(255,255,255,0.9)", etc. */
const TRANSITION_OVERLAY_COLOR = "#ffffff";
/** Extra ms the loader holds AFTER ghost drops + new image is visible beneath.
 *  Gives the browser time to fully composite all layers before revealing.
 *  (Unused after the onLoad-gated visibility refactor — kept for reference.) */
const POST_REVEAL_HOLD_MS = 1000;
/** "Commit grace period" — after Phase 1 reports nonBlobReady=true we delay
 *  the actual setDisplayedXxx() commit by this many ms.  Reason: a single
 *  user click (e.g. picking a new design) often produces TWO separate prop
 *  changes to FlatEmbossedPreview because emboss URL and texture URL flow
 *  through separate useBlobPanel hooks in Configurator and resolve at
 *  different times.  Without the grace period, the first prop change
 *  commits → loader drops → second prop change fires → loader appears again
 *  ("double loader" flash).  With it, if a second prop change arrives
 *  inside the window, Phase 1 re-fires and the timer is cancelled, so we
 *  end up with a single, slightly longer transition instead of two. */
const COMMIT_GRACE_MS = 300;

/**
 * Kicks off background loading for an array of image URLs so they are
 * browser-cached before the user explicitly needs them.
 * Safe to call at any time — duplicates are silently ignored by the browser.
 *
 * @param {string[]} urls
 */
export function preloadImages(urls) {
  urls.forEach((url) => {
    if (!url) return;
    const img = new Image();
    img.src = url;
  });
}

// ─── Component ────────────────────────────────────────────────────────────────
const FlatEmbossedPreview = forwardRef(
  (
    {
      /** backend category id, e.g. "vmd-line-and-texture" */
      categoryId,
      /**
       * Single-texture designs: pass a string URL — it is repeated across every column.
       * Continuous-pattern designs: pass textureUrls (array) instead and leave this null.
       */
      textureUrl = null,
      /**
       * Continuous-pattern designs: array of per-column URLs.
       * Length must equal cfg.repeat (typically 3).
       * e.g. ["…VMD-LT-009-1.jpg", "…VMD-LT-009-2.jpg", "…VMD-LT-009-3.jpg"]
       */
      textureUrls = null,
      /** controlled from the sidebar Switch — mirrors the Embossed Finish toggle pattern */
      showTpatti = false,
      /** URL for the emboss pattern overlay PNG; null = no emboss */
      embossUrl = null,
      /** whether to flip the center column image horizontally */
      flipCenter = false,
      /** called with (isLoading: boolean) whenever the loading state changes */
      onLoadingChange = null,
      /** override the number of vertical panel rows (default: 2 when emboss active, else 1) */
      panelRows = null,
      /** solid CSS color to fill panel columns when no texture is loaded (e.g. ombre base color) */
      panelFallbackColor = null,
    },
    ref
  ) => {
    const wallCanvasRef = useRef(null);

    // ── Stable key for the incoming textureUrls array (avoids array-as-dep issues) ──
    // textureUrls can be null (single designs) or string[] (continuous designs).
    // textureUrl (legacy string prop) is normalised into a single-element array.
    const textureUrlsJson = JSON.stringify(
      textureUrls?.length ? textureUrls : textureUrl ? [textureUrl] : null
    );

    // ── Double-buffer display state ────────────────────────────────────────
    // These are what the render actually uses. They stay FROZEN while the
    // preloader is on screen. New assets decode silently in the background;
    // everything is revealed atomically when the loader drops.
    const [displayedCategoryId, setDisplayedCategoryId] = useState(categoryId);
    // string[] | null — each element is the URL for one column, or null for placeholder
    const [displayedTextureUrls, setDisplayedTextureUrls] = useState(null);
    const [displayedShowTpatti, setDisplayedShowTpatti] = useState(showTpatti);
    const [displayedEmbossUrl, setDisplayedEmbossUrl] = useState(embossUrl);

    // Compute the normalised target texture URLs once — also used by the
    // preload effect and the JSX below.
    const targetTextureUrls = textureUrls?.length
      ? textureUrls
      : textureUrl
      ? [textureUrl]
      : null;
    const targetTextureUrlsJson = JSON.stringify(targetTextureUrls);
    const displayedTextureUrlsJson = JSON.stringify(displayedTextureUrls);

    const hasPendingChange =
      categoryId !== displayedCategoryId ||
      targetTextureUrlsJson !== displayedTextureUrlsJson ||
      showTpatti !== displayedShowTpatti ||
      embossUrl !== displayedEmbossUrl;

    // Cover-all only while the category is actually mid-swap; once the new
    // displayed cfg has been committed, the loader drops to z=5 (wall-only).
    const loadingCoversAll = hasPendingChange && categoryId !== displayedCategoryId;

    // ── Render logging (remove when done profiling) ────────────────────────
    useRenderLog("FlatEmbossedPreview", { categoryId, textureUrl, textureUrls, showTpatti, embossUrl, displayedCategoryId, displayedTextureUrls, displayedEmbossUrl, hasPendingChange });

    // ── Config is derived from DISPLAYED (frozen) category, not the live prop
    const cfg =
      (displayedCategoryId && FLAT_EMBOSSED_VMT_CONFIG[displayedCategoryId]) ||
      FLAT_EMBOSSED_VMT_DEFAULT_CONFIG;

    // ── Furniture / tpatti loading strategy ────────────────────────────────
    // We DO NOT useBlobPanel for these layers. Reasons:
    //   1. The configurator is the actual product — the wall panels. The
    //      furniture is a backdrop photo. Gating the loader on the heaviest
    //      asset in the app (3000×3000 PNG, multi-MB) blocks the user from
    //      seeing their selected pattern. Furniture should catch up
    //      independently, on the browser's own schedule.
    //   2. useBlobPanel uses `cache: 'no-store'`, which means its fetch is
    //      never shared with the <img>'s natural HTTP-cache fetch. The
    //      result: every category change fired TWO requests for the same
    //      furniture PNG (confirmed in the user's network panel).
    //   3. The `<img>` element already implements an atomic swap on src
    //      change: it keeps the OLD bitmap visible until the NEW one is
    //      fully decoded, then swaps. We don't need probe.decode() priming
    //      or opacity-on-load hacks to get the "no scan-line" behaviour as
    //      long as the same <img> element is reused (no `key` change).
    //
    // For download (toPng / html-to-image), we add `crossOrigin="anonymous"`
    // so the canvas serializer can read the bytes via the standard CORS
    // path. CloudFront-served assets typically respond with
    // `Access-Control-Allow-Origin: *`, which makes this work without any
    // server-side change.

    // ── Double-buffer transition (two-phase) ──────────────────────────────
    // Phase 1 (this effect): when target props change, decode the panel
    //   textures + emboss in parallel and wait MIN_LOADING_MS. Furniture +
    //   tpatti are NOT decoded here — they load on their own via plain
    //   <img> elements (browser HTTP-cache + atomic src swap).
    // Phase 2 (next effect): once Phase 1 reports ready, debounce briefly
    //   with COMMIT_GRACE_MS and then commit the displayed state.
    const [nonBlobReady, setNonBlobReady] = useState(true);
    const pendingTargetRef = useRef(null);

    useEffect(() => {
      // Cancellation flag — set to true in cleanup so stale async callbacks
      // from a previous effect run cannot modify state after the effect is gone.
      let cancelled = false;

      const targetCategoryId = categoryId;
      const targetShowTpatti = showTpatti;
      const targetEmbossUrl = embossUrl;

      // (targetTextureUrls / targetTextureUrlsJson / displayedTextureUrlsJson
      //  are computed at the top of the component — see hasPendingChange.)

      // Nothing changed from what is displayed — skip entirely
      if (
        targetCategoryId === displayedCategoryId &&
        targetTextureUrlsJson === displayedTextureUrlsJson &&
        targetShowTpatti === displayedShowTpatti &&
        targetEmbossUrl === displayedEmbossUrl
      ) return;

      // If there's genuinely nothing to show, clear immediately (no loader)
      if (!targetTextureUrls?.length && !targetCategoryId) {
        setDisplayedCategoryId(null);
        setDisplayedTextureUrls(null);
        setDisplayedShowTpatti(targetShowTpatti);
        setDisplayedEmbossUrl(targetEmbossUrl);
        pendingTargetRef.current = null;
        setNonBlobReady(true);
        return;
      }

      // Stash the target so the commit effect knows what to commit when
      // the blob hooks finish.
      pendingTargetRef.current = {
        targetCategoryId,
        targetTextureUrls,
        targetShowTpatti,
        targetEmbossUrl,
      };

      // Freeze: kick off non-blob decodes; loader visibility is already
      // derived from (props vs displayed) so the loader is already on
      // screen by the time this effect runs. We DO NOT call setIsLoading /
      // setLoadingCoversAll any more — they're derived during render.
      setNonBlobReady(false);

      // Helper: decode an image URL silently (background prefetch). Used for
      // panel textures + emboss only; furniture/tpatti are plain <img>
      // elements that the browser fetches and decodes natively.
      const decodeImage = (src) => {
        const img = new Image();
        img.decoding = "async";
        img.src = src;
        return img.decode
          ? img.decode().catch(() => {})
          : new Promise((resolve) => {
              img.onload = resolve;
              img.onerror = resolve;
            });
      };

      const decodePromises = [];

      // Decode new panel textures if they're changing (deduplicate URLs to avoid redundant fetches)
      if (targetTextureUrls?.length && targetTextureUrlsJson !== displayedTextureUrlsJson) {
        const uniqueUrls = [...new Set(targetTextureUrls)];
        uniqueUrls.forEach((url) => decodePromises.push(decodeImage(url)));
      }

      // Decode emboss if it's being introduced or changed
      if (targetEmbossUrl && targetEmbossUrl !== displayedEmbossUrl) {
        decodePromises.push(decodeImage(targetEmbossUrl));
      }

      const minTimePromise = new Promise((resolve) =>
        setTimeout(resolve, MIN_LOADING_MS)
      );

      Promise.all([...decodePromises, minTimePromise]).then(() => {
        if (cancelled) return;
        // Non-blob assets ready. Commit gate (next effect) will fire as
        // soon as the blob hooks also catch up to the target.
        setNonBlobReady(true);
      });

      return () => {
        cancelled = true;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [categoryId, textureUrlsJson, showTpatti, embossUrl]);

    // ── Commit effect ────────────────────────────────────────────────────
    // Triggers when Phase 1 says non-blob assets (textures + emboss) are
    // decoded.  Does NOT wait for furniture/tpatti — they load
    // independently via their plain <img> elements and don't block the
    // panels-readiness signal.
    //
    // COMMIT_GRACE_MS debounce: a click on a design in Configurator
    // results in BOTH `embossUrl` and `textureUrl` (or `textureUrls`)
    // changing, but each one flows through its own `useBlobPanel` in
    // Configurator and resolves at a different time → the props arrive in
    // two batches.  Without the grace period that produced two distinct
    // loader flashes (commit on the first batch, loader returns on the
    // second).  Deferring the commit by COMMIT_GRACE_MS gives any sibling
    // prop change time to land in the same transition, so we end up with
    // one loader cycle instead of two.
    useEffect(() => {
      const pending = pendingTargetRef.current;
      if (!pending) return;
      if (!nonBlobReady) return;

      const commitTimer = setTimeout(() => {
        // Atomic commit. React batches these so the DOM only paints once
        // with the new state.
        setDisplayedCategoryId(pending.targetCategoryId);
        setDisplayedTextureUrls(pending.targetTextureUrls);
        setDisplayedShowTpatti(pending.targetShowTpatti);
        setDisplayedEmbossUrl(pending.targetEmbossUrl);
        pendingTargetRef.current = null;
      }, COMMIT_GRACE_MS);
      return () => clearTimeout(commitTimer);
    }, [nonBlobReady]);

    // ── Download: capture the wall-canvas DOM node to a PNG ──────────────
    // Strategy: just before serializing, swap every cross-origin <img> src
    // with a freshly-fetched blob URL.  Reasons:
    //   1. html-to-image's canvas serializer is sensitive to <picture>
    //      element source-picking + browser cache state.  Even when CORS
    //      is correctly returned by the CDN, the canvas can end up
    //      tainted (broken image in the output PNG) because of stale-
    //      cache hits with mismatched CORS approval.
    //   2. Blob URLs are same-origin to the page, so canvas serialization
    //      is foolproof — no CORS check at all.
    // After toPng resolves, every original src is restored so the live
    // page keeps using the CDN URL (and the browser's cache).
    useImperativeHandle(ref, () => ({
      downloadImage: async (overrideFilename, addHeader, opts = {}) => {
        const node = wallCanvasRef.current;
        if (!node) return;
        const restorers = [];
        try {
          // 0) Wall-only export — locate the room/furniture layer so it can be
          //    excluded from the capture.
          //    We deliberately do NOT hide it on the live DOM.  The capture
          //    below is asynchronous (blob prefetch + a 4x serialize), so any
          //    visible mutation flashes the real preview at the user for the
          //    whole of that window.  Instead the layer is dropped from
          //    html-to-image's INTERNAL clone via the `filter` option, which
          //    leaves the on-screen preview completely untouched.
          //    Removing it is safe even though the furniture <img> is THE
          //    SIZE-DEFINING element (see the layer stack at the top of this
          //    file): html-to-image copies the full computed `cssText` onto
          //    the clone, so the wall-canvas keeps an explicit width/height
          //    and the absolute inset:0 layers still fill it.
          const furnitureEl = opts.wallOnly
            ? (() => {
                const fImg = node.querySelector('img[alt="Room interior with furniture"]');
                return fImg?.closest("picture") || fImg || null;
              })()
            : null;

          // 0b) Wall-only: a panel elevation shows ONE row, but the preview
          //     stacks `panelRowCount` of them so the pattern fills the wall
          //     behind the furniture.  Drop rows 1..n from the clone (again,
          //     never from the live DOM) so exactly row 0 survives.
          //     Every stacked layer tags its rows with data-row-index — the
          //     panel layer AND the emboss layer, which is a SEPARATE stack of
          //     images.  Cropping to the panel row height alone was leaving a
          //     sliver of the next emboss row whenever the two layers' images
          //     had different aspect ratios, which is why this had to stop
          //     being a measurement and become an explicit exclusion.
          const extraRows = opts.wallOnly
            ? new Set(
                Array.from(node.querySelectorAll("[data-row-index]")).filter(
                  (el) => el.dataset.rowIndex !== "0",
                ),
              )
            : new Set();

          // 1) Pre-fetch every cross-origin <img> as a blob, set src to the
          //    blob URL, and remember how to restore.  Also strip <source>
          //    siblings inside <picture> so the browser doesn't re-elect a
          //    cross-origin URL after we change src.
          // In wall-only mode the furniture is filtered out of the capture, so
          // prefetching its (large) bitmap would be pure added latency.
          // Rows excluded from the clone are never serialized, so prefetching
          // their bitmaps would be pure wasted latency.
          const imgs = Array.from(node.querySelectorAll("img")).filter(
            (img) =>
              (!furnitureEl || !furnitureEl.contains(img)) && !extraRows.has(img),
          );
          await Promise.all(
            imgs.map(async (img) => {
              const url = img.currentSrc || img.src;
              if (!url || url.startsWith("blob:") || url.startsWith("data:")) return;
              try {
                const res = await fetch(url, { mode: "cors", credentials: "omit" });
                if (!res.ok) return;
                const blob = await res.blob();
                const blobUrl = URL.createObjectURL(blob);

                const originalSrc = img.getAttribute("src");
                const picture =
                  img.parentElement && img.parentElement.tagName === "PICTURE"
                    ? img.parentElement
                    : null;
                const sourceBackups = [];
                if (picture) {
                  picture.querySelectorAll("source").forEach((s) => {
                    sourceBackups.push({ el: s, srcset: s.getAttribute("srcset") });
                    s.removeAttribute("srcset");
                  });
                }
                img.setAttribute("src", blobUrl);
                // Wait for the blob src to be decoded so toPng captures it.
                await new Promise((resolve) => {
                  if (img.complete && img.naturalWidth > 0) return resolve();
                  const done = () => {
                    img.removeEventListener("load", done);
                    img.removeEventListener("error", done);
                    resolve();
                  };
                  img.addEventListener("load", done);
                  img.addEventListener("error", done);
                });

                restorers.push(() => {
                  if (originalSrc) img.setAttribute("src", originalSrc);
                  else img.removeAttribute("src");
                  sourceBackups.forEach(({ el, srcset }) => {
                    if (srcset) el.setAttribute("srcset", srcset);
                  });
                  URL.revokeObjectURL(blobUrl);
                });
              } catch (err) {
                console.warn("[FlatEmbossedPreview] pre-fetch failed:", url, err);
              }
            }),
          );

          // 2) Serialize. `cacheBust:false` (the default) is required —
          //    appending query strings would corrupt blob: URLs.
          //    `skipFonts:true` silences the cross-origin Google Fonts
          //    SecurityError from html-to-image's CSS rule walk.
          //    `pixelRatio:4` produces an ultra-high-resolution export (~4x
          //    denser than the on-screen render — e.g. a 1200x800 preview
          //    yields a 4800x3200 PNG, suitable for large prints).  Stay
          //    below 5 to avoid hitting Safari's ~8192² canvas ceiling and
          //    to keep memory in check on lower-end mobile devices.
          let dataUrl = await toPng(node, {
            pixelRatio: 4,
            skipFonts: true,
            // Wall-only: drop the furniture from the clone (never from the
            // live DOM — see note above).  `filter` is not invoked for the
            // root node, so the wall-canvas itself is always kept; excluding a
            // node also excludes its children, so `contains` covers the <img>
            // inside the <picture>.
            ...(furnitureEl || extraRows.size
              ? {
                  filter: (n) =>
                    !(furnitureEl && furnitureEl.contains(n)) && !extraRows.has(n),
                }
              : {}),
          });

          // 2b) Wall-only: trim the stacked rows down to one.
          //     The preview deliberately renders `panelRowCount` rows so the
          //     pattern fills the full wall height behind the furniture
          //     cutout (see the panelRowCount comment further down). With the
          //     room hidden every stacked row becomes visible, which isn't
          //     what a panel elevation should show.
          //     Row height is MEASURED from the live first panel <img> rather
          //     than assumed to be boxHeight/panelRowCount: rows are natural
          //     height (width:100%; height:auto; flexShrink:0) and overflow
          //     the container rather than dividing it evenly, so the even-split
          //     assumption would slice through the middle of a row.
          //     Cropping from the top is correct because the row stack is a
          //     flex column anchored at the top of the wall-canvas box.
          if (opts.wallOnly) {
            try {
              // With rows 1..n excluded above, the clone's only content is row 0
              // of each layer — so the crop just has to trim the empty space
              // they left behind.  Measure across EVERY layer's row 0 and keep
              // the tallest: the panel and emboss images can render at slightly
              // different heights, and cropping to the shorter one would slice
              // through the bottom of the taller.
              const firstRows = Array.from(
                node.querySelectorAll('[data-row-index="0"]'),
              );
              const rowH = firstRows.reduce(
                (max, el) => Math.max(max, el.getBoundingClientRect().height),
                0,
              );
              const boxH = node.getBoundingClientRect().height || 0;
              // No rowH → solid-colour fallback, nothing to crop.
              // rowH >= boxH → one row already fills/overflows the box, so the
              // capture is already a single (clipped) row — leave it alone.
              if (rowH && boxH && rowH < boxH) {
                const src = new Image();
                await new Promise((res, rej) => {
                  src.onload = res;
                  src.onerror = rej;
                  src.src = dataUrl;
                });
                const cropH = Math.max(1, Math.round(src.height * (rowH / boxH)));
                const out = document.createElement("canvas");
                out.width = src.width;
                out.height = cropH;
                out.getContext("2d").drawImage(
                  src, 0, 0, src.width, cropH,
                       0, 0, src.width, cropH,
                );
                dataUrl = out.toDataURL("image/png");
              }
            } catch (err) {
              console.warn("[FlatEmbossedPreview] row crop failed, exporting full height:", err);
            }
          }

          if (addHeader) {
            try { dataUrl = await addHeader(dataUrl); }
            catch (err) { console.error("[FlatEmbossedPreview] header failed:", err); }
          }
          saveImageFile(dataUrl, overrideFilename || `univicoustic-design-${Date.now()}.png`);
        } catch (err) {
          console.error("[FlatEmbossedPreview] download failed:", err);
        } finally {
          // 3) Restore the original srcs / sources so the live page keeps
          //    using the CDN URL.  Runs even if toPng threw.
          restorers.forEach((fn) => { try { fn(); } catch {} });
        }
      },
    }));

    // ── Computed style values ─────────────────────────────────────────────
    const hasTpatti = Boolean(cfg.tpatti) && displayedShowTpatti;
    const hasEmboss = Boolean(displayedEmbossUrl);
    // Always render 2 rows so the pattern (and emboss/groove) fills the full wall height
    // regardless of panel aspect ratio. Each row repeats the same column layout:
    //   AAA → AAA / ABA → ABA / ABC → ABC
    // panelRows prop allows callers to override (e.g. small 600x600 tiles need more rows).
    const panelRowCount = panelRows ?? 2;

    // Loader visibility — gated ONLY on whether the panel transition is
    // still in progress.  Furniture/tpatti are decorative and load
    // independently via their own <img> elements; their slowness does NOT
    // hold up the loader / configurator.
    const isLoading = hasPendingChange;

    // Notify parent when loading state changes.
    useEffect(() => {
      onLoadingChange?.(isLoading);
    }, [isLoading, onLoadingChange]);

    // ── Furniture / tpatti opacity gate ───────────────────────────────────
    // The browser's "keep the OLD bitmap visible while the NEW one decodes"
    // promise only holds when there IS a previous bitmap. On initial mount
    // (or when the network is slow enough that the browser starts painting
    // partial PNG rows as bytes arrive), the user can see the image
    // assembling top-to-bottom. We hide the <img> with opacity:0 until its
    // `load` event fires, then fade it in. This is purely cosmetic — it
    // does NOT feed into `isLoading`, so the loader and the wall panels
    // are unaffected by furniture/tpatti decode timing.
    const [furnitureImgLoaded, setFurnitureImgLoaded] = useState(false);
    const [tpattiImgLoaded, setTpattiImgLoaded] = useState(false);

    // Reset the flags when the source URL changes so the new image fades
    // in fresh. Using cfg.furniture / cfg.tpatti (DISPLAYED cfg) means the
    // reset fires only once per actual category swap, not on every render.
    useEffect(() => { setFurnitureImgLoaded(false); }, [cfg.furniture]);
    useEffect(() => { setTpattiImgLoaded(false); }, [cfg.tpatti]);

    // Safety net: if the load event never arrives (corrupt response,
    // browser quirk, etc.) the layer would stay invisible forever. 30 s is
    // a generous bound — enough to cover the user's observed 25 s prod
    // loads, short enough that a truly broken image becomes visible
    // rather than just absent.
    useEffect(() => {
      if (furnitureImgLoaded) return;
      const t = setTimeout(() => setFurnitureImgLoaded(true), 30000);
      return () => clearTimeout(t);
    }, [furnitureImgLoaded, cfg.furniture]);
    useEffect(() => {
      if (tpattiImgLoaded) return;
      const t = setTimeout(() => setTpattiImgLoaded(true), 30000);
      return () => clearTimeout(t);
    }, [tpattiImgLoaded, cfg.tpatti]);

    return (
      <div
        className="w-full h-full flex items-center justify-center"
        data-testid="flat-embossed-preview"
      >

        {/*
         * ── wall-canvas ──────────────────────────────────────────────────
         * display: inline-block  → shrink-wraps to the furniture image
         * position: relative     → absolute children anchor to this element
         * lineHeight: 0          → prevents gap below inline-block img
         */}
        <div
          ref={wallCanvasRef}
          style={{
            display: "inline-block",
            position: "relative",
            lineHeight: 0,
          }}
          data-testid="wall-canvas"
        >
          {/* ── Layer 1: Pattern (z-index 2) ── */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              zIndex: 2,
              overflow: "hidden",
            }}
            data-testid="pattern-layer"
          >
            {/*
             * Portrait-mode panel container:
             * Flex row → N equal-width columns that each fill the full height.
             * background-size: cover tiles the selected texture across each column.
             */}
            <div
              className="flat-embossed-panel-container"
              style={{
                position: "absolute",
                inset: 0,
                display: "flex",
                alignItems: "stretch",
                // Sub-pixel gap filler: paint the same texture on the container so
                // any hairline gap between flex columns at non-100% zoom exposes the
                // same image (not the white page background), making the seam invisible.
                // Only applies when all columns share one texture (single-url designs).
                ...(displayedTextureUrls?.length === 1 && !panelFallbackColor
                  ? {
                      backgroundImage: `url(${displayedTextureUrls[0]})`,
                      backgroundSize: `calc(100% / ${displayedTextureUrls.length > 1 ? displayedTextureUrls.length : cfg.repeat}) auto`,
                      backgroundRepeat: "repeat",
                      backgroundPosition: "top left",
                    }
                  : {}),
              }}
            >
{(() => {
                  // Continuous designs (>1 slice): column count = number of slices (3, 4, …)
                  // Single designs (1 url):         column count = cfg.repeat so they tile correctly
                  const columnCount =
                    displayedTextureUrls?.length > 1
                      ? displayedTextureUrls.length
                      : cfg.repeat;
                  const centerIndex = Math.floor(columnCount / 2);
                  return Array.from({ length: columnCount }).map((_, i) => {
                    const colUrl = displayedTextureUrls
                      ? displayedTextureUrls[i % displayedTextureUrls.length]
                      : null;
                    const isCenter = i === centerIndex;
                    return (
                      <div
                        key={i}
                        className="flat-embossed-panel"
                        style={{
                          position: "relative",
                          width: `calc(100% / ${columnCount})`,
                          height: "100%",
                          flexShrink: 0,
                          overflow: "hidden",
                          backgroundColor: panelFallbackColor || (colUrl ? undefined : "hsl(215 20% 88%)"),
                        }}
                        data-testid={`panel-column-${i}`}
                      >
                        {colUrl && (
                          <div
                            style={{
                              position: "absolute",
                              inset: 0,
                              display: "flex",
                              flexDirection: "column",
                            }}
                          >
                            {Array.from({ length: panelRowCount }).map((__, rowIndex) => (
                              <img
                                key={`${colUrl}-${rowIndex}-${isCenter && flipCenter ? "flipped" : "normal"}`}
                                src={colUrl}
                                alt=""
                                draggable={false}
                                // Marks this <img> as one repeated row of the stack.
                                // The wall-only export keeps row 0 and drops the rest
                                // from html-to-image's clone — see downloadImage.
                                data-row-index={rowIndex}
                                style={{
                                  width: "100%",
                                  height: "auto",
                                  display: "block",
                                  flexShrink: 0,
                                  pointerEvents: "none",
                                  userSelect: "none",
                                  transform: isCenter && flipCenter ? "scaleX(-1)" : undefined,
                                  transformOrigin: "center",
                                }}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}
            </div>
          </div>

          {/* ── Layer 2: T-Patti overlay (z-index 3) — hidden when emboss is active ── */}
          {/* <picture> serves a lossless WebP to browsers that support it
              (every modern browser shipped since ~2020).  Older browsers
              fall back to the original PNG via the <img> child.  Same
              pixels either way (we generated the WebPs with
              `lossless=True`), but the WebP file is typically 1–3% of the
              PNG for tpatti (because tpatti is mostly transparent and
              WebP handles alpha far more efficiently). */}
          {hasTpatti && !hasEmboss && (
            <picture>
              <source
                srcSet={cfg.tpatti?.replace(/\.png(\?.*)?$/i, ".webp$1")}
                type="image/webp"
              />
              <img
                // Point `src` directly at the WebP (not the PNG fallback) so
                // that html-to-image (used by the Compare feature's slot
                // capture) inlines the WebP. html-to-image walks <img src>
                // only — it doesn't understand <picture><source srcSet>, so
                // a PNG fallback here would cause tpatti to be missing or
                // delayed in captured slots. All modern browsers decode WebP
                // (97%+ traffic) so the PNG fallback is unnecessary.
                src={cfg.tpatti?.replace(/\.png(\?.*)?$/i, ".webp$1")}
                alt="T-Patti decorative overlay"
                crossOrigin="anonymous"
                loading="eager"
                onLoad={() => setTpattiImgLoaded(true)}
                onError={() => setTpattiImgLoaded(true)}
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  zIndex: 3,
                  objectFit: "contain",
                  background: "transparent",
                  pointerEvents: "none",
                  userSelect: "none",
                  opacity: tpattiImgLoaded ? 1 : 0,
                  transition: "opacity 150ms ease-out",
                }}
                data-testid="tpatti-layer"
              />
            </picture>
          )}

          {/* ── Layer 3: Emboss overlay (z-index 4) — above T-Patti ── */}
          {hasEmboss && (() => {
            const columnCount =
              displayedTextureUrls?.length > 1
                ? displayedTextureUrls.length
                : cfg.repeat;
            return (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  zIndex: 4,
                  display: "flex",
                  alignItems: "stretch",
                  pointerEvents: "none",
                  userSelect: "none",
                }}
                data-testid="emboss-layer"
              >
                {Array.from({ length: columnCount }).map((_, i) => {
                  const centerIndex = Math.floor(columnCount / 2);
                  const isCenter = i === centerIndex;
                  return (
                    <div
                      key={i}
                      style={{
                        position: "relative",
                        flex: 1,
                        height: "100%",
                        overflow: "hidden",
                      }}
                    >
                      <img
                        src={displayedEmbossUrl}
                        alt=""
                        draggable={false}
                        // Row 0 of the emboss stack — the row the wall-only
                        // export keeps.  This layer is independent of the panel
                        // layer above, so it needs its own row markers.
                        data-row-index={0}
                        style={{
                          width: "100%",
                          height: "auto",
                          display: "block",
                          pointerEvents: "none",
                          userSelect: "none",
                          transform: isCenter && flipCenter ? "scaleX(-1)" : undefined,
                          transformOrigin: "center",
                        }}
                      />
                      {Array.from({ length: panelRowCount - 1 }).map((_, rowIndex) => (
                        <img
                          key={`emboss-${i}-${rowIndex}`}
                          src={displayedEmbossUrl}
                          alt=""
                          draggable={false}
                          // +1 because this map renders rows 1..n-1.
                          data-row-index={rowIndex + 1}
                          style={{
                            width: "100%",
                            height: "auto",
                            display: "block",
                            pointerEvents: "none",
                            userSelect: "none",
                            transform: isCenter && flipCenter ? "scaleX(-1)" : undefined,
                            transformOrigin: "center",
                          }}
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            );
          })()}

          {/*
           * ── Layer 4: Furniture image (z-index 5) ────────────────────────
           * THE SIZE-DEFINING ELEMENT.
           * position: relative keeps it in normal document flow so the
           * inline-block wall-canvas shrink-wraps to its dimensions.
           * max-height: calc(100vh - 220px) prevents viewport overflow.
           * The PNG must have a transparent cut-out where the wall panels
           * are visible so the layers beneath show through.
           */}
          {/* <picture> serves a lossless WebP variant of the room PNG —
              same pixels (we encoded with lossless=True), roughly 25-75%
              of the original size depending on the source. Browsers that
              don't support WebP (essentially none, in 2025+) fall back to
              the original <img src=…png>.  See backend/static/images/.../
              for the source PNGs and the matching .webp companions. */}
          <picture>
            <source
              srcSet={cfg.furniture?.replace(/\.png(\?.*)?$/i, ".webp$1")}
              type="image/webp"
            />
            <img
              // No `key={cfg.furniture}` — same <img> element across
              // category swaps, so the browser keeps the OLD bitmap
              // visible until the NEW one is fully decoded (atomic swap).
              //
              // width / height attributes reserve the aspect ratio so the
              // wall-canvas wrapper has stable dimensions BEFORE bytes
              // arrive.  All furniture sources are square (3000×3000 or
              // 6000×6000), so 1:1 is correct for the whole set.
              //
              // opacity gate (furnitureImgLoaded) hides partial paint on
              // slow / initial-mount loads.  Loader (isLoading) is
              // independent — see the derivation higher up in the file.
              //
              // Responsive width: on mobile (< md breakpoint) the layout
              // has no 360 px sidebar so the image just fills the
              // available space.  At md+ we cap at viewport-minus-sidebar.
              // Tailwind handles the breakpoint; inline style stays for
              // the runtime-derived bits (opacity, transition).
              // Point `src` directly at the WebP (not the PNG fallback) so
              // that html-to-image (used by the Compare feature's slot
              // capture) inlines the WebP. html-to-image walks <img src>
              // only — it doesn't understand <picture><source srcSet>, so a
              // PNG fallback here would cause furniture to be missing or
              // delayed in captured slots. All modern browsers decode WebP
              // (97%+ traffic) so the PNG fallback is unnecessary.
              src={cfg.furniture?.replace(/\.png(\?.*)?$/i, ".webp$1")}
              alt="Room interior with furniture"
              width={3000}
              height={3000}
              crossOrigin="anonymous"
              loading="eager"
              onLoad={() => setFurnitureImgLoaded(true)}
              onError={() => setFurnitureImgLoaded(true)}
              className="block w-auto h-auto max-w-full md:max-w-[calc(100vw-360px)] max-h-[calc(100vh-64px)]"
              style={{
                position: "relative",
                zIndex: 6,
                userSelect: "none",
                pointerEvents: "none",
                opacity: furnitureImgLoaded ? 1 : 0,
                transition: "opacity 150ms ease-out",
              }}
              data-testid="furniture-layer"
            />
          </picture>

          {/* ── Layer 5: Preloader ──
               Category changing  → z=10 (above furniture): full white overlay.
               Same-category swap → z=5 (below furniture z=6): only the wall area
               appears to load; furniture stays visible above. */}
          {isLoading && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                zIndex: loadingCoversAll ? 10 : 5,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: TRANSITION_OVERLAY_COLOR,
              }}
              data-testid="flat-embossed-preloader"
            >
              <img src="/UV-loader.png" alt="Loading..." className="uv-loader" />
            </div>
          )}


        </div>
      </div>
    );
  }
);

FlatEmbossedPreview.displayName = "FlatEmbossedPreview";

// Memoised so it doesn't re-render on every parent (Configurator) render —
// e.g. during pan/zoom or unrelated state changes.  All props are either
// primitives, stable useCallback handlers, or hook-managed blob URLs/arrays
// that only change on an actual selection change, so a shallow compare safely
// skips the heavy multi-layer re-render when nothing relevant changed.
export default memo(FlatEmbossedPreview);
