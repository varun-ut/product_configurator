# Wall Visualizer (standalone, Claude-powered)

A separate route at **`/visualizer`** where the user uploads a room photo and
sees UniVicoustic panels composited onto their actual walls. Built as a
parallel feature so the main configurator stays untouched, and so the whole
thing can be removed without surgery.

**Architecture:** Tier C (Wizart-equivalent) using Claude vision for wall
detection plus a pure-canvas homography compositor for the actual perspective
warp. No third-party SaaS dependency, no Wizart subscription.

```
User uploads room photo
        ↓
[Frontend] base64-encode + POST /api/visualize-walls
        ↓
[Backend] forwards image + strict-JSON prompt to claude-sonnet-4-5
        ↓
[Backend] returns { walls: [{ corners, type, lighting_direction, ... }] }
        ↓
[Frontend WallEditor]
        ├── render room photo on <canvas>
        ├── for each wall, warp panel texture into the quadrilateral via
        │   the homography compositor (homographyComposite.js)
        └── show 4 SVG-overlay handles per active wall for fine-tuning
```


## Setup

1. **Set the Anthropic API key on the backend.**  Edit `backend/.env`:

   ```
   ANTHROPIC_API_KEY=sk-ant-api03-…your-key…
   ```

   The same key already powers the chat endpoint, so if `/chat` works the
   visualizer works too — no extra config.

2. **Install backend deps if you haven't already** (the `anthropic` Python
   SDK is already pinned in `requirements.txt`):

   ```
   cd backend
   pip install -r requirements.txt
   ```

3. **Restart both servers** (CRA reads env at startup; FastAPI reads `.env`
   on app boot):

   ```
   # terminal 1
   cd backend && uvicorn server:app --reload

   # terminal 2
   cd frontend && npm start
   ```

4. **Visit** http://localhost:3000/visualizer.


## File map (this folder)

| File | Purpose |
|---|---|
| `VisualizerPage.jsx` | Route component. Owns the high-level flow: setup → detecting → editing/error. |
| `PanelPicker.jsx` | 8-tile grid of UniVicoustic panel cutouts to pick a default panel. |
| `PhotoUpload.jsx` | Drag-drop / click-to-upload, 10 MB cap, image-only validation. |
| `WallEditor.jsx` | The editor surface — canvas + SVG handles + per-wall panel picker. |
| `homographyComposite.js` | Pure-canvas 2D perspective warp. Solves a 3×3 homography from 4 dst points, blits the texture via a 32×32 triangle grid. |
| `claudeWallEngine.js` | Thin frontend wrapper that POSTs the photo to `/api/visualize-walls` and normalises the JSON Claude returns. |
| `samplePanels.js` | Hard-coded list of 8 panel cutouts (URLs into our existing CDN). Keeps this module independent of `src/data/skus.js`. |
| `wizartClient.js` | **Vestigial.** Earlier draft when the plan was Wizart-API-based. Kept on disk in case you ever want to swap back; nothing imports it. |


## Backend endpoint (lives in `server.py`)

`POST /api/visualize-walls`

**Body:**
```json
{
  "image_base64": "<raw base64, no data: prefix>",
  "image_mime": "image/jpeg"
}
```

**Response:**
```json
{
  "image_size": { "w": 3024, "h": 4032 },
  "walls": [
    {
      "id": "wall-1",
      "type": "back",
      "corners": [
        { "x": 412, "y": 380 },
        { "x": 2410, "y": 372 },
        { "x": 2418, "y": 2890 },
        { "x": 405, "y": 2902 }
      ],
      "lighting_direction": "from-left",
      "confidence": 0.86,
      "notes": "Main back wall, evenly lit"
    }
  ]
}
```

**Errors:**
- `400` malformed image data
- `413` image >10 MB after base64 stripping
- `429` IP rate-limit (20 req / 60 s — shared with `/chat`)
- `503` `ANTHROPIC_API_KEY` missing on the server


## Removing the feature

Three deletions, no other side effects:

```bash
# 1. Frontend module
rm -rf frontend/src/visualizer/

# 2. Frontend route + import (one entry each)
# In frontend/src/App.js, remove:
#   import VisualizerPage from "@/visualizer/VisualizerPage";
#   <Route path="/visualizer" element={<VisualizerPage />} />

# 3. Backend endpoint
# In backend/server.py, remove the /api/visualize-walls endpoint and
# its supporting constants (_VIS_PRICE_*, _WALL_VISION_PROMPT, the
# VisualizeWallsRequest model).
```

No code outside these locations imports anything from the visualizer.


## What's NOT included (yet)

- **Furniture occlusion.**  Panel will draw over any sofa or bookshelf in
  front of the wall.  Workaround: drag the corner handles to cover only the
  visible portion.  Real fix: add a "wipe out" brush mode that lets the user
  paint occluding objects, OR pipe an extra segmentation step (SAM2 via
  Replicate, ~$0.01/image) for an automatic furniture mask.
- **Lighting / shadow transfer.**  The composited panel inherits the room's
  lighting only insofar as our panel cutouts already have neutral lighting.
  No per-pixel relighting.  Visible panels with strong directional shadows
  in the room photo may look "stickered on."
- **Multi-image upload / before-after slider.**  Could lift the existing
  Compare-mode component from the configurator if it becomes a request.
- **Mobile photo capture.**  Camera input works in mobile browsers (we use
  `<input type="file" accept="image/*">` which prompts for camera on iOS/
  Android), but no native UX yet.


## Cost notes

Each visualization makes ONE Claude vision call.  At Sonnet rates
(approx. $0.005 per image at typical room-photo sizes), 1000 sessions ≈ $5.
The backend logs cost per request to `backend/chatbot_logs/<date>.jsonl`
under the `endpoint: "visualize-walls"` filter, so you can audit spend.
