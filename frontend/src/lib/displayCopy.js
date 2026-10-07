/**
 * displayCopy.js
 * --------------
 * Builds a properly-downsampled copy of a large panel texture at EXACTLY the
 * pixel size it will be shown at, so the browser has no resizing left to do.
 *
 * Why this exists
 *   Panel textures are ~3400×7940 px (27 megapixels). Designer Textile shows
 *   three columns, each ~300–450 device pixels wide — a ~10× shrink. Left to
 *   the browser, that shrink is done with whatever filter its graphics path
 *   picks, often bilinear with no mipmaps, which samples a few source pixels
 *   and skips the rest. On a fine, regular fabric weave that aliases into
 *   checkerboard / wavy moiré bands — the Designer Textile bug, on screen and
 *   in downloads.
 *
 * Why it's done this way (and not with canvas drawImage)
 *   Correct downsampling must average EVERY source pixel under each output
 *   pixel. A shrink of "only" 2:1 or 1.5:1 with bilinear is NOT enough: a
 *   weave finer than the output can display still aliases. An earlier version
 *   relied on canvas drawImage plus a residual 1.5:1 browser shrink and still
 *   produced visible checkerboarding on real screens, because both steps are
 *   at the mercy of the GPU's filter. So this does it explicitly:
 *     1. area averaging in plain JavaScript — each output pixel is the exact
 *        coverage-weighted mean of the source pixels beneath it (a box
 *        filter). Same arithmetic in every browser, on every graphics card.
 *     2. the copy is built at the exact on-screen device-pixel width, so the
 *        browser paints it 1:1 and never resamples it.
 *   Source pixels are read in strips copied 1:1 (no scaling, so no browser
 *   filter is involved) to keep memory bounded.
 *
 * Used for every consumer that shows a texture smaller than its source:
 *   - the wall, with a copy sized for the current zoom (useBlobPanel);
 *   - downloads, with a copy sized for the 4× export (FlatEmbossedPreview's
 *     downloadImage).
 * The full-resolution original stays on each <img> as `data-full-src`, for
 * the magnifier, which enlarges rather than shrinks.
 */

/** Below this shrink ratio the original is used as-is: there's almost nothing
 *  to average away, and a near-full-size copy would cost a second full-size
 *  image in memory (and a slow encode) for no visible gain. */
const MIN_SHRINK_FOR_COPY = 1.15;

/** Source rows read per strip. Keeps the scratch canvas small (also within
 *  iOS Safari's canvas-size limits) and lets the work pause for the page. */
const STRIP_ROWS = 256;

/**
 * Copy width for a column `colDevicePx` device pixels wide (already multiplied
 * by the zoom level), or null when the width isn't known yet. Exact, not
 * rounded up: the point is a 1:1 paint.
 */
export function displayWidthFor(colDevicePx) {
  if (!colDevicePx || colDevicePx <= 0) return null;
  return Math.max(1, Math.round(colDevicePx));
}

/** Hand control back to the page between strips so a long downsample doesn't
 *  freeze it. Skipped when the page is hidden: nobody is looking, and timers
 *  in hidden tabs are throttled so hard that yielding would stall the build. */
