import { useState, useEffect, useRef } from "react";
import { makeDisplayCopy } from "@/lib/displayCopy";

/** How long a zoom or window-size change must settle before the display copy
 *  is rebuilt — so clicking zoom several times, or dragging the zoom slider,
 *  builds one copy at the end rather than one per step. */
const DISPLAY_REGEN_DEBOUNCE_MS = 200;

/* ─── Decode primitive ─────────────────────────────────────────────────────
   We pre-decode each Blob URL via `new Image(); await img.decode();` before
   exposing it to consumers.

   Why not `createImageBitmap` in a worker?
   The browser's image-decode cache is keyed by the URL the decode was
   performed against, not by the raw blob.  `img.decode()` on a probe Image
   set to the Blob URL warms that cache, so when the VISIBLE <img> mounts
   later with the same Blob URL it hits the warm cache and paints atomically.
   `createImageBitmap(blob)` decodes the blob into a stand-alone ImageBitmap
   — fast and off-thread, but the resulting bitmap is not deposited in the
   <img> decode cache, so the visible element still has to decode at paint
   time.  With `decoding="async"` that second decode shows up as a visible
   top-to-bottom scan-line on a 3000×3000 PNG.  We tried the worker briefly;
   the scan-line on production was the immediate symptom.

   `img.decode()` is also already non-blocking on Chromium/Safari for large
   images (the engines schedule the work on an internal decode thread), so
   we get the off-main-thread benefit AND the cache warming. */

/**
 * Fetches any panel image as a Blob URL so that exactly one full-resolution
 * decoded image is held in memory at a time.
 *
 * Pass a fully-qualified URL (or null to deactivate).
 * When url changes:
 *   - The in-flight fetch for the previous url is aborted.
 *   - The old Blob URL stays alive (keeping the preview visible) until the
 *     new image is ready, then an atomic swap occurs — no blank flash.
 *   - cache: 'no-store' prevents 304 responses whose empty body would create
 *     a 0-byte blob that renders nothing.
 *   - Decode happens off the main thread via a singleton Web Worker calling
 *     `createImageBitmap(blob)` (see top of file).
 *
 * Return shape:
 *   - blobUrl    — current displayed blob URL (or null)
 *   - displayUrl — a downsampled copy of `blobUrl` sized for the screen, or
 *     null. Only produced when `options.displayWidth` is passed; see below.
 *   - displayPending — true from an image swap until its copy has settled.
 *   - isLoading  — true while a fetch is in-flight
 *   - sourceUrl  — the input `url` that produced the current `blobUrl`.
 *     Lets callers gate side-effects on "the hook has caught up to the
 *     target" (`sourceUrl === requestedUrl && !isLoading`) without racing
 *     a stale state read.
 *
 * Display copy (opt-in): pass `{ displayWidth }` and the hook also builds a
 * properly-downsampled copy of each image at that width (see
 * lib/displayCopy.js for why — in short, a browser shrinking a 27 MP fabric
 * texture ~10× at paint time can alias it into moiré bands). `blobUrl` keeps
 * the full-resolution original for zoom, the magnifier and downloads.
 *   - The copy is built AFTER the swap, not before, so it runs in parallel
 *     with the preview's own transition loader rather than in front of it.
 *     `displayPending` lets the preview hold its reveal for it (capped), so
 *     a slow build can't flash the raw image first.
 *   - `displayUrl` is null until it's ready, after a fabric change, and
 *     whenever no copy is needed or building one failed. Null always means
 *     "use the original" — never a broken image.
 *   - Changing `displayWidth` (zoom, or a window resize) rebuilds the copy from the
 *     already-fetched blob — no refetch, and `blobUrl` doesn't change.
 * Without the option the hook behaves exactly as it always has.
 *
 * On unmount: the active fetch is aborted and the final Blob URLs are revoked.
 *
 * @param {string|null} url  - fully-qualified image URL, or null to deactivate
 * @param {{ displayWidth?: number|null }} [options]
 * @returns {{ blobUrl: string|null, displayUrl: string|null, displayPending: boolean, isLoading: boolean, sourceUrl: string|null }}
 */
