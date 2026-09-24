import { useState, useEffect, useRef } from "react";

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
 *   - blobUrl   — current displayed blob URL (or null)
 *   - isLoading — true while a fetch is in-flight
 *   - sourceUrl — the input `url` that produced the current `blobUrl`.
 *     Lets callers gate side-effects on "the hook has caught up to the
 *     target" (`sourceUrl === requestedUrl && !isLoading`) without racing
 *     a stale state read.
 *
 * On unmount: the active fetch is aborted and the final Blob URL is revoked.
 *
 * @param {string|null} url  - fully-qualified image URL, or null to deactivate
 * @returns {{ blobUrl: string|null, isLoading: boolean, sourceUrl: string|null }}
 */
export function useBlobPanel(url) {
  const [blobUrl, setBlobUrl] = useState(null);
  const [sourceUrl, setSourceUrl] = useState(null);
  const [isLoading, setIsLoading] = useState(false);

  const currentBlobRef = useRef(null);
  const abortRef = useRef(null);

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
        setBlobUrl(newUrl);
        setSourceUrl(url);
        setIsLoading(false);
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
  }, [url]);

  // ── Effect 2: unmount-only cleanup ────────────────────────────────────
  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort();
      if (currentBlobRef.current) {
        URL.revokeObjectURL(currentBlobRef.current);
        currentBlobRef.current = null;
      }
    };
  }, []);

  return { blobUrl, isLoading, sourceUrl };
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
