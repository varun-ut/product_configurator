/**
 * Pure-canvas 2D homography compositor.
 *
 * Given:
 *   - a base image (the user's room photo)
 *   - a panel texture (one of our wall-panel cutouts)
 *   - four destination points (the wall's quadrilateral in the photo)
 * we render the panel texture warped to fill that quadrilateral, on top
 * of the base photo.  Multiple walls = multiple calls.
 *
 * Why no library:
 *   - glfx.js / OpenCV.js add 80 KB / 10 MB respectively.
 *   - The math here is ~100 lines and well-understood.
 *   - Browser canvas can do affine transforms natively; for perspective
 *     we fall back to triangle-strip approximation: divide the panel into
 *     a grid of small quads, transform each quad's 4 corners with the
 *     homography matrix, then draw each as two triangles using setTransform.
 *     ~32×32 grid produces a render visually indistinguishable from a
 *     true GL-shader perspective warp.
 *
 * Reference for the math:
 *   - Computing a 2D homography from 4 point pairs solves an 8-equation
 *     system Ax=b, where x is the 8 unknowns of the 3×3 matrix (h33=1).
 *   - Once H is known, applying it to any (u,v) in the texture yields the
 *     destination pixel via [x,y,w]=H·[u,v,1] then x/=w, y/=w.
 */

/**
 * Solve a 3×3 homography matrix that maps (0,0)-(1,0)-(1,1)-(0,1)
 * (the unit square — the panel's normalised UV space) to the four
 * destination points dst[0..3] in image space.
 *
 * Returns a 9-element flat array representing the 3×3 matrix in row-major
 * order: [h00 h01 h02 h10 h11 h12 h20 h21 h22], with h22 implicitly 1
 * (we still return it so callers don't have to reason about it).
 *
 * @param {Array<{x:number,y:number}>} dst  Four destination points in
 *     order: top-left, top-right, bottom-right, bottom-left.
 */
export function homographyFromUnitSquare(dst) {
  if (dst.length !== 4) throw new Error("homography: need 4 points");
  // Source points are the corners of the unit square in the SAME order.
  const sx = [0, 1, 1, 0];
  const sy = [0, 0, 1, 1];
  // Build the 8×8 system A·h = b where h = [h00..h21]^T.
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const u = sx[i], v = sy[i], x = dst[i].x, y = dst[i].y;
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]);  b.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]);  b.push(y);
  }
  const h = solve8x8(A, b);
  // Pad to a 3×3 with h22 = 1.
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

/** Apply a 3×3 homography to a 2D point. */
function applyH(H, u, v) {
  const x = H[0] * u + H[1] * v + H[2];
  const y = H[3] * u + H[4] * v + H[5];
  const w = H[6] * u + H[7] * v + H[8];
  return { x: x / w, y: y / w };
}

/** Naïve Gaussian elimination on an 8×8 system.  Tiny matrix, no need for
 *  numpy/lapack heroics — clarity over performance. */
function solve8x8(A, b) {
  const n = 8;
  // Augment.
  const M = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    // Partial pivot.
    let max = Math.abs(M[i][i]); let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(M[k][i]) > max) { max = Math.abs(M[k][i]); maxRow = k; }
    }
    [M[i], M[maxRow]] = [M[maxRow], M[i]];
    if (Math.abs(M[i][i]) < 1e-12) throw new Error("Homography: degenerate quad (collinear points?)");
    // Eliminate below.
    for (let k = i + 1; k < n; k++) {
      const factor = M[k][i] / M[i][i];
      for (let j = i; j <= n; j++) M[k][j] -= factor * M[i][j];
    }
  }
  // Back-substitute.
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = M[i][n];
    for (let j = i + 1; j < n; j++) sum -= M[i][j] * x[j];
    x[i] = sum / M[i][i];
  }
  return x;
}

/**
 * Render the room photo with one or more panels composited onto walls.
 *
 * @param {HTMLCanvasElement} canvas    Where to draw.
 * @param {HTMLImageElement}  baseImage The room photo (already loaded).
 * @param {Array<{texture: HTMLImageElement, corners: Array<{x,y}>}>} layers
 *        For each wall: the panel texture and its 4 destination corners.
 *
 * Mutates the canvas in place.  Caller is responsible for sizing the
 * canvas to baseImage.naturalWidth / .naturalHeight beforehand if they
 * want a 1:1 render, or to the displayed CSS pixel size for screen-only
 * preview.  Coordinates passed in `corners` MUST be in the same units
 * the canvas's drawImage call uses for the base image.
 */
