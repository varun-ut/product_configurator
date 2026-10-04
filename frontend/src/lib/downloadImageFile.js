import { saveAs } from "file-saver";

/**
 * saveImageFile — trigger a browser download of a generated image, reliably on
 * mobile.
 *
 * Why this exists: the previous approach set `a.href = <data: URL>` and clicked
 * a detached anchor. That works on desktop but fails on mobile for our
 * full-scene exports:
 *   - The room-scene composites are several MB. iOS Safari can't navigate to /
 *     download multi-MB `data:` URLs and silently does nothing (this was the
 *     "with furniture, nothing downloaded" bug — the wall-only export is a
 *     small, smooth gradient that stayed under the limit, which is why it
 *     worked).
 *   - iOS Safari ignores the `download` attribute on `data:` URLs.
 *   - Some mobile browsers won't fire `.click()` on a detached anchor.
 *
 * Fix: hand a real Blob to file-saver (already a dependency, used by
 * downloadPanelImages.js). It picks the best per-browser strategy and, crucially,
 * streams a Blob rather than a giant string — removing the size ceiling. `blob:`
 * and `http(s):` sources are passed straight through.
 *
 * @param {string} src       data:, blob:, or http(s) image URL
 * @param {string} filename  suggested download filename
 */
export function saveImageFile(src, filename) {
  const name = filename || "univicoustic-design.png";
  try {
    if (typeof src === "string" && src.startsWith("data:")) {
      saveAs(dataUrlToBlob(src), name);
    } else {
      // blob:/http(s) — file-saver handles these directly.
      saveAs(src, name);
    }
  } catch (err) {
    console.error("[saveImageFile] download failed:", err);
  }
}

function dataUrlToBlob(dataUrl) {
  const comma = dataUrl.indexOf(",");
  const meta = dataUrl.slice(0, comma);
  const data = dataUrl.slice(comma + 1);
  const mime = (meta.match(/data:([^;]+)/) || [])[1] || "image/png";
  const isBase64 = /;base64/i.test(meta);

  const byteString = isBase64 ? atob(data) : decodeURIComponent(data);
  const bytes = new Uint8Array(byteString.length);
  for (let i = 0; i < byteString.length; i++) {
    bytes[i] = byteString.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}
