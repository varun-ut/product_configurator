/**
 * The interactive editor.  After Claude returns wall coordinates we render
 * the room photo on a <canvas>, composite each wall's panel via the
 * homography engine, and overlay draggable corner handles via SVG so the
 * user can nudge any wall whose Claude-detected corners are off.
 *
 * Per-wall controls let the user pick a different panel for each wall
 * (see Q4 of the spec — "the former").  Selection lives here, the parent
 * page stays unaware of individual wall state.
 *
 * Why <canvas> for the panel composite + <svg> overlay for the handles:
 *   - Canvas can do the perspective warp efficiently and exports to PNG.
 *   - SVG handles are crisp at any zoom and don't need a redraw on every
 *     mouse move (we just re-render the canvas, the SVG handles are
 *     React-controlled and React will batch the rerender).
 */

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Download, RefreshCw } from "lucide-react";
import { renderComposite } from "./homographyComposite";
import { SAMPLE_PANELS } from "./samplePanels";

/**
 * Wait for an HTMLImageElement to finish loading.  Returns the same
 * element once `complete` and `naturalWidth > 0`.
 *
 * `crossOrigin` matters when the resulting canvas needs to be exported
 * (toDataURL) AND the image lives on a different host without CORS
 * headers — setting `anonymous` then-failing leaves the canvas tainted.
 * We try anonymous first; if the server doesn't send CORS headers the
 * load fails, so we retry without crossOrigin.  The download won't work
 * in that case but the on-screen render will.
 */
function loadImage(src, withCrossOrigin = true) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (withCrossOrigin) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => {
      if (withCrossOrigin) {
        // Fallback: retry without crossOrigin so the panel at least renders
        // on screen.  Canvas becomes tainted but compositing still works.
        loadImage(src, false).then(resolve, reject);
      } else {
        reject(new Error(`Failed to load ${src}`));
      }
    };
    img.src = src;
  });
}