export function renderComposite(canvas, baseImage, layers) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(baseImage, 0, 0, canvas.width, canvas.height);

  // For each wall, divide the texture into a 32×32 grid and draw each
  // grid cell as two triangles via setTransform.  Each triangle is a
  // 6-DOF affine transform we can compute exactly from the 3 mapped
  // corners, which is what setTransform takes.
  const N = 32;  // grid resolution — higher = smoother perspective, slower
  for (const { texture, corners } of layers) {
    if (!texture || corners.length !== 4) continue;
    const H = homographyFromUnitSquare(corners);
    const tw = texture.naturalWidth, th = texture.naturalHeight;
    if (!tw || !th) continue;

    // Pre-compute the warped grid vertices once.
    const grid = new Array((N + 1) * (N + 1));
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        grid[j * (N + 1) + i] = applyH(H, i / N, j / N);
      }
    }

    // Walk the grid drawing two triangles per cell.
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const p00 = grid[j * (N + 1) + i];
        const p10 = grid[j * (N + 1) + (i + 1)];
        const p01 = grid[(j + 1) * (N + 1) + i];
        const p11 = grid[(j + 1) * (N + 1) + (i + 1)];
        // Source UV coords for this cell, in texture pixels.
        const u0 = (i / N) * tw,  u1 = ((i + 1) / N) * tw;
        const v0 = (j / N) * th,  v1 = ((j + 1) / N) * th;

        drawTextureTriangle(ctx, texture, u0, v0, u1, v0, u0, v1, p00, p10, p01);
        drawTextureTriangle(ctx, texture, u1, v0, u1, v1, u0, v1, p10, p11, p01);
      }
    }
  }
}

/**
 * Draw a single texture-mapped triangle.
 *
 * Given source-space coordinates (s1..s3) and destination-space points
 * (d1..d3), set up the affine transform that maps the source triangle
 * onto the destination triangle, clip to the destination triangle, and
 * blit the texture.  This is the standard "triangle texture mapping"
 * trick used by every 2D-canvas perspective hack on the internet.
 */
function drawTextureTriangle(ctx, tex, sx1, sy1, sx2, sy2, sx3, sy3, d1, d2, d3) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(d1.x, d1.y);
  ctx.lineTo(d2.x, d2.y);
  ctx.lineTo(d3.x, d3.y);
  ctx.closePath();
  ctx.clip();

  // Solve for the 2D affine transform a..f such that:
  //   d.x = a*s.x + c*s.y + e
  //   d.y = b*s.x + d*s.y + f
  // for each of the 3 (s,d) pairs.  Solve via Cramer-style 2x2 inversion
  // on the 6×6 system, but it factors cleanly into 3×3 sub-systems.
  const x1 = sx1, y1 = sy1, x2 = sx2, y2 = sy2, x3 = sx3, y3 = sy3;
  const u1 = d1.x, v1 = d1.y, u2 = d2.x, v2 = d2.y, u3 = d3.x, v3 = d3.y;
  const det = x1 * (y2 - y3) - y1 * (x2 - x3) + (x2 * y3 - x3 * y2);
  if (Math.abs(det) < 1e-12) { ctx.restore(); return; }
  const a = (u1 * (y2 - y3) - y1 * (u2 - u3) + (u2 * y3 - u3 * y2)) / det;
  const b = (v1 * (y2 - y3) - y1 * (v2 - v3) + (v2 * y3 - v3 * y2)) / det;
  const c = (x1 * (u2 - u3) - u1 * (x2 - x3) + (x2 * u3 - x3 * u2)) / det;
  const d = (x1 * (v2 - v3) - v1 * (x2 - x3) + (x2 * v3 - x3 * v2)) / det;
  const e = (x1 * (y2 * u3 - y3 * u2) - y1 * (x2 * u3 - x3 * u2) + u1 * (x2 * y3 - x3 * y2)) / det;
  const f = (x1 * (y2 * v3 - y3 * v2) - y1 * (x2 * v3 - x3 * v2) + v1 * (x2 * y3 - x3 * y2)) / det;

  ctx.transform(a, b, c, d, e, f);
  ctx.drawImage(tex, 0, 0);
  ctx.restore();
}
