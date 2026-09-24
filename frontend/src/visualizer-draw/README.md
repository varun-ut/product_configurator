# Wall Visualizer — Manual (`/visualizer-draw`)

A **second**, fully-isolated wall visualizer at the route `/visualizer-draw`.
Lives next to the existing AI-driven `/visualizer` (which uses Claude vision
for wall detection).  This one uses zero AI — the user paints a furniture
mask manually, then clicks four wall corners.  No API keys, no recurring
cost, works offline.

The two pages share **nothing** in code.  Either can be removed without
affecting the other.


## Why two?

| | `/visualizer` (AI) | `/visualizer-draw` (manual) |
|---|---|---|
| Wall detection | Claude vision returns 4 corner coords | User clicks 4 corners |
| Furniture occlusion | None (yet — pending Wizart RapidAPI key) | User paints a mask |
| Recurring cost | Claude API tokens (~$0.005/image) | $0 |
| Latency | 5-10 s round-trip to Anthropic | Local, instant |
| Best for | "Just upload, see panels" first impression | Production-quality renders, full control |
| Quality ceiling | Bound by Claude's spatial reasoning | Bound by user effort |


## Phase-by-phase flow

1. **Upload** — drag-drop / click to pick a room photo (10 MB cap).
2. **Paint furniture** — a drawing tool with brush + eraser + lasso, plus
   zoom (mouse wheel), pan (Space + drag), and undo (Ctrl+Z).  The user
   paints over anything that should NOT be covered by the panel — sofas,
   plants, the cat, etc.  Mask is stored at the photo's original pixel
   dimensions.
3. **Mark wall corners** — click 4 corners in TL → TR → BR → BL order.
   After all four are placed, each becomes a draggable handle for refinement.
   The painted furniture mask is shown as a translucent red overlay so the
   user can place corners with the mask in mind.
4. **Apply panel** — pick a panel, adjust the "panels across the wall"
   slider.  Live preview composites the photo + tiled panel + mask cutout
   on every change.  Download exports the canvas as PNG.


## File map

| File | Purpose |
|---|---|
| `DrawVisualizerPage.jsx` | Route component.  Owns the 5-phase state machine. |
| `PhotoUpload.jsx` | Drag-drop / click-to-upload, 10 MB cap. (Copy of `/visualizer/PhotoUpload.jsx` for full module isolation.) |
| `FurniturePainter.jsx` | The drawing tool — brush, eraser, lasso, zoom, pan, undo, clear. |
| `WallCornerPicker.jsx` | Click 4 corners + drag to refine.  Mirrors the SVG handle UX from `/visualizer`. |
| `PanelComposer.jsx` | Final phase — panel picker + tile-count slider + live preview + download. |
| `tiledHomography.js` | The compositor.  Solves a 3×3 homography per tile, warps the panel into N strips across the wall, then punches a destination-out hole through the warped result for every painted-mask pixel and re-fills the hole with the original room photo. |
| `samplePanels.js` | Flattens the full configurator catalog (VicStrip + Color Core + Designer Textile + Ombre + Wood Perforations, ~500 panels) into one list with `family` / `subfamily` metadata for the picker tabs.  Imports from `@/data/skus` so we don't duplicate SKU data — removing the visualizer is still a 2-line edit in App.js, no skus.js touched. |


## Panel-width logic (B1)

`tiledHomography.suggestTileCount(corners, panelW, panelH)` computes the
default tile count by matching the panel's natural aspect ratio to the
wall's pixel aspect.  The math:

```
wall_width      = average of top + bottom edge lengths in pixels
wall_height     = average of left + right edge lengths in pixels
suggested_tiles = round( (wall_width / wall_height) / (panel_w / panel_h) )
```

So a wide wall + a tall narrow panel → many tiles.  A square wall + a
square panel → 1 tile.  Capped at [1, 12] so a degenerate quadrilateral
can't spawn 60 absurdly thin tiles.

Once the user touches the slider, we stop overwriting their value when
they change panels — the manual choice sticks.


## Removing the feature

Two deletions, no other side effects:

```bash
# 1. Delete this folder
rm -rf frontend/src/visualizer-draw/

# 2. In frontend/src/App.js, remove these two lines:
#    import DrawVisualizerPage from "@/visualizer-draw/DrawVisualizerPage";
#    <Route path="/visualizer-draw" element={<DrawVisualizerPage />} />
```

No backend or env-var changes — this module touches no APIs.


## Known limits

- **Perspective tiling drift** — for extremely trapezoidal walls (a side
  wall seen from a very oblique angle), the linear-interpolation tile
  splitting isn't perfectly perspective-correct.  In practice the user
  bumps the slider one or two notches and it looks right.  Fully
  perspective-correct tile splitting would require interpolating in
  homography-corrected space; out of scope for v1.
- **Lighting transfer** — the panel inherits no lighting from the room
  photo.  Bright/dark photos may make the panel feel "stickered on."
  v1 limitation; add a brightness/contrast match step if it becomes
  a deal-breaker.
- **Single wall only.**  The page is one wall per session.  Multi-wall
  could come back if needed.