export function useBlobPanel(url, { displayWidth = null } = {}) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [displayUrl, setDisplayUrl] = useState(null);
  // True from an image swap until that image's display copy has settled
  // (built, not needed, or failed). Lets the preview hold its reveal so the
  // first frame after a fabric change is the clean copy, not the raw 27 MP
  // image — see FlatEmbossedPreview's commit effect.
  const [displayPending, setDisplayPending] = useState(false);
  const [sourceUrl, setSourceUrl] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const currentBlobRef = useRef(null);
  const abortRef = useRef(null);

  // ── Display-copy bookkeeping (only used when displayWidth is passed) ──
  const sourceBlobRef = useRef(null);      // fetched Blob, kept to rebuild copies
  const currentDisplayRef = useRef(null);  // blob URL of the current copy
  const copyWidthRef = useRef(null);       // width the current copy was built at
  const displayGenRef = useRef(0);         // newest request wins; older results are dropped
  const displayWidthRef = useRef(displayWidth);
  displayWidthRef.current = displayWidth;

  /** Swap in a new display copy (or none), revoking the one it replaces. */
  const setDisplayCopy = (nextUrl, width) => {
    const old = currentDisplayRef.current;
    currentDisplayRef.current = nextUrl;
    copyWidthRef.current = width;
    setDisplayUrl(nextUrl);
    // Safe even if an <img> is still showing it: revoking a blob URL doesn't
    // unload an image that has already decoded — same as the full-res swap.
    if (old && old !== nextUrl) URL.revokeObjectURL(old);
  };

  /** Build a copy of `blob` at `width`, unless a newer request or a new image
   *  overtakes it first. */
  const buildDisplayCopy = (blob, width) => {
    const gen = ++displayGenRef.current;
    const stale = () => gen !== displayGenRef.current || blob !== sourceBlobRef.current;
    makeDisplayCopy(blob, width)
      .then(async (copy) => {
        if (stale()) {
          if (copy) URL.revokeObjectURL(copy.url);
          return;
        }
        // Pre-decode so the overlay paints atomically, same as the original.
        if (copy) {
          try {
            const probe = new Image();
            probe.src = copy.url;
            await probe.decode();
          } catch {}
        }
        if (stale()) {
          if (copy) URL.revokeObjectURL(copy.url);
          return;
        }
        setDisplayCopy(copy ? copy.url : null, width);
        setDisplayPending(false);
      })
      .catch(() => {
        // makeDisplayCopy already swallows its own errors; this is belt and
        // braces so a surprise throw can't leave the reveal waiting.
        if (!stale()) setDisplayPending(false);
      });
  };

  // ── Effect 1: fetch whenever url changes ───────────────────────────────
  useEffect(() => {
    if (!url) {
      // Deactivated — immediately clear the displayed blob so a stale image
      // from the previous url doesn't bleed through when the hook is reused
      // for a different product/category.
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
      if (currentBlobRef.current) {
        URL.revokeObjectURL(currentBlobRef.current);
        currentBlobRef.current = null;
      }
      sourceBlobRef.current = null;
      displayGenRef.current++; // drop any copy still being built
      setDisplayCopy(null, null);
      setDisplayPending(false);
      setBlobUrl(null);
      setSourceUrl(null);
      setIsLoading(false);
      return;
    }

    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    setIsLoading(true);

    fetch(url, { signal: controller.signal, cache: "no-store" })
      .then((res) => {
        if (controller.signal.aborted) return null;
        if (!res.ok) throw new Error(`Panel fetch failed: ${res.status} ${url}`);
        return res.blob();
      })
      .then(async (blob) => {
        if (!blob || controller.signal.aborted) return;
        if (blob.size === 0) {
          console.warn("[useBlobPanel] Empty blob received for", url);
          setIsLoading(false);
          return;
        }
        const newUrl = URL.createObjectURL(blob);
        // Decode before exposing — warms the browser's image-decode cache
        // for THIS blob URL so the visible <img src={newUrl}> later paints
        // atomically rather than scanning in top-to-bottom.  decode()
        // failure is non-fatal — fall through and expose the blob URL
        // anyway; the <img> tag will surface a real error if the bytes
        // are corrupt.
        try {
          const probe = new Image();
          probe.src = newUrl;
          await probe.decode();
        } catch {}
        if (controller.signal.aborted) {
          URL.revokeObjectURL(newUrl);
          return;
        }
        // Atomic swap: revoke old only when new is ready — no blank flash
        if (currentBlobRef.current) {
          URL.revokeObjectURL(currentBlobRef.current);
        }
        currentBlobRef.current = newUrl;
        sourceBlobRef.current = blob;
        // The previous image's copy goes in the same batch as the swap, so a
        // new blobUrl is never paired with the old image's copy.
        displayGenRef.current++;
        setDisplayCopy(null, null);
        // Same batch as the swap, so the preview never sees the new image
        // without also knowing its copy is on the way.
        setDisplayPending(Boolean(displayWidthRef.current));
        setBlobUrl(newUrl);
        setSourceUrl(url);
        setIsLoading(false);
        // Build the new copy after the swap rather than before it: it lands
        // while the preview's transition loader is still up, so it costs the
        // user nothing.
        if (displayWidthRef.current) buildDisplayCopy(blob, displayWidthRef.current);
      })
      .catch((err) => {
        if (err.name !== "AbortError") {
          console.error("[useBlobPanel] Failed to load panel:", err);
          setIsLoading(false);
        }
      });

    // Only abort in-flight fetch on url change — keep old blob visible
    return () => {
      controller.abort();
    };
    // Runs on url change only. buildDisplayCopy / setDisplayCopy are
    // recreated each render but touch nothing except refs and state setters,
    // and the width is read from displayWidthRef, so there's nothing stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // ── Effect 2: rebuild the display copy when the target width changes ───
  // Debounced so a run of zoom clicks, a slider drag or a window-edge drag
  // across several width buckets builds one copy at the end, not one per
  // bucket. Rebuilds from the blob already in memory — no refetch.
  useEffect(() => {
    if (!displayWidth) return;
    if (displayWidth === copyWidthRef.current) return;
    const blob = sourceBlobRef.current;
    if (!blob) return; // nothing loaded yet; the fetch path picks the width up
    const t = setTimeout(() => buildDisplayCopy(blob, displayWidth), DISPLAY_REGEN_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayWidth]);

  // ── Effect 3: unmount-only cleanup ────────────────────────────────────
  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
      if (currentBlobRef.current) {
        URL.revokeObjectURL(currentBlobRef.current);
        currentBlobRef.current = null;
      }
      // A counter, not a DOM ref — bumping the live value is the point: any
      // copy still being built sees it changed and discards its result.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      displayGenRef.current++;
      if (currentDisplayRef.current) {
        URL.revokeObjectURL(currentDisplayRef.current);
        currentDisplayRef.current = null;
      }
    };
  }, []);

  return { blobUrl, displayUrl, displayPending, isLoading, sourceUrl };
}