function yieldToPage() {
  if (typeof document !== "undefined" && document.hidden) return null;
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Area-average (box-filter) downsample of `bitmap` to `dw` pixels wide.
 * Exact fractional coverage on both axes; alpha-weighted, so transparent
 * pixels in emboss PNGs don't darken their neighbours.
 */
async function areaDownsample(bitmap, dw) {
  const sw = bitmap.width;
  const sh = bitmap.height;
  const dh = Math.max(1, Math.round((sh * dw) / sw));
  const sx = sw / dw; // source px per output px, horizontally (>= 1)
  const sy = sh / dh;

  // For each source column: the output column it starts in, and the share of
  // it that falls there (the rest falls in the next output column).
  const colOut = new Int32Array(sw);
  const colShare = new Float32Array(sw);
  for (let j = 0; j < sw; j++) {
    const o = Math.min(Math.floor(j / sx), dw - 1);
    colOut[j] = o;
    colShare[j] = Math.min(1, Math.max(0, (o + 1) * sx - j));
  }

  const rowLen = dw * 4;
  const rowAcc = new Float32Array(rowLen);   // one source row, resampled horizontally
  let accCur = new Float32Array(rowLen);     // output row `outRow` (still filling)
  let accNext = new Float32Array(rowLen);    // output row `outRow + 1` (spill-over)
  let outRow = 0;
  const out = new ImageData(dw, dh);
  const od = out.data;
  const area = sx * sy;

  // Write a completed output row: premultiplied sums → plain RGBA.
  const flush = (acc, row) => {
    let q = row * rowLen;
    for (let k = 0; k < rowLen; k += 4, q += 4) {
      const a = acc[k + 3];
      if (a > 0) {
        od[q] = acc[k] / a;
        od[q + 1] = acc[k + 1] / a;
        od[q + 2] = acc[k + 2] / a;
      }
      od[q + 3] = Math.round((a / area) * 255);
    }
  };

  const strip = document.createElement("canvas");
  strip.width = sw;
  strip.height = STRIP_ROWS;
  const sctx = strip.getContext("2d", { willReadFrequently: true });
  sctx.imageSmoothingEnabled = false;

  try {
    for (let y0 = 0; y0 < sh; y0 += STRIP_ROWS) {
      const h = Math.min(STRIP_ROWS, sh - y0);
      sctx.clearRect(0, 0, sw, STRIP_ROWS);
      sctx.drawImage(bitmap, 0, y0, sw, h, 0, 0, sw, h); // 1:1 copy, no filtering
      const d = sctx.getImageData(0, 0, sw, h).data;

      for (let r = 0; r < h; r++) {
        // 1) Resample this source row horizontally into rowAcc.
        rowAcc.fill(0);
        for (let j = 0, p = r * sw * 4; j < sw; j++, p += 4) {
          const alpha = d[p + 3] / 255;
          const R = d[p] * alpha;
          const G = d[p + 1] * alpha;
          const B = d[p + 2] * alpha;
          const o = colOut[j] * 4;
          const w1 = colShare[j];
          rowAcc[o] += R * w1;
          rowAcc[o + 1] += G * w1;
          rowAcc[o + 2] += B * w1;
          rowAcc[o + 3] += alpha * w1;
          const w2 = 1 - w1;
          if (w2 > 0 && o + 4 < rowLen) {
            rowAcc[o + 4] += R * w2;
            rowAcc[o + 5] += G * w2;
            rowAcc[o + 6] += B * w2;
            rowAcc[o + 7] += alpha * w2;
          }
        }

        // 2) Spread it over the output row(s) it overlaps vertically. Source
        //    rows arrive in order, so once one starts in a later output row,
        //    every row before it is complete and can be written out.
        const y = y0 + r;
        const target = Math.min(Math.floor(y / sy), dh - 1);
        while (outRow < target) {
          flush(accCur, outRow);
          const t = accCur;
          accCur = accNext;
          accNext = t;
          accNext.fill(0);
          outRow++;
        }
        const v1 = Math.min(1, Math.max(0, (outRow + 1) * sy - y));
        const v2 = 1 - v1;
        for (let k = 0; k < rowLen; k++) accCur[k] += rowAcc[k] * v1;
        if (v2 > 0 && outRow + 1 < dh) {
          for (let k = 0; k < rowLen; k++) accNext[k] += rowAcc[k] * v2;
        }
      }

      const pause = yieldToPage();
      if (pause) await pause;
    }
    flush(accCur, outRow);
    if (outRow + 1 < dh) flush(accNext, outRow + 1);
    return out;
  } finally {
    strip.width = 0; // release the scratch canvas now, not at GC
    strip.height = 0;
  }
}

/**
 * Downsample `blob` to `targetWidth` (height keeps the aspect ratio).
 *
 * Resolves to `{ url, width, height }` — `url` is a blob URL the caller owns
 * and must revoke — or to null when no copy is needed (the source is barely
 * larger than the target) or anything fails. Null is always safe: callers fall
 * back to the original image.
 *
 * @param {Blob} blob
 * @param {number} targetWidth  device pixels the image will be shown at
 */
export async function makeDisplayCopy(blob, targetWidth) {
  if (!blob || !targetWidth || typeof createImageBitmap !== "function") return null;

  let src;
  try {
    src = await createImageBitmap(blob); // full decode, off the main thread
  } catch {
    return null;
  }

  try {
    const dw = Math.round(targetWidth);
    if (src.width / dw < MIN_SHRINK_FOR_COPY) return null;

    const pixels = await areaDownsample(src, dw);

    const canvas = document.createElement("canvas");
    canvas.width = pixels.width;
    canvas.height = pixels.height;
    canvas.getContext("2d").putImageData(pixels, 0, 0);
    // PNG: lossless, so no compression artefacts get added to a fine weave,
    // and transparency in the emboss composites survives. The panels carry a
    // plain sRGB profile, so re-encoding doesn't shift the colour.
    const outBlob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const { width, height } = canvas;
    canvas.width = 0;
    canvas.height = 0;
    if (!outBlob) return null;

    return { url: URL.createObjectURL(outBlob), width, height };
  } catch {
    return null;
  } finally {
    src.close?.();
  }
}
