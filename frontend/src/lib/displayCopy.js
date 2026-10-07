/**
 * displayCopy.js
 * --------------
 * Builds a properly-downsampled, display-resolution copy of a large panel
 * texture, so the browser never has a big shrink left to do at paint time.
 *
 * Why this exists
 *   Panel textures are ~3400×7940 px (27 megapixels). Designer Textile shows
 *   three columns, each ~300 px wide on a typical screen — a ~10× shrink the
 *   browser performs every time it paints the wall. Browsers have two ways to
 *   do that: a careful filter that averages every source pixel, and a cheap
 *   one (bilinear, no mipmaps) that samples a handful and skips the rest.
 *   They usually pick the careful one, but not always — and on a fine,
 *   regular fabric weave the cheap one aliases into visible moiré bands. That
 *   was the intermittent "wavy stripes" bug on Designer Textile, which cleared
 *   whenever anything (e.g. the magnifier) forced a repaint.
 *
 *   Every product uses textures this size; fabric weaves are simply the only
 *   ones fine and regular enough for the aliasing to be visible.
 *
 * How the copy avoids it
 *   Bilinear filtering can't alias at a shrink of 2:1 or less, because its
 *   2×2 sample footprint still covers every source pixel. So:
 *     1. the copy is made by repeated 2:1 halving, each pass alias-free;
 *     2. it is sized to DISPLAY_COPY_SCALE × the column's on-screen width, so
 *        the browser's remaining shrink is ~1.5:1.
 *   Neither step depends on which filter the browser picks, so the result is
 *   correct in every browser, every time.
 *
 * The full-resolution original is still used for zooming in, the magnifier
 * and downloads — see the `data-display-copy` overlay in FlatEmbossedPreview.
 */

/** Copy width as a multiple of the column's on-screen device-pixel width.
 *  1.5 leaves the browser a ~1.5:1 shrink (safe) and lets zoom reach 1.5×
 *  before the copy would be upscaled. */
export const DISPLAY_COPY_SCALE = 1.5;

/** Width is rounded up to a multiple of this, so a window resize only triggers
 *  a regeneration when it moves a whole bucket rather than on every pixel. */
const WIDTH_BUCKET_PX = 64;

/**
 * Target copy width for a panel column `colDevicePx` device pixels wide,
 * or null when the width isn't known yet.
 */
export function displayWidthFor(colDevicePx) {
  if (!colDevicePx || colDevicePx <= 0) return null;
  return Math.ceil((colDevicePx * DISPLAY_COPY_SCALE) / WIDTH_BUCKET_PX) * WIDTH_BUCKET_PX;
}

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/** Release a canvas's backing store now rather than waiting for GC — the
 *  intermediates here run to tens of megabytes. */
function freeCanvas(c) {
  c.width = 0;
  c.height = 0;
}

/**
 * Downsample `blob` to `targetWidth` (height keeps the aspect ratio).
 *
 * Resolves to `{ url, width, height }` — `url` is a blob URL the caller owns
 * and must revoke — or to null when no copy is needed (the source is already
 * small enough for the browser to shrink safely) or anything fails. Null is
 * always safe: callers fall back to the original image.
 *
 * @param {Blob} blob
 * @param {number} targetWidth
 */
export async function makeDisplayCopy(blob, targetWidth) {
  if (!blob || !targetWidth || typeof createImageBitmap !== "function") return null;

  let src;
  try {
    // Full decode, done off the main thread by the browser.
    src = await createImageBitmap(blob);
  } catch {
    return null;
  }

  try {
    // Small enough that the browser's own shrink is already <= 2:1 from the
    // column width — a copy would buy nothing.
    if (src.width <= targetWidth * (2 / DISPLAY_COPY_SCALE)) return null;

    let cur = src;
    let w = src.width;
    let h = src.height;

    // Halve while more than 2× the target. Each pass is a 2:1 shrink, which
    // even plain bilinear handles without skipping pixels.
    while (w > targetWidth * 2) {
      const nw = Math.round(w / 2);
      const nh = Math.round((h * nw) / w);
      const c = makeCanvas(nw, nh);
      const ctx = c.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(cur, 0, 0, nw, nh);
      if (cur !== src) freeCanvas(cur);
      cur = c;
      w = nw;
      h = nh;
    }

    // Final pass to the exact width — at most 2:1 by construction.
    const th = Math.round((h * targetWidth) / w);
    const out = makeCanvas(targetWidth, th);
    const octx = out.getContext("2d");
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = "high";
    octx.drawImage(cur, 0, 0, targetWidth, th);
    if (cur !== src) freeCanvas(cur);

    // JPEG for JPEG sources. Anything else (the emboss composites are PNGs)
    // gets WebP, which keeps transparency; browsers that can't encode WebP
    // return PNG instead, which keeps it too. The panels carry a plain sRGB
    // profile, so re-encoding doesn't shift the colour.
    const type = blob.type === "image/jpeg" ? "image/jpeg" : "image/webp";
    const outBlob = await new Promise((resolve) => out.toBlob(resolve, type, 0.92));
    freeCanvas(out);
    if (!outBlob) return null;

    return { url: URL.createObjectURL(outBlob), width: targetWidth, height: th };
  } catch {
    return null;
  } finally {
    src.close?.();
  }
}
