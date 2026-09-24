/**
 * PanelComposer — phase 4 of the manual-mask wall visualizer.
 *
 * Renders the final composite: room photo + tiled panel warped to the
 * wall quadrilateral + furniture mask cutout.  User picks a panel from
 * the catalog (browseable by family + subfamily) and adjusts the tile
 * count via a slider.  First render uses the auto-default from
 * suggestTileCount() (B1 in the spec — match panel aspect to wall aspect
 * so panels render at sensible proportions).
 *
 * Also offers a Download button that exports the current canvas to PNG.
 *
 * Image strategy
 * --------------
 * - Picker grid: each entry's `thumbnailUrl` is a small thumbnail file
 *   (`_thumbcache/...` or vicstrip thumbnails dir, ~5–130 KB) loaded with
 *   native `<img loading="lazy">` so off-screen tiles don't fetch.
 *   Ombre tiles paint as CSS gradients (no network) because no thumbcache
 *   exists for that family.
 * - Wall texture: `useBlobPanel(panel.panelUrl)` fetches the full-res
 *   panel jpg via the same hook the configurator uses for Designer
 *   Textile.  Exactly one decoded panel bitmap lives in memory at a
 *   time — when the user picks a different panel the previous Blob URL
 *   is atomically revoked once the new one is ready (no flash).  We
 *   then `await img.decode()` from the Blob URL so the canvas
 *   compositor never blocks on JPEG decode.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, RefreshCw } from "lucide-react";
import { renderTiledComposite, suggestTileCount } from "./tiledHomography";
import {
  SAMPLE_PANELS,
  PANEL_FAMILIES,
  loadBespokeGraphicsPanels,
} from "./samplePanels";
import { useBlobPanel } from "@/hooks/use-blob-panel";

export default function PanelComposer({ photoFile, mask, corners, defaultPanel, onReset }) {
  const wrapperRef = useRef(null);
  const canvasRef = useRef(null);
  const photoImgRef = useRef(null);

  // The visible catalog starts with everything synchronously available
  // and grows when Bespoke Graphics finishes fetching from products.json.
  // Kept in state (rather than a global) so React re-renders the picker
  // when the new entries arrive.
  const [allPanels, setAllPanels] = useState(SAMPLE_PANELS);
  const [bespokeLoading, setBespokeLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    loadBespokeGraphicsPanels().then((bespokePanels) => {
      if (cancelled) return;
      setBespokeLoading(false);
      if (bespokePanels.length === 0) return;
      // Insert Bespoke Graphics in the same position as PANEL_FAMILIES so
      // the family-tab order matches the in-memory list.
      setAllPanels((prev) => {
        // Skip if already merged (e.g. StrictMode double-effect).
        if (prev.some((p) => p.family === "Bespoke Graphics")) return prev;
        const idx = prev.findIndex((p) => p.family === "Ombre");
        if (idx < 0) return [...prev, ...bespokePanels];
        return [...prev.slice(0, idx), ...bespokePanels, ...prev.slice(idx)];
      });
    });
    return () => { cancelled = true; };
  }, []);

  const [panel, setPanel] = useState(defaultPanel || SAMPLE_PANELS[0]);
  // Tile count is fully derived: wallAspect / panelAspect, rounded.
  // No manual slider — preserving each panel's natural aspect ratio is
  // the contract, so the count drops out of geometry.  Recomputed on
  // every panel-change and corner-edit by the effect below.
  const [tileCount, setTileCount] = useState(1);
  const [panelImg, setPanelImg] = useState(null);
  const [panelImgErr, setPanelImgErr] = useState(false);
  const [displaySize, setDisplaySize] = useState({ w: 0, h: 0 });
  const [imageReady, setImageReady] = useState(false);

  // Catalog filter state — defaults to the family of whatever panel is
  // initially selected, so the picker opens onto the user's current panel.
  const [activeFamily, setActiveFamily] = useState(panel?.family || PANEL_FAMILIES[0]);
  const [activeSubfamily, setActiveSubfamily] = useState(panel?.subfamily || "");

  // Recompute the subfamily list whenever the family or panel pool
  // changes (Bespoke Graphics may arrive after first render).
  const subfamilies = useMemo(() => {
    const seen = new Map();
    for (const p of allPanels) {
      if (p.family !== activeFamily) continue;
      if (!seen.has(p.subfamily)) seen.set(p.subfamily, p.subfamilyLabel);
    }
    return Array.from(seen, ([id, label]) => ({ id, label }));
  }, [allPanels, activeFamily]);

  // If the active subfamily isn't valid for the current family, snap it to
  // the first available one.  Happens after switching families and after
  // Bespoke Graphics finishes loading (when its subfamilies first appear).
  useEffect(() => {
    if (!subfamilies.length) return;
    if (!subfamilies.some((s) => s.id === activeSubfamily)) {
      setActiveSubfamily(subfamilies[0].id);
    }
  }, [subfamilies, activeSubfamily]);

  // Filtered panel list for the current family + subfamily.
  const filteredPanels = useMemo(
    () =>
      allPanels.filter(
        (p) =>
          p.family === activeFamily &&
          (subfamilies.length <= 1 || p.subfamily === activeSubfamily),
      ),
    [allPanels, activeFamily, activeSubfamily, subfamilies.length],
  );

  // useBlobPanel handles abort-on-change, atomic Blob swap, cache:'no-store'
  // (avoids 0-byte 304s), and unmount cleanup.  Same hook the main
  // configurator's Designer Textile path uses, so behavior is consistent.
  const { blobUrl: panelBlobUrl, isLoading: panelLoading } = useBlobPanel(
    panel?.panelUrl || null,
  );

  // Decode the Blob URL into an HTMLImageElement so the canvas compositor
  // can draw it without blocking the main thread on JPEG decode.  Once
  // decoded, the bitmap stays valid in the Image even after the Blob URL
  // is revoked (we only need the URL → blob mapping for the duration of
  // the load).
  useEffect(() => {
    if (!panelBlobUrl) {
      setPanelImg(null);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.src = panelBlobUrl;
    img.decode()
      .then(() => {
        if (cancelled) return;
        setPanelImg(img);
        setPanelImgErr(false);
        // Tile count is recomputed by the panelImg effect below.
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("[visualizer-draw] panel decode failed:", err);
        setPanelImgErr(true);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelBlobUrl]);

  // If the primary panelUrl 404s, retry once with the fallback.  Detected
  // via panelLoading dropping to false while panelImg is still null and
  // the fallback hasn't been tried yet.  Implemented as a bounce on the
  // selected panel's panelUrl so useBlobPanel re-runs cleanly.
  const triedFallbackRef = useRef(null);
  useEffect(() => {
    if (panelLoading || panelImg) {
      triedFallbackRef.current = null;
      return;
    }
    if (
      panel?.panelFallbackUrl &&
      panel.panelUrl !== panel.panelFallbackUrl &&
      triedFallbackRef.current !== panel.id
    ) {
      triedFallbackRef.current = panel.id;
      // Swap to a panel object whose panelUrl is the fallback so the
      // hook re-fetches cleanly.  Original entry stays in SAMPLE_PANELS.
      setPanel((prev) =>
        prev?.id === panel.id ? { ...prev, panelUrl: panel.panelFallbackUrl } : prev,
      );
    } else if (panel) {
      setPanelImgErr(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelLoading, panelImg]);

  // Load room photo.
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

  // Re-derive tile count whenever the wall corners or panel changes —
  // wall pixel-aspect can shift if the user drags a corner handle, and
  // the new tile count keeps the panel's natural proportions intact.
  useEffect(() => {
    if (!panelImg || corners?.length !== 4) return;
    const w = panelImg.naturalWidth || panelImg.width;
    const h = panelImg.naturalHeight || panelImg.height;
    if (!w || !h) return;
    setTileCount(suggestTileCount(corners, w, h));
  }, [corners, panelImg]);

  // Track display size.
  // See note on the same effect in WallCornerPicker for why we retry via
  // requestAnimationFrame when the wrapper measures 0 — same dev-mode
  // layout race shows up here too if it happens.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || !imageReady) return;
    let cancelled = false;
    let rafId = null;
    const update = () => {
      if (cancelled) return;
      const img = photoImgRef.current;
      if (!img) return;
      const wrapW = wrapper.clientWidth;
      if (wrapW <= 0) {
        rafId = requestAnimationFrame(update);
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

  // Render composite whenever inputs change.
  useEffect(() => {
    const canvas = canvasRef.current;
    const photo = photoImgRef.current;
    if (!canvas || !photo || !displaySize.w) return;
    canvas.width = displaySize.w;
    canvas.height = displaySize.h;
    if (!panelImg || corners?.length !== 4) {
      // Just show the photo if we can't composite yet.
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(photo, 0, 0, canvas.width, canvas.height);
      return;
    }
    // Scale corners from photo space to display space.
    const sx = displaySize.w / photo.naturalWidth;
    const sy = displaySize.h / photo.naturalHeight;
    const displayCorners = corners.map((p) => ({ x: p.x * sx, y: p.y * sy }));

    // Mask is in original photo space — scale it to display by drawing
    // it onto a sized offscreen canvas the compositor can use directly.
    let scaledMask = null;
    if (mask) {
      scaledMask = document.createElement("canvas");
      scaledMask.width = displaySize.w;
      scaledMask.height = displaySize.h;
      scaledMask.getContext("2d").drawImage(mask, 0, 0, displaySize.w, displaySize.h);
    }

    try {
      renderTiledComposite(
        canvas,
        photo,
        { texture: panelImg, corners: displayCorners, tileCount },
        scaledMask,
      );
    } catch (err) {
      // Degenerate quad → just show the photo so the UI doesn't break.
      const ctx = canvas.getContext("2d");
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(photo, 0, 0, canvas.width, canvas.height);
    }
  }, [panelImg, corners, displaySize, tileCount, mask]);

  const downloadResult = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement("a");
    a.download = `univicoustic-visualizer-draw-${Date.now()}.png`;
    a.href = canvas.toDataURL("image/png");
    a.click();
  };

  if (!imageReady) {
    return <div className="h-64 rounded-xl bg-[hsl(var(--secondary))] flex items-center justify-center text-sm text-[hsl(215,16%,47%)]">Loading photo…</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h3 className="text-sm font-semibold text-[hsl(215,25%,27%)]">
          Pick a panel and adjust how it tiles across the wall
        </h3>
        <div className="flex items-center gap-2">
          <Button onClick={onReset} variant="outline" size="sm" data-testid="composer-reset">
            <RefreshCw className="h-4 w-4 mr-1.5" /> Start over
          </Button>
          <Button onClick={downloadResult} size="sm" data-testid="composer-download">
            <Download className="h-4 w-4 mr-1.5" /> Download PNG
          </Button>
        </div>
      </div>

      <div ref={wrapperRef} className="relative">
        <div className="rounded-xl overflow-hidden border border-[hsl(var(--border))] bg-black">
          <canvas ref={canvasRef} className="block w-full h-auto" data-testid="composer-canvas" />
        </div>
        {panelLoading && (
          <div className="absolute top-3 left-3 bg-white/90 border border-[hsl(var(--border))] text-[hsl(215,25%,27%)] text-xs px-3 py-1.5 rounded shadow-sm">
            Loading panel…
          </div>
        )}
        {panelImgErr && !panelLoading && (
          <div className="absolute top-3 left-3 bg-red-50 border border-red-200 text-red-700 text-xs px-3 py-1.5 rounded">
            Couldn't load this panel image — try another.
          </div>
        )}
      </div>

      {/* Layout info — read-only.  Tile count is derived from the panel's
          natural aspect ratio vs the wall's pixel aspect, so each panel
          renders at its real proportions instead of being squashed to fit
          a user-chosen count.  Adjust the wall corners (in the previous
          step) to change how many panels appear. */}
      <div className="bg-[hsl(var(--secondary))] rounded-lg px-4 py-3 flex items-center justify-between">
        <span className="text-sm text-[hsl(215,25%,27%)]">
          Panels fit at their natural proportions
        </span>
        <span className="text-sm font-semibold tabular-nums text-[hsl(215,25%,27%)]">
          {tileCount} {tileCount === 1 ? "panel" : "panels"}
        </span>
      </div>


      {/* Panel picker */}
      <div className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-[hsl(215,16%,47%)]">
            Panel
          </h4>
          {panel && (
            <p className="text-xs text-[hsl(215,16%,47%)] truncate max-w-[60%]">{panel.name}</p>
          )}
        </div>

        {/* Family tab strip */}
        <div className="flex flex-wrap gap-1.5" data-testid="composer-family-tabs">
          {PANEL_FAMILIES.map((fam) => {
            const isActive = activeFamily === fam;
            return (
              <button
                key={fam}
                onClick={() => setActiveFamily(fam)}
                className={`text-xs px-3 py-1.5 rounded-full transition-all ${
                  isActive
                    ? "bg-[hsl(var(--accent))] text-white"
                    : "bg-[hsl(var(--secondary))] text-[hsl(215,25%,27%)] hover:bg-[hsl(215,16%,90%)]"
                }`}
                data-testid={`composer-family-${fam.replace(/\s+/g, "-").toLowerCase()}`}
              >
                {fam}
              </button>
            );
          })}
        </div>

        {/* Subfamily tab strip — hidden when there's only one subfamily */}
        {subfamilies.length > 1 && (
          <div className="flex flex-wrap gap-1" data-testid="composer-subfamily-tabs">
            {subfamilies.map((sf) => {
              const isActive = activeSubfamily === sf.id;
              return (
                <button
                  key={sf.id}
                  onClick={() => setActiveSubfamily(sf.id)}
                  className={`text-[11px] px-2.5 py-1 rounded-md border transition-all ${
                    isActive
                      ? "bg-white border-[hsl(var(--accent))] text-[hsl(var(--accent))] font-semibold"
                      : "bg-transparent border-[hsl(var(--border))] text-[hsl(215,16%,47%)] hover:border-[hsl(215,16%,47%)]"
                  }`}
                >
                  {sf.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Panel grid — capped height with scroll so a 50-shade fabric
            doesn't push the entire page down. */}
        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2 max-h-[360px] overflow-y-auto pr-1">
          {filteredPanels.map((p) => {
            const isSelected = panel?.id === p.id;
            return (
              <button
                key={p.id}
                onClick={() => setPanel(p)}
                className={`aspect-[2/3] rounded-md overflow-hidden bg-[hsl(var(--secondary))] transition-all relative ${
                  isSelected
                    ? "ring-2 ring-[hsl(var(--accent))] ring-offset-1"
                    : "ring-1 ring-[hsl(var(--border))] hover:ring-[hsl(215,16%,47%)]"
                }`}
                title={p.name}
                data-testid={`composer-panel-${p.id}`}
                style={
                  // Ombre tiles paint instantly via a CSS gradient built
                  // from the known base + overlay hexes — no network
                  // hit per tile.  Multi-MB panel jpg only loads when
                  // the user actually clicks.
                  !p.thumbnailUrl && p.thumbnailGradient
                    ? { background: p.thumbnailGradient }
                    : undefined
                }
              >
                {p.thumbnailUrl ? (
                  <img
                    src={p.thumbnailUrl}
                    alt={p.name}
                    loading="lazy"
                    decoding="async"
                    // Mark grid tiles low-priority so when the user clicks
                    // one, the higher-priority texture fetch isn't fighting
                    // equal-weight grid fetches for the browser's per-host
                    // connection slots.
                    fetchpriority="low"
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      // Hide broken image; the secondary background fills
                      // the slot.  Don't fall back to the panel jpg here —
                      // that's exactly the multi-MB load we're avoiding.
                      e.currentTarget.style.display = "none";
                    }}
                  />
                ) : null}
              </button>
            );
          })}
          {filteredPanels.length === 0 && (
            <div className="col-span-full text-xs text-[hsl(215,16%,47%)] py-6 text-center">
              {activeFamily === "Bespoke Graphics" && bespokeLoading
                ? "Loading Bespoke Graphics catalog…"
                : "No panels in this group."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