/**
 * Parallel version of useBlobPanel for an array of URLs (e.g. the 3 slices of
 * a continuous-pattern design).  Each URL is managed independently with its
 * own AbortController and blob lifecycle.  The returned `blobUrls` array has
 * the same length and order as the input; entries are null until the image is
 * ready.  `isLoading` is true while ANY fetch is in progress.
 *
 * @param {string[]|null} urls
 * @returns {{ blobUrls: (string|null)[], isLoading: boolean }}
 */
export function useMultiBlobPanels(urls) {
  const urlsJson = JSON.stringify(urls);
  const [blobUrls, setBlobUrls] = useState([]);
  const [loadingCount, setLoadingCount] = useState(0);

  const blobRefs = useRef([]);
  const abortRefs = useRef([]);

  useEffect(() => {
    if (!urls?.length) {
      // Deactivated — revoke any live blobs so they don't bleed through
      abortRefs.current.forEach((c) => c?.abort());
      blobRefs.current.forEach((u) => u && URL.revokeObjectURL(u));
      blobRefs.current = [];
      abortRefs.current = [];
      setBlobUrls([]);
      setLoadingCount(0);
      return;
    }

    // Abort any previous fetches and revoke their blob URLs
    abortRefs.current.forEach((c) => c?.abort());
    blobRefs.current.forEach((u) => u && URL.revokeObjectURL(u));
    blobRefs.current = Array(urls.length).fill(null);
    abortRefs.current = [];

    setBlobUrls(Array(urls.length).fill(null));
    setLoadingCount(urls.length);

    urls.forEach((url, i) => {
      const controller = new AbortController();
      abortRefs.current[i] = controller;

      fetch(url, { signal: controller.signal, cache: "no-store" })
        .then((res) => {
          if (controller.signal.aborted) return null;
          if (!res.ok) throw new Error(`Multi-blob fetch failed: ${res.status} ${url}`);
          return res.blob();
        })
        .then(async (blob) => {
          if (!blob || blob.size === 0 || controller.signal.aborted) return;
          const newUrl = URL.createObjectURL(blob);
          // Pre-decode against the blob URL so the visible <img src={newUrl}>
          // hits a warm decode cache and paints atomically.
          try {
            const probe = new Image();
            probe.src = newUrl;
            await probe.decode();
          } catch {}
          if (controller.signal.aborted) {
            URL.revokeObjectURL(newUrl);
            return;
          }
          if (blobRefs.current[i]) URL.revokeObjectURL(blobRefs.current[i]);
          blobRefs.current[i] = newUrl;
          setBlobUrls((prev) => {
            const next = [...prev];
            next[i] = newUrl;
            return next;
          });
          setLoadingCount((n) => Math.max(0, n - 1));
        })
        .catch((err) => {
          if (err.name !== "AbortError") {
            console.error("[useMultiBlobPanels] Failed to load:", url, err);
            setLoadingCount((n) => Math.max(0, n - 1));
          }
        });
    });

    return () => {
      abortRefs.current.forEach((c) => c?.abort());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlsJson]);

  // Unmount cleanup
  useEffect(() => {
    return () => {
      abortRefs.current.forEach((c) => c?.abort());
      blobRefs.current.forEach((u) => u && URL.revokeObjectURL(u));
    };
  }, []);

  return { blobUrls, isLoading: loadingCount > 0 };
}
