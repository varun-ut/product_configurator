/**
 * UniVicoustic Wall Visualizer — Tier C (Claude vision + browser homography).
 *
 * Flow:
 *   1. User uploads a room photo.
 *   2. (Optional) User picks a default panel — the one Claude's detected
 *      walls will be pre-loaded with.  Per-wall swapping happens after.
 *   3. Click "Visualize" → POST the image to /api/visualize-walls, which
 *      returns wall quadrilaterals from Claude.
 *   4. WallEditor renders the room photo + warped panels, with draggable
 *      corner handles for refinement and a per-wall panel picker.
 *
 * To remove this feature: delete src/visualizer/ and the corresponding
 * <Route> in App.js + the /api/visualize-walls endpoint in server.py.
 * No other files import anything from here.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { track } from "@/lib/analytics";
import { ArrowLeft, Sparkles, AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import PanelPicker from "./PanelPicker";
import PhotoUpload from "./PhotoUpload";
import WallEditor from "./WallEditor";
import { detectWalls } from "./claudeWallEngine";
import { SAMPLE_PANELS } from "./samplePanels";

export default function VisualizerPage() {
  // Fire once when the route mounts. The ref guards against StrictMode's
  // double-mount in development, which would otherwise count it twice.
  const trackedOpen = useRef(false);
  useEffect(() => {
    if (trackedOpen.current) return;
    trackedOpen.current = true;
    track("visualizer_opened");
  }, []);

  const [defaultPanel, setDefaultPanel] = useState(SAMPLE_PANELS[0]);
  const [photo, setPhoto] = useState(null);
  // Phase: 'setup' (picking inputs) → 'detecting' (call in flight) →
  //        'editing' (Claude returned, user editing) → 'error'
  const [phase, setPhase] = useState("setup");
  const [walls, setWalls] = useState([]);
  // Claude returns coords in its OWN downsampled image space (Anthropic
  // resizes images before vision processing), so we must scale corners by
  // image_size, not by roomImg.naturalWidth.  Persist the size we got back.
  const [imageSize, setImageSize] = useState({ w: 0, h: 0 });
  const [errorMessage, setErrorMessage] = useState(null);

  const canVisualize = Boolean(defaultPanel && photo);

  const runDetection = useCallback(async () => {
    if (!canVisualize) return;
    setPhase("detecting");
    setErrorMessage(null);
    try {
      const result = await detectWalls(photo);
      if (!result.walls?.length) {
        setErrorMessage(
          "We couldn't find any walls in that photo.  Try a shot where at least one wall is clearly visible without too much obstruction."
        );
        setPhase("error");
        return;
      }
      setWalls(result.walls);
      setImageSize(result.image_size || { w: 0, h: 0 });
      setPhase("editing");
    } catch (err) {
      setErrorMessage(err?.message || String(err));
      setPhase("error");
    }
  }, [canVisualize, photo]);

  const reset = useCallback(() => {
    setPhase("setup");
    setWalls([]);
    setPhoto(null);
    setErrorMessage(null);
  }, []);

  return (
    // h-screen + overflow-y-auto gives the visualizer its OWN scroll context.
    // Global index.css sets `body { overflow: hidden }` for the configurator's
    // full-bleed layout, so a min-h-screen page would just clip past the
    // viewport.  This way the page fills the viewport vertically and scrolls
    // its own content — no global CSS change needed.
    <div className="h-screen overflow-y-auto bg-[hsl(var(--background))]" data-testid="visualizer-page">
      {/* Header */}
      <header className="border-b border-[hsl(var(--border))] bg-white">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-4">
          <Button asChild variant="ghost" size="sm" className="text-[hsl(215,16%,47%)]">
            <Link to="/" data-testid="visualizer-back">
              <ArrowLeft className="h-4 w-4 mr-1.5" /> Back to configurator
            </Link>
          </Button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-[hsl(215,25%,27%)] flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-[hsl(var(--accent))]" />
              Wall Visualizer
              <span className="text-[10px] font-medium uppercase tracking-wider bg-[hsl(var(--accent)/0.15)] text-[hsl(var(--accent))] px-2 py-0.5 rounded-full">
                Beta
              </span>
            </h1>
            <p className="text-xs text-[hsl(215,16%,47%)] mt-0.5">
              Upload a photo of your room.  Claude finds your walls and we apply UniVicoustic panels — drag the corners to fine-tune.
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {phase === "setup" && (
          <div className="space-y-8">
            <PanelPicker
              selectedId={defaultPanel?.id}
              onSelect={setDefaultPanel}
            />
            <PhotoUpload file={photo} onChange={setPhoto} />
            <div className="flex flex-col items-end gap-2">
              <Button
                onClick={runDetection}
                disabled={!canVisualize}
                size="lg"
                className="min-w-[200px]"
                data-testid="visualize-btn"
              >
                <Sparkles className="h-4 w-4 mr-2" />
                Visualize
              </Button>
              {!canVisualize && (
                <p className="text-xs text-[hsl(215,16%,47%)]">
                  Pick a panel and upload a room photo to enable.
                </p>
              )}
            </div>
          </div>
        )}

        {phase === "detecting" && (
          <div className="rounded-xl border border-[hsl(var(--border))] bg-[hsl(var(--secondary))] py-16 text-center space-y-3">
            <Loader2 className="h-10 w-10 mx-auto animate-spin text-[hsl(var(--accent))]" />
            <p className="text-sm font-medium text-[hsl(215,25%,27%)]">
              Looking for walls in your photo…
            </p>
            <p className="text-xs text-[hsl(215,16%,47%)]">
              Usually 5–10 seconds.  We're asking Claude to identify each wall's corners.
            </p>
          </div>
        )}

        {phase === "error" && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center space-y-3">
            <AlertCircle className="h-10 w-10 mx-auto text-red-500" />
            <p className="text-sm font-medium text-red-700">
              {errorMessage || "Something went wrong."}
            </p>
            <Button onClick={reset} variant="outline" size="sm" data-testid="visualizer-error-reset">
              Try a different photo
            </Button>
          </div>
        )}

        {phase === "editing" && (
          <WallEditor
            roomFile={photo}
            walls={walls}
            sourceImageSize={imageSize}
            defaultPanel={defaultPanel}
            onReset={reset}
          />
        )}

        <p className="text-xs text-[hsl(215,16%,47%)] mt-12 max-w-2xl">
          Wall detection is powered by Claude's vision model.  Visualizations are indicative — the
          actual installed panel's colour, sheen and grain will vary with lighting and viewing angle.
          For specification-grade samples, order a physical swatch.
        </p>
      </main>
    </div>
  );
}
