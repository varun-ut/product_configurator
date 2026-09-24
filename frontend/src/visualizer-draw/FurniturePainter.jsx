/**
 * FurniturePainter — phase 2 of the manual-mask wall visualizer.
 *
 * The user paints over anything in the photo that should NOT be covered
 * by panels (furniture, lamps, decorations, the cat).  The painted area
 * becomes a binary mask we hand to the compositor in phase 4.
 *
 * Tools:
 *   - Brush       paint with a circular cursor at adjustable size
 *   - Eraser      same as brush but in destination-out mode (un-paints)
 *   - Lasso       click successive points to define a polygon, double-click
 *                 (or click first point) to close + fill
 *
 * Zoom / pan:
 *   - Mouse wheel zooms (clamped 1..6×).  Cursor is the zoom focal point.
 *   - Hold Space + drag, or middle-click drag, to pan.
 *   - Reset view button to snap back to fit-to-screen.
 *
 * Undo:
 *   - Each completed stroke (mouseup or lasso close) snapshots the mask
 *     onto an undo stack capped at 20 entries.  Ctrl+Z or the Undo button
 *     pops one off.
 *
 * Two canvases under the hood:
 *   - viewCanvas: visible to the user; shows the photo + a translucent
 *     red overlay everywhere the mask is painted.  Re-drawn on every
 *     stroke or zoom/pan change.
 *   - maskCanvasRef.current: offscreen, white-on-black mask in the
 *     ORIGINAL photo's pixel space.  This is the canonical mask we hand
 *     to the compositor; alpha-1 wherever the user painted.
 *
 * The mask lives in original-photo space (not display space) so it stays
 * usable regardless of how big the photo is on the user's screen.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Brush, Eraser, Lasso, Hand, ZoomIn, ZoomOut, Maximize2, Undo2, Trash2, ArrowRight } from "lucide-react";

const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
const UNDO_LIMIT = 20;

export default function FurniturePainter({ photoFile, onConfirm, onBack }) {
  const wrapperRef = useRef(null);          // size-defining wrapper
  const viewCanvasRef = useRef(null);       // the visible composited canvas
  const maskCanvasRef = useRef(document.createElement("canvas"));  // offscreen mask
  const photoImgRef = useRef(null);         // loaded HTMLImageElement of the photo

  const [tool, setTool] = useState("brush");           // 'brush' | 'eraser' | 'lasso' | 'pan'
  const [brushSize, setBrushSize] = useState(40);      // in original-photo pixels
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [, setRenderTick] = useState(0);                // forces re-render after stroke
  const undoStackRef = useRef([]);                      // ImageData snapshots
  const isPaintingRef = useRef(false);
  const lastPointRef = useRef(null);                    // last brush point (display space)
  const lassoPointsRef = useRef([]);                    // {x,y} list for current lasso
  const isPanningRef = useRef(false);
  const panStartRef = useRef(null);                     // {clientX, clientY, startPan}
  const spaceHeldRef = useRef(false);
  const [hoverPoint, setHoverPoint] = useState(null);   // for cursor circle preview
  const [displaySize, setDisplaySize] = useState({ w: 0, h: 0 });
  const [imageReady, setImageReady] = useState(false);

  // ─── Load photo + size mask canvas to original photo dimensions ──────────
  useEffect(() => {
    if (!photoFile) return;
    let cancelled = false;
    const url = URL.createObjectURL(photoFile);
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      photoImgRef.current = img;
      // Mask canvas matches the ORIGINAL photo's pixel space — that's the
      // canonical resolution downstream code (compositor, downloads) uses.
      const mask = maskCanvasRef.current;
      mask.width = img.naturalWidth;
      mask.height = img.naturalHeight;
      const mctx = mask.getContext("2d");
      mctx.clearRect(0, 0, mask.width, mask.height);
      undoStackRef.current = [];
      setImageReady(true);
    };
    img.onerror = () => { if (!cancelled) setImageReady(false); };
    img.src = url;
    return () => { cancelled = true; URL.revokeObjectURL(url); };
  }, [photoFile]);

  // ─── Track wrapper size so the canvas fills the available space ─────────
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || !imageReady) return;
    const update = () => {
      const img = photoImgRef.current;
      if (!img) return;
      const wrapW = wrapper.clientWidth;
      // Aspect-fit to width.  The visualizer page itself owns vertical
      // scroll, so we don't try to fit the photo into a fixed height.
      const scale = wrapW / img.naturalWidth;
      setDisplaySize({
        w: Math.round(img.naturalWidth * scale),
        h: Math.round(img.naturalHeight * scale),
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(wrapper);
    return () => ro.disconnect();
  }, [imageReady]);

  // ─── Re-render the visible canvas whenever something changes ─────────────
  const renderView = useCallback(() => {
    const view = viewCanvasRef.current;
    const photo = photoImgRef.current;
    const mask = maskCanvasRef.current;
    if (!view || !photo || !displaySize.w) return;
    view.width = displaySize.w;
    view.height = displaySize.h;
    const ctx = view.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.clearRect(0, 0, view.width, view.height);

    // Apply zoom/pan transform once around all draws.
    ctx.save();
    ctx.translate(pan.x, pan.y);
    ctx.scale(zoom, zoom);

    // Draw the photo first (fills the canvas at zoom=1).
    ctx.drawImage(photo, 0, 0, displaySize.w, displaySize.h);

    // Overlay the mask in semi-transparent red so the user sees what
    // they've painted.  Mask is in original-photo space → scale to display.
    ctx.save();
    ctx.globalAlpha = 0.45;
    // Tint the mask red: draw to an offscreen, then drawImage with the
    // mask used as a `source-in` alpha to a red rect.  Simpler approach:
    // draw the mask in red by going through a temp canvas.
    const tinted = getTintedMaskCanvas(mask);
    ctx.drawImage(tinted, 0, 0, displaySize.w, displaySize.h);
    ctx.restore();

    ctx.restore();

    // Cursor circle preview only for brush + eraser.  Pan / lasso don't
    // need it; pan uses a real grab cursor, lasso has its own polygon
    // preview drawn below.
    if (hoverPoint && (tool === "brush" || tool === "eraser") && !isPanningRef.current) {
      ctx.save();
      ctx.beginPath();
      // brushSize is in original-photo pixels; convert to display pixels
      // via the photo→display scale, then multiply by zoom for visual size.
      const photoToDisp = displaySize.w / photo.naturalWidth;
      const r = (brushSize * photoToDisp * zoom) / 2;
      ctx.arc(hoverPoint.x, hoverPoint.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = tool === "eraser" ? "#ff3b30" : "#3b82f6";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }

    // Lasso outline preview.
    if (tool === "lasso" && lassoPointsRef.current.length > 0) {
      ctx.save();
      ctx.strokeStyle = "#3b82f6";
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      const pts = lassoPointsRef.current;
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      if (hoverPoint) ctx.lineTo(hoverPoint.x, hoverPoint.y);
      ctx.stroke();
      // Mark vertices.
      ctx.setLineDash([]);
      ctx.fillStyle = "#3b82f6";
      for (const p of pts) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  }, [displaySize, zoom, pan, brushSize, tool, hoverPoint]);

  // Fire renderView whenever its inputs change.
  useEffect(() => { renderView(); }, [renderView]);
  // Also re-render on every "force render" tick (after a stroke commits).
  useEffect(() => { renderView(); /* eslint-disable-next-line */ }, [/* renderTick handled by setRenderTick wakeup */]);

  // ─── Input → canvas coordinate helpers ───────────────────────────────────
  // Convert a pointer event to (a) display-pixel space (for the cursor
  // circle and lasso drawing) and (b) ORIGINAL photo space (for drawing
  // into the canonical mask).
  const eventToDisplayPoint = (e) => {
    const view = viewCanvasRef.current;
    const rect = view.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * view.width) / rect.width,
      y: ((e.clientY - rect.top) * view.height) / rect.height,
    };
  };
  const displayToPhotoPoint = (dp) => {
    const photo = photoImgRef.current;
    if (!photo) return dp;
    // Reverse the canvas zoom/pan transform.
    const ux = (dp.x - pan.x) / zoom;
    const uy = (dp.y - pan.y) / zoom;
    // Reverse the photo→display scale.
    const sx = photo.naturalWidth / displaySize.w;
    const sy = photo.naturalHeight / displaySize.h;
    return { x: ux * sx, y: uy * sy };
  };

  // ─── Undo machinery ──────────────────────────────────────────────────────
  const snapshotMask = () => {
    const mask = maskCanvasRef.current;
    const ctx = mask.getContext("2d");
    const data = ctx.getImageData(0, 0, mask.width, mask.height);
    const stack = undoStackRef.current;
    stack.push(data);
    if (stack.length > UNDO_LIMIT) stack.shift();
  };
  const undo = () => {
    const stack = undoStackRef.current;
    if (!stack.length) return;
    const last = stack.pop();
    const mask = maskCanvasRef.current;
    mask.getContext("2d").putImageData(last, 0, 0);
    setRenderTick((n) => n + 1);
  };
  const clearAll = () => {
    snapshotMask();
    const mask = maskCanvasRef.current;
    mask.getContext("2d").clearRect(0, 0, mask.width, mask.height);
    setRenderTick((n) => n + 1);
  };

  // ─── Drawing primitives (operate on the offscreen mask in photo space) ──
  const paintBrushSegment = (fromPhoto, toPhoto, eraser) => {
    const mask = maskCanvasRef.current;
    const ctx = mask.getContext("2d");
    ctx.save();
    ctx.globalCompositeOperation = eraser ? "destination-out" : "source-over";
    ctx.fillStyle = "white";
    ctx.strokeStyle = "white";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = brushSize;
    ctx.beginPath();
    ctx.moveTo(fromPhoto.x, fromPhoto.y);
    ctx.lineTo(toPhoto.x, toPhoto.y);
    ctx.stroke();
    // Also draw an explicit dot at "to" so a single click registers a mark.
    ctx.beginPath();
    ctx.arc(toPhoto.x, toPhoto.y, brushSize / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  const fillLassoPolygon = () => {
    const pts = lassoPointsRef.current;
    if (pts.length < 3) { lassoPointsRef.current = []; return; }
    snapshotMask();
    const mask = maskCanvasRef.current;
    const ctx = mask.getContext("2d");
    ctx.save();
    ctx.fillStyle = "white";
    ctx.beginPath();
    // Convert each lasso point (display space) to photo space.
    const first = displayToPhotoPoint(pts[0]);
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < pts.length; i++) {
      const p = displayToPhotoPoint(pts[i]);
      ctx.lineTo(p.x, p.y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    lassoPointsRef.current = [];
    setRenderTick((n) => n + 1);
  };

  // ─── Pointer / wheel / keyboard handlers ─────────────────────────────────
  const onPointerDown = (e) => {
    if (!imageReady) return;
    e.preventDefault();
    const dp = eventToDisplayPoint(e);
    // Pan triggers, in priority order:
    //   - middle mouse button
    //   - Space held (keyboard shortcut)
    //   - the dedicated Pan tool selected
    if (e.button === 1 || spaceHeldRef.current || tool === "pan") {
      isPanningRef.current = true;
      panStartRef.current = { clientX: e.clientX, clientY: e.clientY, startPan: { ...pan } };
      e.currentTarget.setPointerCapture?.(e.pointerId);
      return;
    }
    if (tool === "lasso") {
      // First click of a new lasso → snapshot.  Subsequent clicks add a
      // vertex.  Click within ~10 px of the first vertex → close + fill.
      const pts = lassoPointsRef.current;
      if (pts.length === 0) {
        pts.push(dp);
      } else {
        const first = pts[0];
        const distToFirst = Math.hypot(dp.x - first.x, dp.y - first.y);
        if (pts.length >= 2 && distToFirst < 12) {
          fillLassoPolygon();
          return;
        }
        pts.push(dp);
      }
      setRenderTick((n) => n + 1);
      return;
    }
    // Brush / eraser
    snapshotMask();
    isPaintingRef.current = true;
    const photoPt = displayToPhotoPoint(dp);
    paintBrushSegment(photoPt, photoPt, tool === "eraser");
    lastPointRef.current = dp;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setRenderTick((n) => n + 1);
  };

  const onPointerMove = (e) => {
    const dp = eventToDisplayPoint(e);
    setHoverPoint(dp);
    if (isPanningRef.current && panStartRef.current) {
      const dx = e.clientX - panStartRef.current.clientX;
      const dy = e.clientY - panStartRef.current.clientY;
      setPan({
        x: panStartRef.current.startPan.x + dx,
        y: panStartRef.current.startPan.y + dy,
      });
      return;
    }
    if (!isPaintingRef.current) return;
    if (tool !== "brush" && tool !== "eraser") return;
    const fromDp = lastPointRef.current || dp;
    const fromPhoto = displayToPhotoPoint(fromDp);
    const toPhoto = displayToPhotoPoint(dp);
    paintBrushSegment(fromPhoto, toPhoto, tool === "eraser");
    lastPointRef.current = dp;
    setRenderTick((n) => n + 1);
  };

  const onPointerUp = (e) => {
    if (isPanningRef.current) {
      isPanningRef.current = false;
      panStartRef.current = null;
      return;
    }
    isPaintingRef.current = false;
    lastPointRef.current = null;
  };

  const onPointerLeave = () => {
    setHoverPoint(null);
  };

  const onDoubleClick = () => {
    if (tool === "lasso") fillLassoPolygon();
  };

  const onWheel = (e) => {
    e.preventDefault();
    const dp = eventToDisplayPoint(e);
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom((prevZoom) => {
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prevZoom * factor));
      // Keep the photo point under the cursor stable: pan such that the
      // cursor's pre-zoom photo-space point ends at the same display point.
      setPan((prevPan) => {
        const ux = (dp.x - prevPan.x) / prevZoom;
        const uy = (dp.y - prevPan.y) / prevZoom;
        return { x: dp.x - ux * next, y: dp.y - uy * next };
      });
      return next;
    });
  };

  // ─── Keyboard: Space-to-pan, Ctrl/Cmd+Z to undo ──────────────────────────
  // We MUST preventDefault on Space — the page wraps the painter in a
  // scrollable container (h-screen + overflow-y-auto), and Space's browser
  // default is "scroll page down by a viewport".  Without preventDefault,
  // holding Space while dragging scrolls the whole page; releasing snaps
  // it back, which reads as the canvas jumping/zooming.  Skip preventDefault
  // when an input/textarea is focused so we don't break typing in form
  // fields elsewhere on the page.
  useEffect(() => {
    const isTextInput = (el) => {
      if (!el) return false;
      const tag = el.tagName?.toLowerCase();
      return tag === "input" || tag === "textarea" || el.isContentEditable;
    };
    const onKey = (e) => {
      if (e.code === "Space" && !isTextInput(e.target)) {
        e.preventDefault();
        spaceHeldRef.current = true;
      }
      if ((e.metaKey || e.ctrlKey) && e.code === "KeyZ") {
        e.preventDefault();
        undo();
      }
    };
    const onKeyUp = (e) => {
      if (e.code === "Space" && !isTextInput(e.target)) {
        e.preventDefault();
        spaceHeldRef.current = false;
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Done — pass the canonical mask up ───────────────────────────────────
  const handleConfirm = () => {
    onConfirm(maskCanvasRef.current);
  };

  const resetView = () => { setZoom(1); setPan({ x: 0, y: 0 }); };

  if (!imageReady) {
    return <div className="h-64 rounded-xl bg-[hsl(var(--secondary))] flex items-center justify-center text-sm text-[hsl(215,16%,47%)]">Loading photo…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-semibold text-[hsl(215,25%,27%)]">
            Paint over things you DON'T want covered
          </h3>
          <p className="text-xs text-[hsl(215,16%,47%)] mt-0.5">
            Furniture, lamps, plants — anything in front of the wall.  We'll
            keep these visible when applying the panel.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={onBack} variant="outline" size="sm">Back</Button>
          <Button onClick={handleConfirm} size="sm" data-testid="painter-done">
            Continue <ArrowRight className="h-4 w-4 ml-1.5" />
          </Button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center flex-wrap gap-2 bg-[hsl(var(--secondary))] rounded-lg p-2">
        <ToolButton active={tool === "brush"} onClick={() => setTool("brush")} icon={Brush} label="Brush" />
        <ToolButton active={tool === "eraser"} onClick={() => setTool("eraser")} icon={Eraser} label="Eraser" />
        <ToolButton active={tool === "lasso"} onClick={() => { setTool("lasso"); lassoPointsRef.current = []; }} icon={Lasso} label="Lasso" />
        <ToolButton active={tool === "pan"} onClick={() => setTool("pan")} icon={Hand} label="Pan" />

        <div className="w-px h-6 bg-[hsl(var(--border))] mx-1" />

        <label className="flex items-center gap-2 text-xs text-[hsl(215,16%,47%)]">
          Brush
          <input
            type="range" min={5} max={300} step={5} value={brushSize}
            onChange={(e) => setBrushSize(Number(e.target.value))}
            className="w-24"
            disabled={tool === "lasso"}
            data-testid="painter-brush-size"
          />
          <span className="w-8 text-right tabular-nums">{brushSize}</span>
        </label>

        <div className="w-px h-6 bg-[hsl(var(--border))] mx-1" />

        <Button onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z * 1.25))} variant="outline" size="icon" className="h-8 w-8" title="Zoom in"><ZoomIn className="h-4 w-4" /></Button>
        <Button onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z / 1.25))} variant="outline" size="icon" className="h-8 w-8" title="Zoom out"><ZoomOut className="h-4 w-4" /></Button>
        <Button onClick={resetView} variant="outline" size="icon" className="h-8 w-8" title="Reset view"><Maximize2 className="h-4 w-4" /></Button>
        <span className="text-xs text-[hsl(215,16%,47%)] tabular-nums">{Math.round(zoom * 100)}%</span>

        <div className="w-px h-6 bg-[hsl(var(--border))] mx-1" />

        <Button onClick={undo} variant="outline" size="sm" disabled={!undoStackRef.current.length} title="Ctrl/Cmd+Z"><Undo2 className="h-4 w-4 mr-1.5" />Undo</Button>
        <Button onClick={clearAll} variant="outline" size="sm" title="Clear mask"><Trash2 className="h-4 w-4 mr-1.5" />Clear</Button>
      </div>

      <div
        ref={wrapperRef}
        className="relative rounded-xl overflow-hidden border border-[hsl(var(--border))] bg-black select-none"
        style={{ touchAction: "none" }}
      >
        <canvas
          ref={viewCanvasRef}
          className="block w-full h-auto"
          style={{
            cursor:
              isPanningRef.current ? "grabbing" :
              (tool === "pan" || spaceHeldRef.current) ? "grab" :
              tool === "lasso" ? "crosshair" :
              "none",
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onPointerLeave={onPointerLeave}
          onDoubleClick={onDoubleClick}
          onWheel={onWheel}
          data-testid="painter-canvas"
        />
      </div>

      <p className="text-[11px] text-[hsl(215,16%,47%)]">
        Tips: scroll to zoom · pick the <strong>Pan</strong> tool (or hold{" "}
        <kbd className="px-1 rounded bg-[hsl(var(--secondary))] text-[10px]">Space</kbd>) and drag to pan ·
        <kbd className="px-1 rounded bg-[hsl(var(--secondary))] text-[10px]">Ctrl</kbd>+<kbd className="px-1 rounded bg-[hsl(var(--secondary))] text-[10px]">Z</kbd> to undo.  In Lasso mode, click points then click the first point (or double-click) to close.
      </p>
    </div>
  );
}

function ToolButton({ active, onClick, icon: Icon, label }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
        active ? "bg-[hsl(var(--accent))] text-white" : "bg-white border border-[hsl(var(--border))] text-[hsl(215,25%,27%)] hover:bg-[hsl(var(--secondary))]"
      }`}
      title={label}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

/**
 * Tint the binary mask (white-on-transparent) red so it shows up over the
 * photo as a "marked area."  Memoised by mask object identity to avoid
 * allocating a new canvas on every render.  We can't memoise on content
 * because the mask is mutated in place; instead we re-tint every render
 * (cheap because it's a single drawImage at original photo resolution).
 */
function getTintedMaskCanvas(mask) {
  const tinted = document.createElement("canvas");
  tinted.width = mask.width;
  tinted.height = mask.height;
  const ctx = tinted.getContext("2d");
  ctx.drawImage(mask, 0, 0);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = "#ef4444";
  ctx.fillRect(0, 0, tinted.width, tinted.height);
  return tinted;
}
