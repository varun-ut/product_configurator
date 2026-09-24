/**
 * WallCornerPicker — phase 3 of the manual-mask wall visualizer.
 *
 * The user clicks four corners (in TL → TR → BR → BL order) to define the
 * wall plane.  After all four are placed, each corner becomes a draggable
 * handle for refinement.
 *
 * The painted furniture mask from phase 2 is overlaid on the photo as a
 * translucent red layer so users can place corners with the mask in mind
 * (e.g. ignore the couch they already painted out).
 *
 * Marker handles are plain HTML <div>s absolutely-positioned over the
 * wrapper, NOT SVG <circle>s.  The earlier SVG-based version had a
 * dev-mode rendering quirk where <circle> children silently failed to
 * paint even when their parent <svg> + sibling <rect> rendered fine
 * (root cause uninvestigated; production was unaffected).  Plain divs
 * sidestep all SVG namespace / dev-server / Tailwind-JIT edge cases —
 * if the wrapper is on screen at any non-zero size, the markers paint.
 *
 * The dashed quadrilateral outline (rendered only after all 4 corners
 * are placed) stays as an SVG <polygon> because that's still the
 * cleanest way to draw a non-rectangular shape with a stroke.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowRight, RefreshCw } from "lucide-react";

const CORNER_ORDER = ["top-left", "top-right", "bottom-right", "bottom-left"];

export default function WallCornerPicker({ photoFile, mask, onConfirm, onBack }) {
  const wrapperRef = useRef(null);
  const canvasRef = useRef(null);
  const photoImgRef = useRef(null);
  const dragRef = useRef(null);  // { cornerIdx } when dragging

  const [corners, setCorners] = useState([]);   // photo-pixel-space points
  const [displaySize, setDisplaySize] = useState({ w: 0, h: 0 });
  const [imageReady, setImageReady] = useState(false);

  // Load photo.
  useEffect(() => {
    if (!photoFile) return;
    let cancelled = false;
    const url = URL.createObjectURL(photoFile);
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      photoImgRef.current = img;
      setImageReady(true);
    };
    img.src = url;
    return () => { cancelled = true; URL.revokeObjectURL(url); };
  }, [photoFile]);

  // Track display size.
  //
  // Defensive against a layout race we hit in dev (React 18 StrictMode
  // double-mounts useEffect, and on the first cycle the wrapper's
  // `clientWidth` can read 0 because layout hasn't run yet).  If a
  // measurement comes back 0, we retry on the next animation frame
  // until the wrapper has a real width.  Once we have one valid number,
  // ResizeObserver takes over for any subsequent resizes.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || !imageReady) return;
    let cancelled = false;
    let rafId = null;
    let attempts = 0;
    const update = () => {
      if (cancelled) return;
      attempts++;
      const img = photoImgRef.current;
      if (!img) return;
      const wrapW = wrapper.clientWidth;
      if (wrapW <= 0) {
        if (attempts < 60) rafId = requestAnimationFrame(update);
        return;
      }
      const scale = wrapW / img.naturalWidth;
      setDisplaySize({
        w: Math.round(img.naturalWidth * scale),
        h: Math.round(img.naturalHeight * scale),
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(wrapper);
    return () => {
      cancelled = true;
      if (rafId !== null) cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, [imageReady]);

  // Re-render canvas (photo + tinted mask).
  const renderCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const photo = photoImgRef.current;
    if (!canvas || !photo || !displaySize.w) return;
    canvas.width = displaySize.w;
    canvas.height = displaySize.h;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, displaySize.w, displaySize.h);
    ctx.drawImage(photo, 0, 0, displaySize.w, displaySize.h);
    if (mask) {
      // Same red-tint trick as FurniturePainter.
      const tinted = document.createElement("canvas");
      tinted.width = mask.width;
      tinted.height = mask.height;
      const tctx = tinted.getContext("2d");
      tctx.drawImage(mask, 0, 0);
      tctx.globalCompositeOperation = "source-in";
      tctx.fillStyle = "#ef4444";
      tctx.fillRect(0, 0, tinted.width, tinted.height);
      ctx.save();
      ctx.globalAlpha = 0.4;
      ctx.drawImage(tinted, 0, 0, displaySize.w, displaySize.h);
      ctx.restore();
    }
  }, [displaySize, mask]);

  useEffect(() => { renderCanvas(); }, [renderCanvas]);

  // Display-space → photo-space conversion.
  const toPhotoSpace = (displayX, displayY) => {
    const photo = photoImgRef.current;
    if (!photo || !displaySize.w) return { x: displayX, y: displayY };
    return {
      x: (displayX * photo.naturalWidth) / displaySize.w,
      y: (displayY * photo.naturalHeight) / displaySize.h,
    };
  };
  // Photo-space → display-space.
  const toDisplaySpace = (px, py) => {
    const photo = photoImgRef.current;
    if (!photo || !displaySize.w) return { x: px, y: py };
    return {
      x: (px * displaySize.w) / photo.naturalWidth,
      y: (py * displaySize.h) / photo.naturalHeight,
    };
  };

  const eventToDisplay = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) * canvas.width) / rect.width,
      y: ((e.clientY - rect.top) * canvas.height) / rect.height,
    };
  };

  const onCanvasClick = (e) => {
    if (corners.length >= 4) return;
    const dp = eventToDisplay(e);
    const photoPt = toPhotoSpace(dp.x, dp.y);
    setCorners((prev) => [...prev, photoPt]);
  };

  // Pointer drag for an already-placed corner handle.
  const onHandlePointerDown = (cornerIdx, e) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { cornerIdx };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onWrapperPointerMove = (e) => {
    if (!dragRef.current) return;
    const dp = eventToDisplay(e);
    const clamped = {
      x: Math.max(0, Math.min(displaySize.w, dp.x)),
      y: Math.max(0, Math.min(displaySize.h, dp.y)),
    };
    const photoPt = toPhotoSpace(clamped.x, clamped.y);
    setCorners((prev) => {
      const next = prev.map((c) => ({ ...c }));
      next[dragRef.current.cornerIdx] = photoPt;
      return next;
    });
  };
  const onWrapperPointerUp = () => { dragRef.current = null; };

  const reset = () => setCorners([]);

  const displayCorners = useMemo(
    () => corners.map((c) => toDisplaySpace(c.x, c.y)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [corners, displaySize]
  );

  if (!imageReady) {
    return <div className="h-64 rounded-xl bg-[hsl(var(--secondary))] flex items-center justify-center text-sm text-[hsl(215,16%,47%)]">Loading photo…</div>;
  }

  const nextCornerLabel = corners.length < 4 ? CORNER_ORDER[corners.length] : null;
  const ready = corners.length === 4;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h3 className="text-sm font-semibold text-[hsl(215,25%,27%)]">
            {ready
              ? "Drag the corners to refine the wall outline"
              : `Click the wall's ${nextCornerLabel} corner`}
          </h3>
          <p className="text-xs text-[hsl(215,16%,47%)] mt-0.5">
            {ready
              ? "When the dashed quadrilateral matches the wall, hit Continue."
              : `${corners.length} of 4 placed.  Order: top-left → top-right → bottom-right → bottom-left.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={onBack} variant="outline" size="sm">Back</Button>
          {corners.length > 0 && (
            <Button onClick={reset} variant="outline" size="sm" data-testid="picker-reset">
              <RefreshCw className="h-4 w-4 mr-1.5" /> Reset corners
            </Button>
          )}
          <Button onClick={() => onConfirm(corners)} size="sm" disabled={!ready} data-testid="picker-done">
            Continue <ArrowRight className="h-4 w-4 ml-1.5" />
          </Button>
        </div>
      </div>

      <div
        ref={wrapperRef}
        className="relative select-none"
        onPointerMove={onWrapperPointerMove}
        onPointerUp={onWrapperPointerUp}
        onPointerLeave={onWrapperPointerUp}
      >
        <div className="rounded-xl overflow-hidden border border-[hsl(var(--border))] bg-black">
          <canvas
            ref={canvasRef}
            className="block w-full h-auto"
            style={{ cursor: ready ? "default" : "crosshair" }}
            onClick={onCanvasClick}
            data-testid="picker-canvas"
          />
        </div>

        {/* Dashed quadrilateral outline — SVG polygon, only when all 4
            corners are placed.  Polygon is one element, no children-
            paint quirk to worry about. */}
        {ready && displaySize.w > 0 && (
          <svg
            className="absolute pointer-events-none"
            style={{ top: 0, left: 0, width: "100%", height: "100%", zIndex: 9 }}
            viewBox={`0 0 ${displaySize.w} ${displaySize.h}`}
            preserveAspectRatio="none"
          >
            <polygon
              points={displayCorners.map((p) => `${p.x},${p.y}`).join(" ")}
              fill="none"
              stroke="hsl(var(--accent, 200 100% 50%))"
              strokeWidth={2}
              strokeDasharray="6 4"
            />
          </svg>
        )}

        {/* Corner-marker handles — plain HTML divs absolutely positioned
            relative to the wrapper.  Use percentage-based left/top so
            the markers track the wrapper's actual rendered size even if
            displaySize hasn't finished settling yet (and even if a CSS
            zoom transform is applied somewhere up the tree). */}
        {displayCorners.map((p, i) => {
          // displayCorners are in display-pixel coords; the wrapper IS
          // sized to displaySize × CSS-scale.  Convert to a percentage
          // so the position remains correct regardless of how the
          // browser actually rendered the canvas.
          const leftPct = displaySize.w > 0 ? (p.x / displaySize.w) * 100 : 0;
          const topPct = displaySize.h > 0 ? (p.y / displaySize.h) * 100 : 0;
          return (
            <div
              key={i}
              className="absolute"
              style={{
                left: `${leftPct}%`,
                top: `${topPct}%`,
                width: 24,
                height: 24,
                marginLeft: -12,
                marginTop: -12,
                borderRadius: "50%",
                background: "white",
                // hardcoded fallback after the comma so missing-CSS-var
                // doesn't render an invisible white-on-white circle.
                border: "3px solid hsl(var(--accent, 200 100% 50%))",
                cursor: "grab",
                touchAction: "none",
                boxShadow: "0 1px 4px rgba(0,0,0,0.45)",
                zIndex: 10,
              }}
              onPointerDown={(e) => onHandlePointerDown(i, e)}
              data-testid={`picker-handle-${i}`}
            />
          );
        })}
      </div>
    </div>
  );
}