export default function WallEditor({ roomFile, walls, sourceImageSize, defaultPanel, onReset }) {
  const canvasRef = useRef(null);
  const wrapperRef = useRef(null);

  // Mutable copy of walls — user can drag corners.  Each wall also gets
  // a `panelId` field so different walls can carry different panels.
  const [editableWalls, setEditableWalls] = useState(() =>
    walls.map((w) => ({ ...w, panelId: defaultPanel?.id || SAMPLE_PANELS[0].id }))
  );

  // The original room photo as an HTMLImageElement, ready for canvas blits.
  const [roomImg, setRoomImg] = useState(null);
  // Map of panelId → loaded HTMLImageElement, so we don't re-fetch a panel
  // texture every render when the user just nudges a corner.
  const [panelCache, setPanelCache] = useState({});
  // Which wall's corners are being shown for editing.  Default to wall 0.
  const [activeWallIdx, setActiveWallIdx] = useState(0);
  // Pointer-drag state for the corner handles.
  const dragRef = useRef(null); // { wallIdx, cornerIdx } when dragging

  // Display scale factor — for handles + the canvas.
  const [displaySize, setDisplaySize] = useState({ w: 0, h: 0 });

  // Source coord space (the space Claude returned corner coords in).
  // Anthropic's vision API resizes images before processing, so corners
  // are NOT in the original-photo pixel space — they're in whatever Claude
  // saw.  Claude reports it back as `image_size`, which is what we trust.
  // If Claude didn't return one (defensive fallback), use the photo's
  // natural dimensions as a best-effort guess.
  const sourceW = sourceImageSize?.w || roomImg?.naturalWidth || 0;
  const sourceH = sourceImageSize?.h || roomImg?.naturalHeight || 0;

  // ── Load the room photo once ───────────────────────────────────────────
  useEffect(() => {
    if (!roomFile) return;
    const url = URL.createObjectURL(roomFile);
    let cancelled = false;
    loadImage(url)
      .then((img) => { if (!cancelled) setRoomImg(img); })
      .catch(() => { if (!cancelled) setRoomImg(null); });
    return () => { cancelled = true; URL.revokeObjectURL(url); };
  }, [roomFile]);

  // ── Lazy-load each unique panel texture used by some wall ──────────────
  useEffect(() => {
    const uniqueIds = [...new Set(editableWalls.map((w) => w.panelId))];
    const missing = uniqueIds.filter((id) => !panelCache[id]);
    if (!missing.length) return;
    let cancelled = false;
    Promise.all(
      missing.map(async (id) => {
        const panel = SAMPLE_PANELS.find((p) => p.id === id);
        if (!panel) return [id, null];
        const img = await loadImage(panel.thumbnailUrl).catch(() => null);
        return [id, img];
      })
    ).then((entries) => {
      if (cancelled) return;
      setPanelCache((prev) => {
        const next = { ...prev };
        for (const [id, img] of entries) if (img) next[id] = img;
        return next;
      });
    });
    return () => { cancelled = true; };
  }, [editableWalls, panelCache]);

  // ── Compute displaySize whenever the canvas wrapper is laid out ────────
  useEffect(() => {
    if (!roomImg || !wrapperRef.current) return;
    const wrapper = wrapperRef.current;
    const update = () => {
      const wrapW = wrapper.clientWidth;
      // Aspect-fit: keep the photo's aspect ratio, fill the wrapper width.
      const scale = wrapW / roomImg.naturalWidth;
      setDisplaySize({
        w: Math.round(roomImg.naturalWidth * scale),
        h: Math.round(roomImg.naturalHeight * scale),
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(wrapper);
    return () => ro.disconnect();
  }, [roomImg]);

  // ── Render to canvas whenever inputs change ────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !roomImg || !displaySize.w) return;
    canvas.width = displaySize.w;
    canvas.height = displaySize.h;
    // Corners from Claude live in `sourceImageSize` space, NOT
    // roomImg.naturalWidth — Anthropic resizes images before vision
    // processing.  Scale into display-pixel space accordingly.
    const scaleX = sourceW > 0 ? displaySize.w / sourceW : 1;
    const scaleY = sourceH > 0 ? displaySize.h / sourceH : 1;
    const layers = editableWalls
      .map((w) => {
        const tex = panelCache[w.panelId];
        if (!tex) return null;
        return {
          texture: tex,
          corners: w.corners.map((p) => ({ x: p.x * scaleX, y: p.y * scaleY })),
        };
      })
      .filter(Boolean);
    try {
      renderComposite(canvas, roomImg, layers);
    } catch (err) {
      // Degenerate quad (4 collinear handles, etc.) — clear and show base
      // photo only so the UI doesn't crash; user nudges corners apart.
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(roomImg, 0, 0, canvas.width, canvas.height);
    }
  }, [editableWalls, panelCache, roomImg, displaySize, sourceW, sourceH]);

  // ── Pointer drag for corner handles ────────────────────────────────────
  const onPointerDown = useCallback((wallIdx, cornerIdx, e) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { wallIdx, cornerIdx };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e) => {
    if (!dragRef.current) return;
    const { wallIdx, cornerIdx } = dragRef.current;
    const wrapper = wrapperRef.current;
    if (!wrapper || !roomImg) return;
    const rect = wrapper.getBoundingClientRect();
    const dispX = Math.max(0, Math.min(displaySize.w, e.clientX - rect.left));
    const dispY = Math.max(0, Math.min(displaySize.h, e.clientY - rect.top));
    // Convert back to Claude's coord space — that's where corners live in
    // editableWalls.  Display pixels are derived; source coords are canonical.
    const scaleX = sourceW > 0 ? sourceW / displaySize.w : 1;
    const scaleY = sourceH > 0 ? sourceH / displaySize.h : 1;
    setEditableWalls((prev) => {
      const next = prev.map((w) => ({ ...w, corners: w.corners.map((c) => ({ ...c })) }));
      next[wallIdx].corners[cornerIdx] = {
        x: dispX * scaleX,
        y: dispY * scaleY,
      };
      return next;
    });
  }, [displaySize, roomImg, sourceW, sourceH]);

  const onPointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  // ── Per-wall panel swap ────────────────────────────────────────────────
  const setWallPanel = (wallIdx, panelId) => {
    setEditableWalls((prev) => prev.map((w, i) => (i === wallIdx ? { ...w, panelId } : w)));
  };

  // ── Download the current canvas as PNG ─────────────────────────────────
  const downloadResult = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement("a");
    a.download = `univicoustic-visualizer-${Date.now()}.png`;
    a.href = canvas.toDataURL("image/png");
    a.click();
  };

  // ── Cached display-pixel corners of the active wall, for the SVG handles
  const activeWallDisplayCorners = useMemo(() => {
    if (!roomImg || !displaySize.w || !sourceW || !sourceH) return [];
    const w = editableWalls[activeWallIdx];
    if (!w) return [];
    const sx = displaySize.w / sourceW;
    const sy = displaySize.h / sourceH;
    return w.corners.map((p) => ({ x: p.x * sx, y: p.y * sy }));
  }, [editableWalls, activeWallIdx, displaySize, roomImg, sourceW, sourceH]);

  if (!roomImg) {
    return (
      <div className="h-64 rounded-xl bg-[hsl(var(--secondary))] flex items-center justify-center text-sm text-[hsl(215,16%,47%)]">
        Loading photo…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[hsl(215,25%,27%)]">
          {editableWalls.length} wall{editableWalls.length === 1 ? "" : "s"} detected
        </h3>
        <div className="flex items-center gap-2">
          <Button onClick={onReset} variant="outline" size="sm" data-testid="walleditor-reset">
            <RefreshCw className="h-4 w-4 mr-1.5" /> Start over
          </Button>
          <Button onClick={downloadResult} size="sm" data-testid="walleditor-download">
            <Download className="h-4 w-4 mr-1.5" /> Download
          </Button>
        </div>
      </div>

      {/* Wall tabs — one per detected wall.  The active tab has its 4
          corner handles shown on the canvas overlay; the others' corners
          stay locked but their panel choice is still respected. */}
      {editableWalls.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {editableWalls.map((w, i) => (
            <button
              key={w.id}
              onClick={() => setActiveWallIdx(i)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                i === activeWallIdx
                  ? "bg-[hsl(var(--accent))] text-white"
                  : "bg-[hsl(var(--secondary))] text-[hsl(215,16%,47%)] hover:bg-[hsl(var(--secondary)/0.7)]"
              }`}
              data-testid={`walleditor-tab-${i}`}
            >
              Wall {i + 1} · {w.type}
            </button>
          ))}
        </div>
      )}

      {/* Canvas + SVG overlay.  Two layers:
            - Inner wrapper: rounded + overflow-hidden so the canvas is
              clipped to a nice rounded rectangle.
            - Outer wrapper: positioning context for the SVG handle layer
              that EXTENDS BEYOND the canvas (handles draw at r=12 with
              their centers on the wall corners — when a corner is at the
              very edge of the photo, the handle would be half-clipped if
              we put it inside the overflow:hidden wrapper).  Handle layer
              has overflow:visible and `inset: -16px` so it can spill
              outside the canvas boundary by the radius of one handle.
          The pointer event handlers live on the outer wrapper so a drag
          continues even if the cursor briefly leaves the canvas. */}
      <div
        ref={wrapperRef}
        className="relative select-none"
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        <div className="rounded-xl overflow-hidden border border-[hsl(var(--border))] bg-black">
          <canvas
            ref={canvasRef}
            className="block w-full h-auto"
            data-testid="walleditor-canvas"
          />
        </div>
        {displaySize.w > 0 && (
          <svg
            className="absolute pointer-events-none"
            style={{ top: -16, left: -16, right: -16, bottom: -16 }}
            viewBox={`-16 -16 ${displaySize.w + 32} ${displaySize.h + 32}`}
            preserveAspectRatio="none"
          >
            {/* Quad outline of the active wall — visual cue for where to drag. */}
            {activeWallDisplayCorners.length === 4 && (
              <polygon
                points={activeWallDisplayCorners.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none"
                stroke="hsl(var(--accent))"
                strokeWidth={2}
                strokeDasharray="6 4"
              />
            )}
            {/* 4 draggable handles per active wall.  r=12 + 3px stroke,
                white fill so they're visible against any panel/photo. */}
            {activeWallDisplayCorners.map((p, ci) => (
              <circle
                key={ci}
                cx={p.x}
                cy={p.y}
                r={12}
                fill="white"
                stroke="hsl(var(--accent))"
                strokeWidth={3}
                style={{ cursor: "grab", pointerEvents: "auto", touchAction: "none" }}
                onPointerDown={(e) => onPointerDown(activeWallIdx, ci, e)}
                data-testid={`walleditor-handle-${activeWallIdx}-${ci}`}
              />
            ))}
          </svg>
        )}
      </div>

      <p className="text-xs text-[hsl(215,16%,47%)]">
        Drag the four corners to fine-tune the wall outline if Claude was off.
      </p>

      {/* Dev-only diagnostic strip — keeps me sane while iterating on
          coord-space bugs.  Remove once the visualizer is stable. */}
      {process.env.NODE_ENV !== "production" && (
        <details className="text-[10px] font-mono text-[hsl(215,16%,55%)] bg-[hsl(var(--secondary))] rounded px-3 py-2">
          <summary className="cursor-pointer">debug</summary>
          <div className="pt-2 space-y-0.5">
            <div>roomImg natural: {roomImg.naturalWidth}×{roomImg.naturalHeight}</div>
            <div>Claude image_size: {sourceW}×{sourceH}</div>
            <div>display size: {displaySize.w}×{displaySize.h}</div>
            <div>active wall: {activeWallIdx} · {editableWalls[activeWallIdx]?.type}</div>
            <div>active source corners: {JSON.stringify(editableWalls[activeWallIdx]?.corners)}</div>
            <div>active display corners: {JSON.stringify(activeWallDisplayCorners.map(p => ({ x: Math.round(p.x), y: Math.round(p.y) })))}</div>
            <div>panel cache keys: {Object.keys(panelCache).join(", ") || "(empty)"}</div>
          </div>
        </details>
      )}

      {/* Per-wall panel picker — one row per wall. */}
      <div className="space-y-3 pt-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-[hsl(215,16%,47%)]">
          Panel per wall
        </h4>
        {editableWalls.map((w, i) => (
          <div key={w.id} className="flex items-start gap-3">
            <span className="text-xs font-medium text-[hsl(215,25%,27%)] mt-2 w-20 flex-shrink-0">
              Wall {i + 1}
            </span>
            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-1.5 flex-1">
              {SAMPLE_PANELS.map((panel) => {
                const isSelected = w.panelId === panel.id;
                return (
                  <button
                    key={panel.id}
                    onClick={() => setWallPanel(i, panel.id)}
                    className={`aspect-[2/3] rounded overflow-hidden bg-cover bg-center transition-all ${
                      isSelected
                        ? "ring-2 ring-[hsl(var(--accent))] ring-offset-1"
                        : "ring-1 ring-[hsl(var(--border))] hover:ring-[hsl(215,16%,47%)]"
                    }`}
                    style={{ backgroundImage: `url(${panel.thumbnailUrl})` }}
                    title={panel.name}
                    data-testid={`walleditor-panel-${i}-${panel.id}`}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
