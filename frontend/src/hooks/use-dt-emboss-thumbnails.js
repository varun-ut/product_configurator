import { useEffect, useRef, useState } from "react";
import { DESIGNER_TEXTILE_EMBOSS_PATTERNS } from "@/data/skus";

/**
 * Eagerly pre-fetches all DT emboss thumbnail images as Blob URLs the moment
 * Designer Textile becomes the active category, so they are already decoded in
 * memory by the time the user scrolls down to the Emboss section.
 *
 * Thumbnails are fetched progressively — each resolves independently and the
 * returned map is updated as they arrive.  Previously fetched blob URLs are
 * reused across renders (the set is stable once all 21 patterns are loaded).
 *
 * @param {boolean} isActive - true when the DT category is selected
 * @returns {Object} map of { [patternId]: blobUrl }
 */
export function useDTEmbossThumbnails(isActive) {
  const [blobUrls, setBlobUrls] = useState({});
  const blobMapRef = useRef({});        // holds live blob URLs for cleanup
  const controllersRef = useRef({});    // holds AbortControllers per pattern
  const fetchedRef = useRef(false);     // guard: only start fetches once

  // ── Start background fetches on first activation ────────────────────────
  useEffect(() => {
    if (!isActive || fetchedRef.current) return;
    fetchedRef.current = true;

    DESIGNER_TEXTILE_EMBOSS_PATTERNS.forEach((pattern) => {
      if (!pattern.thumbnailUrl || blobMapRef.current[pattern.id]) return;

      const controller = new AbortController();
      controllersRef.current[pattern.id] = controller;

      fetch(pattern.thumbnailUrl, { signal: controller.signal, cache: "default" })
        .then((res) => {
          if (!res.ok || controller.signal.aborted) return null;
          return res.blob();
        })
        .then((blob) => {
          if (!blob || blob.size === 0 || controller.signal.aborted) return;
          const url = URL.createObjectURL(blob);
          blobMapRef.current[pattern.id] = url;
          // Functional update so concurrent resolutions compose correctly
          setBlobUrls((prev) => ({ ...prev, [pattern.id]: url }));
        })
        .catch((err) => {
          if (err.name !== "AbortError") {
            console.warn("[useDTEmbossThumbnails] Failed:", pattern.id, err);
          }
        });
    });
  }, [isActive]);

  // ── Revoke all blob URLs and abort in-flight fetches on unmount ─────────
  useEffect(() => {
    return () => {
      Object.values(controllersRef.current).forEach((c) => c.abort());
      Object.values(blobMapRef.current).forEach((url) => URL.revokeObjectURL(url));
      blobMapRef.current = {};
    };
  }, []);

  return blobUrls;
}
