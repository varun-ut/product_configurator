/**
 * Tier C engine — Claude vision finds the walls, browser does the
 * homography compositing.  Replaces wizartClient.js as the active engine
 * (kept the old file for now in case you ever come back to Wizart; both
 * are referenced by VisualizerPage.jsx via a thin wrapper).
 *
 * Flow:
 *   1. User uploads a room photo (a File object).
 *   2. We base64-encode it and POST to /api/visualize-walls on our own
 *      backend (the API key never leaves the server).
 *   3. Backend asks Claude vision to find each wall's quadrilateral and
 *      returns structured JSON: { image_size, walls: [{ id, type,
 *      corners: [4 points], lighting_direction, confidence, notes }] }.
 *   4. Frontend hands those corners to the homography compositor
 *      (homographyComposite.js) which warps a panel texture into each
 *      quadrilateral on a <canvas>.
 *
 * No image generation happens here — Claude only RETURNS coordinates.
 * The actual pixel-level work happens on the user's GPU/CPU via canvas.
 */

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "http://localhost:8000";

/**
 * Convert a File (e.g. from <input type="file">) to a base64 string with
 * no data: URL prefix.  Server expects raw base64 bytes; we add the prefix
 * back if needed in the future.
 */
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result || "";
      // FileReader.readAsDataURL gives "data:<mime>;base64,<bytes>" — strip the prefix.
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

/**
 * Ask the backend (which asks Claude) to find walls in a room photo.
 *
 * @param {File} roomPhoto
 * @returns {Promise<{
 *   image_size: { w: number, h: number },
 *   walls: Array<{
 *     id: string,
 *     type: 'back'|'left'|'right'|'ceiling'|'other',
 *     corners: Array<{ x: number, y: number }>,  // top-left, TR, BR, BL
 *     lighting_direction: string,
 *     confidence: number,
 *     notes: string,
 *   }>
 * }>}
 */
export async function detectWalls(roomPhoto) {
  if (!roomPhoto) throw new Error("No room photo provided.");

  const image_base64 = await fileToBase64(roomPhoto);
  const image_mime = roomPhoto.type || "image/jpeg";

  const res = await fetch(`${BACKEND_URL}/api/visualize-walls`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ image_base64, image_mime }),
  });

  if (!res.ok) {
    let msg = `Wall detection failed (${res.status})`;
    try {
      const data = await res.json();
      if (data?.detail) msg = data.detail;
    } catch (_) { /* response wasn't JSON */ }
    throw new Error(msg);
  }

  const data = await res.json();
  // Defensive normalization — Claude usually returns the right shape but
  // we don't want a single missing field to kill the page.
  return {
    image_size: data.image_size || { w: 0, h: 0 },
    walls: Array.isArray(data.walls)
      ? data.walls.map((w, i) => ({
          id: w.id || `wall-${i + 1}`,
          type: w.type || "other",
          corners: Array.isArray(w.corners) && w.corners.length === 4
            ? w.corners.map((p) => ({ x: Number(p.x) || 0, y: Number(p.y) || 0 }))
            : [],
          lighting_direction: w.lighting_direction || "ambient",
          confidence: typeof w.confidence === "number" ? w.confidence : 0.5,
          notes: w.notes || "",
        })).filter((w) => w.corners.length === 4)
      : [],
  };
}

export function isClaudeWallEngineConfigured() {
  // Backend is always considered "configured" from the frontend's POV — if
  // the env var is missing on the server, we get a 503 at request time.
  // This stub keeps a parallel API surface to the old wizartClient.
  return true;
}
