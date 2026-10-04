/**
 * DrawVisualizerPage — manual-mask wall visualizer (Tier B-ish, no AI).
 *
 * Mounted at /visualizer-draw.  Independent from /visualizer (Claude-based).
 * To remove: delete src/visualizer-draw/ + remove the matching <Route>
 * line in App.js.  No other files import from here.
 *
 * Five phases driven by a single `phase` state value:
 *
 *   upload  → user uploads a room photo
 *   paint   → FurniturePainter — user paints over furniture / non-wall stuff
 *   corners → WallCornerPicker — user clicks 4 wall corners + drag-refine
 *   apply   → PanelComposer — pick panel, adjust tile count, see live preview
 *   (no done phase — apply screen has its own download/start-over)
 *
 * State that flows phase-to-phase:
 *   photoFile  : File         the uploaded room photo
 *   mask       : HTMLCanvasEl an offscreen canvas at original-photo
 *                             dimensions, alpha-1 wherever the user
 *                             painted (= "preserve this in the final
 *                             render, don't cover with panel")
 *   corners    : Array<4>     the wall quadrilateral in original-photo
 *                             pixel space (TL, TR, BR, BL)
 *
 * The compositor consumes all three.
 */
import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Sparkles, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import PhotoUpload from "./PhotoUpload";
import FurniturePainter from "./FurniturePainter";
import WallCornerPicker from "./WallCornerPicker";
import PanelComposer from "./PanelComposer";
import { SAMPLE_PANELS } from "./samplePanels";

export default function DrawVisualizerPage() {
  const [phase, setPhase] = useState("upload");  // upload | paint | corners | apply
  const [photoFile, setPhotoFile] = useState(null);
  const [mask, setMask] = useState(null);         // HTMLCanvasElement
  const [corners, setCorners] = useState([]);     // Array of 4 photo-space points
  const defaultPanel = SAMPLE_PANELS[0];

  const reset = useCallback(() => {
    setPhase("upload");
    setPhotoFile(null);
    setMask(null);
    setCorners([]);
  }, []);

  return (
    // h-screen + overflow-y-auto: same trick as /visualizer.  Global
    // body { overflow: hidden } is set for the configurator's full-bleed
    // layout, so we own our scrollbar locally.
    <div className="h-screen overflow-y-auto bg-[hsl(var(--background))]" data-testid="draw-visualizer-page">
      <header className="border-b border-[hsl(var(--border))] bg-white">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-4">
          <Button asChild variant="ghost" size="sm" className="text-[hsl(215,16%,47%)]">
            <Link to="/" data-testid="draw-back-home">
              <ArrowLeft className="h-4 w-4 mr-1.5" /> Back to configurator
            </Link>
          </Button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-[hsl(215,25%,27%)] flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-[hsl(var(--accent))]" />
              Wall Visualizer — Manual
              <span className="text-[10px] font-medium uppercase tracking-wider bg-[hsl(var(--accent)/0.15)] text-[hsl(var(--accent))] px-2 py-0.5 rounded-full">
                Beta
              </span>
            </h1>
            <p className="text-xs text-[hsl(215,16%,47%)] mt-0.5">
              Upload a room, paint over furniture you want to keep visible, mark the wall, and apply a panel — no AI in the loop.
            </p>
          </div>
          {/* Phase indicator strip */}
          <div className="hidden md:flex items-center gap-1 text-[10px] uppercase tracking-wider text-[hsl(215,16%,47%)]">
            <PhaseDot active={phase === "upload"} done={["paint", "corners", "apply"].includes(phase)} label="1 Upload" />
            <ArrowRight className="h-3 w-3 opacity-40" />
            <PhaseDot active={phase === "paint"} done={["corners", "apply"].includes(phase)} label="2 Paint" />
            <ArrowRight className="h-3 w-3 opacity-40" />
            <PhaseDot active={phase === "corners"} done={phase === "apply"} label="3 Corners" />
            <ArrowRight className="h-3 w-3 opacity-40" />
            <PhaseDot active={phase === "apply"} done={false} label="4 Apply" />
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 pb-24">
        {phase === "upload" && (
          <div className="space-y-8">
            <PhotoUpload file={photoFile} onChange={setPhotoFile} />
            <div className="flex items-center justify-end">
              <Button
                onClick={() => setPhase("paint")}
                disabled={!photoFile}
                size="lg"
                data-testid="draw-upload-continue"
              >
                Continue <ArrowRight className="h-4 w-4 ml-1.5" />
              </Button>
            </div>
            <p className="text-xs text-[hsl(215,16%,47%)] max-w-2xl">
              Tip: take or pick a photo where the wall you want to panel is well-lit
              and not heavily covered by furniture.  You'll be able to paint over
              objects in front of the wall in the next step so they aren't hidden by
              the panel render.
            </p>
          </div>
        )}

        {phase === "paint" && (
          <FurniturePainter
            photoFile={photoFile}
            onConfirm={(maskCanvas) => { setMask(maskCanvas); setPhase("corners"); }}
            onBack={() => setPhase("upload")}
          />
        )}

        {phase === "corners" && (
          <WallCornerPicker
            photoFile={photoFile}
            mask={mask}
            onConfirm={(quad) => { setCorners(quad); setPhase("apply"); }}
            onBack={() => setPhase("paint")}
          />
        )}

        {phase === "apply" && (
          <PanelComposer
            photoFile={photoFile}
            mask={mask}
            corners={corners}
            defaultPanel={defaultPanel}
            onReset={reset}
          />
        )}

        <p className="text-xs text-[hsl(215,16%,47%)] mt-12 max-w-2xl">
          Visualisations are indicative only — actual installed panel colour, sheen
          and grain will vary with lighting.  For specification-grade samples, order
          a physical swatch.
        </p>
      </main>
    </div>
  );
}

function PhaseDot({ active, done, label }) {
  const baseColor = active
    ? "text-[hsl(var(--accent))] font-semibold"
    : done
    ? "text-[hsl(215,25%,27%)]"
    : "text-[hsl(215,16%,60%)]";
  return <span className={baseColor}>{label}</span>;
}
