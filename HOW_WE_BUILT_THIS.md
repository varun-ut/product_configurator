# How We Built the UniVicoustic Product Configurator

A technical deep-dive into the architecture, decisions, and implementation details behind the acoustic panel configurator.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [High-Level Architecture](#2-high-level-architecture)
3. [Backend](#3-backend)
   - [Stack & Server Setup](#31-stack--server-setup)
   - [Static Asset Serving & Thumbnail Cache](#32-static-asset-serving--thumbnail-cache)
   - [Data Model](#33-data-model)
   - [Product Catalogue Generation](#34-product-catalogue-generation)
   - [API Endpoints](#35-api-endpoints)
   - [Emboss / Deboss Image Engine](#36-emboss--deboss-image-engine)
4. [Frontend](#4-frontend)
   - [Stack & Project Setup](#41-stack--project-setup)
   - [App Entry & Routing](#42-app-entry--routing)
   - [Configurator Page](#43-configurator-page)
   - [State Management](#44-state-management)
   - [Preview Components](#45-preview-components)
   - [Double-Buffer Loading Pattern](#46-double-buffer-loading-pattern)
   - [Emboss UI](#47-emboss-ui)
   - [Favorites & Download](#48-favorites--download)
5. [Asset Organisation](#5-asset-organisation)
   - [Panel Thumbnails (categories)](#51-panel-thumbnails-categories)
   - [Furniture & T-Patti Overlays](#52-furniture--t-patti-overlays)
   - [Emboss Pattern Thumbnails](#53-emboss-pattern-thumbnails)
   - [VicStrip Panel Images](#54-vicstrip-panel-images)
6. [Design Systems & Naming Conventions](#6-design-systems--naming-conventions)
   - [Design Code Format](#61-design-code-format)
   - [File Naming Convention](#62-file-naming-convention)
   - [Panel Variants (single vs. continuous)](#63-panel-variants-single-vs-continuous)
7. [Adding New Content](#7-adding-new-content)
   - [Adding a New Design to an Existing Category](#71-adding-a-new-design-to-an-existing-category)
   - [Adding a Completely New Category](#72-adding-a-completely-new-category)
8. [Technical Specifications System](#8-technical-specifications-system)
9. [Performance Optimisations](#9-performance-optimisations)
10. [Development & Running Locally](#10-development--running-locally)

---

## 1. Project Overview

The UniVicoustic Product Configurator is a single-page web app that lets users visually configure acoustic wall panels from several product ranges. The user can:

- Select a **product type** (e.g. *Bespoke Graphics VMD*, *VicStrip Panels*, *Colored HD Ombre*)
- Browse **categories** within that product type (e.g. *Marble*, *Line & Texture*, *Indian Modern*)
- Select an individual **design** (a specific texture/print)
- Optionally apply an **emboss finish** overlay (Flux Ribbed, Ribbed 45mm, etc.)
- Toggle a **T-Patti** decorative trim overlay
- Save designs to **Favorites** and **download** panel images
- View a live layered **room-scene preview** showing exactly how the panel looks installed
- Read **Technical Specifications** (fire rating, NRC, thickness, certifications, etc.)

---

## 2. High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         Browser (React SPA)                           │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │  Configurator.jsx  (single page, all UI state lives here)       │ │
│  │                                                                   │ │
│  │  ┌──────────────┐  ┌──────────────────────┐  ┌──────────────┐  │ │
│  │  │  Left Panel  │  │  Centre Preview       │  │ Right Panel  │  │ │
│  │  │  (controls)  │  │  (room scene / strip) │  │ (tech specs) │  │ │
│  │  └──────────────┘  └──────────────────────┘  └──────────────┘  │ │
│  └─────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
         │  axios HTTP                │  /static/ direct image load
         ▼                            ▼
┌──────────────────────────────────────────────────────────────────────┐
│                      FastAPI Backend  (Python)                         │
│                                                                        │
│  /api/products          →  product catalogue JSON                      │
│  /api/products/{id}/specs  →  tech specs JSON                         │
│  /thumb/{path}          →  on-demand JPEG thumbnail (200×200)         │
│  /static/{path}         →  raw static file (full-res)                 │
│  /tech-specs/{file}     →  HTML wrapper page embedding PDF            │
└──────────────────────────────────────────────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────────────────────────────────────┐
│               backend/static/images/                                   │
│    flat-embossed-vmt/                                                  │
│        panels/       ← per-category design images                     │
│        furniture/    ← per-category room-scene PNG (transparent wall) │
│        tpatti/       ← per-category T-Patti overlay PNG               │
│        emboss-panels/        ← pre-processed emboss overlay PNGs      │
│        embossed_line_thumbnails/  ← sidebar emboss previews           │
│    vicstrip/                 ← per-pattern / per-colour images        │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 3. Backend

### 3.1 Stack & Server Setup

| Component | Choice | Version |
|-----------|--------|---------|
| Web framework | **FastAPI** | 0.129.0 |
| ASGI server | **Uvicorn** | 0.40.0 |
| Data validation | **Pydantic v2** | 2.12.5 |
| Image processing | **Pillow** | 12.1.1 |
| CV emboss engine | **OpenCV (cv2)** | 4.13.0 |
| Env config | **python-dotenv** | 1.2.1 |
| Runtime | **Python** | 3.11+ |

The main entry point is `backend/server.py`. The app is created as a FastAPI instance, then:

1. `/static` is mounted via `StaticFiles` to serve everything under `backend/static/` (images, PDFs).
2. A `/api` prefix router (`APIRouter`) handles all data endpoints.
3. CORS middleware allows the React dev server (usually `localhost:3000`) and any configured origin.

```python
app = FastAPI()
app.mount("/static", StaticFiles(directory=ROOT_DIR / "static"), name="static")

api_router = APIRouter(prefix="/api")
app.include_router(api_router)
```

### 3.2 Static Asset Serving & Thumbnail Cache

Full-resolution panel images can be several MB. Rather than send those to the thumbnail grid, the backend has a **`/thumb/{path}`** endpoint that:

1. Resolves the source image under `backend/static/images/{path}`.
2. Checks a persistent **disk cache** at `backend/static/_thumbcache/{path}`.
3. If the cache file doesn't exist, opens the source with Pillow, converts to RGB, centre-crops and resizes to **200×200 px** using `ImageOps.fit` (equivalent to CSS `object-fit: cover`), saves as JPEG quality 82.
4. Returns the cached JPEG via `FileResponse`.

This means the first request for any thumbnail is slightly slower (disk write), but all subsequent loads — including across browser sessions — are instant file reads. The thumbnail path mirrors the source path exactly, so cache invalidation is trivially done by deleting the `_thumbcache` file.

### 3.3 Data Model

Pydantic models define the shape of the catalogue:

```
ProductType
  └── ProductCategory[]
        └── ProductDesign[]
```

Key fields on **`ProductDesign`**:

| Field | Purpose |
|-------|---------|
| `id` | Unique string identifier |
| `product_type` | Parent product type ID (e.g. `"flat-embossed-vmd"`) |
| `category` | Category name (human-readable, e.g. `"Marble"`) |
| `design_code` | SKU / design code shown to users (e.g. `"ST-NC-01"`) |
| `texture_url` | Full path to the design image (or primary slice for continuous) |
| `thumbnail_url` | Path that goes through `/thumb/` for a resized preview |
| `panel_variant` | `"single"` (default) or `"continuous"` (multi-slice) |
| `texture_urls` | List of per-column URLs — only set when `panel_variant == "continuous"` |
| `available_emboss` | List of emboss pattern IDs that work with this design |

### 3.4 Product Catalogue Generation

All product data is generated at server startup by `generate_mock_products()`. This function:

1. Defines `EXPLICIT_CATEGORY_DESIGNS` — a dictionary keyed by category name where every entry is a hand-authored list of designs with real image paths.
2. For categories not yet in `EXPLICIT_CATEGORY_DESIGNS`, auto-generates placeholder designs (solid colour swatches) so they appear in the UI without crashing.
3. Iterates `vmd_categories_non_emboss` and `vmd_categories_emboss` lists to build the VMD product.
4. Appends Colored HD Ombre Panels (gradient colour swatches, no images yet).
5. Appends VicStrip Panels (image path derived from `vicstrip/{patternId}/{colorId}.jpg`).

The result is stored in `MOCK_PRODUCTS` — a module-level list read by the `/api/products` endpoint on every request. No database is used; the catalogue is entirely in-memory.

**How emboss availability is encoded:**
```python
{
  "design_code": "ST-NC-01",
  "available_emboss": ["flux_ribbed", "ribbed_45mm", "ribbed_60mm", "tappered"],
}
```
A design with an empty `available_emboss` list shows the emboss panel as disabled in the UI.

### 3.5 API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/` | Health check |
| GET | `/api/products` | Full catalogue (all product types, categories, designs) |
| GET | `/api/products/{product_id}` | Single product type |
| GET | `/api/products/{product_id}/specs` | Technical specs JSON |
| GET | `/thumb/{path}` | Thumbnail endpoint (200×200 JPEG, cached) |
| GET | `/tech-specs/{filename}` | HTML page embedding a tech-spec PDF |
| GET | `/static/{path}` | Raw static file (image, PDF, etc.) |

### 3.6 Emboss / Deboss Image Engine

Three separate Python modules handle image-based emboss effects. These are **offline tools**, not called at runtime — they are used to pre-generate the overlay PNGs stored in `backend/static/images/flat-embossed-vmt/emboss-panels/`.

#### `deboss_engine.py`
CLI + importable function. Takes a **panel background image** and a **line-pattern image** and outputs a full-panel debossed/embossed result by:

1. Extracting a line mask (dark-lines-on-light-background detection, auto-adapts to inverted palettes).
2. Building a **height map** by Gaussian-blurring the mask.
3. Deriving a **normal map** (surface angles) using Sobel derivatives.
4. Computing **Phong illumination** as a dot product of normals with a configurable light direction vector.
5. Separating highlights/shadows and doing additive blending onto the original image.

Config lives in `backend/config.json` (blur, depth, light direction, shadow/highlight strength).

#### `emboss_layer.py`
Generates a **transparent RGBA overlay PNG** from a line-pattern that can be placed over *any* panel texture in the browser without per-panel pre-processing. Uses a front-facing light (uniform bevel around every line edge regardless of orientation) making it suitable for organic, curved, and geometric patterns alike.

This is what the browser actually composites — the overlay is fetched once and reused for any design in that emboss category.

#### `deboss_engine_l.py`
An alternate deboss pipeline with different normalisation / light handling, used for specific pattern types.

#### `deboss_pipeline.py` (OpenCV version)
Lower-level OpenCV-based pipeline used during development and batch processing. Generates normal maps from Sobel derivatives and applies illumination via dot product — same algorithm as `deboss_engine.py` but exposed as a single function call for scripting.

#### `helper.py` / `helper2.py`
Utility scripts — `helper.py` tiles a small PNG into a 3000×3000 pattern canvas; `helper2.py` handles additional preprocessing steps.

---

## 4. Frontend

### 4.1 Stack & Project Setup

| Component | Choice | Version |
|-----------|--------|---------|
| Framework | **React** | 19 |
| Routing | **React Router v7** | 7.5.1 |
| Build tool | **Create React App** (CRACO) | — |
| HTTP client | **Axios** | 1.8.4 |
| UI components | **shadcn/ui** (Radix UI primitives) | various |
| Styling | **Tailwind CSS** | 3 |
| Icons | **Lucide React** | 0.507.0 |
| Toasts | **Sonner** | 2.0.3 |
| Download | **JSZip + file-saver** | — |
| Image conversion | **html-to-image** | 1.11.13 |

CRACO (`craco.config.js`) is used to extend CRA's webpack config without ejecting — it applies two custom plugins:
- `webpack-health-plugin.js` — exposes health-check endpoints during dev
- `babel-metadata-plugin.js` — injects component metadata for dev tooling

Path aliases are configured in `jsconfig.json` (`@/` → `src/`).

### 4.2 App Entry & Routing

`src/index.js` renders `<App />` into `#root`. `src/App.js` wraps everything in `BrowserRouter` and defines a single route:

```jsx
<Route path="/" element={<Configurator />} />
```

There is only one page. The `<Toaster>` from Sonner is mounted at top level for global toast notifications.

### 4.3 Configurator Page

`src/pages/Configurator.jsx` — the entire application UI lives here (~1200 lines). The layout is:

```
┌────────────────────────────────────────────────────────┐
│  Header  (product type selector, favourites, zoom)     │
├──────────┬──────────────────────────────────┬──────────┤
│  Left    │        Centre                    │  Right    │
│  Sidebar │     Preview                      │  Sidebar  │
│          │                                  │           │
│ Category │  FlatEmbossedPreview             │ TechSpecs │
│ selector │    or                            │           │
│ Design   │  VicStripPreview                 │           │
│ grid     │    or                            │           │
│ Emboss   │  CanvasPreview                   │           │
│ options  │                                  │           │
│ Size/    │                                  │           │
│ Thickness│                                  │           │
└──────────┴──────────────────────────────────┴──────────┘
```

Module-level components (defined **outside** `Configurator()`) avoid re-mounting on parent re-renders:
- `TechSpecsPanel` — displays fire rating, NRC, material, sustainability, certs
- `DesignThumbnail` — a `memo`-ised thumbnail with hover card preview + download button
- `EmbossThumbnail` — emboss pattern tile with X overlay when unavailable for current design

### 4.4 State Management

All state lives in the `Configurator` component via `useState`. No Redux or Context is used.

| State | Type | Purpose |
|-------|------|---------|
| `products` | `array` | Full catalogue fetched from API |
| `selectedProductType` | `object` | Currently active product (e.g. `flat-embossed-vmd`) |
| `selectedCategory` | `object` | Active category within the product |
| `selectedDesign` | `object` | The chosen texture/print |
| `selectedSize` | `string` | Panel dimension selection |
| `selectedThickness` | `string` | Thickness option |
| `selectedEmbossPattern` | `object\|null` | Which emboss finish is applied |
| `isEmbossed` | `bool` | Legacy emboss toggle (kept for backward compat) |
| `showTpatti` | `bool` | Whether T-Patti overlay is shown |
| `favorites` | `array` | Saved configurations (persisted to `localStorage`) |
| `techSpecs` | `object\|null` | Specs from API or defaults |
| `zoomLevel` | `number` | Canvas zoom (0.5 → 5.0, step 0.25) |

Key event handlers:
- `handleProductTypeChange` — clears all sub-selections, re-initialises for the new product type
- `handleCategoryChange` — resets emboss + selects first design in new category
- `handleDesignSelect` — unified handler for VMD designs and VicStrip colour/pattern combos
- `handleEmbossPatternSelect` — toggle behaviour (clicking active pattern deselects it; selecting emboss clears T-Patti)

### 4.5 Preview Components

#### `FlatEmbossedPreview` (`src/components/FlatEmbossedPreview.jsx`)

CSS layer-based room-scene preview for Flat / Embossed VMT panels. Layer stack (bottom → top):

| z-index | Layer | Source |
|---------|-------|--------|
| 2 | Panel columns | Design images side-by-side (3× repeat) |
| 3 | Emboss overlay | Transparent RGBA PNG over the panels |
| 4 | T-Patti overlay | Decorative trim PNG |
| 5 | Furniture | Room photo with transparent wall cutout |
| 9 | Ghost | Old-state snapshot for zero-flash transitions |
| 10 | Preloader | Spinner + blur |

The **furniture PNG** is the only element in normal flow — it sets the natural height/width of the entire preview. All other layers are `position: absolute` and stretch to 100% of the furniture's bounding box. This means the preview automatically scales to fit any browser height.

Each category has a config entry in `FLAT_EMBOSSED_VMT_CONFIG` in `src/data/skus.js`:

```js
"vmd-marble": {
  furniture: `${BACKEND_URL}/static/images/flat-embossed-vmt/furniture/vmd-marble.png`,
  tpatti:    `${BACKEND_URL}/static/images/flat-embossed-vmt/tpatti/vmd-marble.png`,
  renderMode: "portrait",
  repeat: 3,            // number of panel columns
  mirrorCenter: true,   // flip centre panel for symmetric patterns
  panelWidth: 1200,     // real dimensions in mm (used for CSS aspect-ratio)
  panelHeight: 2800,
}
```

For **continuous designs** (panel_variant = `"continuous"`), each column gets its own image slice (`texture_urls[0]`, `[1]`, `[2]`). For standard designs, the same `textureUrl` is repeated across all columns.

#### `VicStripPreview` (`src/components/VicStripPreview.jsx`)

Simpler preview for VicStrip — no room scene canvas. Displays the selected VicStrip panel image directly, using the same double-buffer transition logic as `FlatEmbossedPreview` (see [Section 4.6](#46-double-buffer-loading-pattern)). Falls back to a solid colour tile when no image URL is available.

#### `CanvasPreview` (`src/components/CanvasPreview.jsx`)

Alternative canvas-based preview used for products without a room scene (e.g. Colored HD Ombre panels). Renders a tiled grid of colour swatches.

### 4.6 Double-Buffer Loading Pattern

Both `FlatEmbossedPreview` and `VicStripPreview` implement the same **double-buffer** pattern to avoid white flashes and jarring transitions:

```
User selects new design
       │
       ▼
1. FREEZE current display (don't update visible layers yet)
2. Snapshot current displayed state into GHOST layer (z-9)
3. Start MIN_LOADING_MS timer in parallel
4. Mount new <img> elements with new URLs — they decode BEHIND the ghost
5. Show preloader spinner + blur (covers the ghost from user)
6. img.decode() new assets
7. When BOTH timer AND decode done:
       → Drop ghost + drop preloader in ONE React batch
       → Clean atomic reveal — user never sees a white frame
```

Critical detail: the **ghost layer** shows the previously-displayed state using images already in browser memory cache — zero additional network requests, zero latency. The preloader blur hides the ghost from the user while new images decode.

Two timing constants control the UX feel:
- `MIN_LOADING_MS = 400` — minimum time the spinner is shown (prevents flicker for fast loads)
- `POST_REVEAL_HOLD_MS = 1000` — extra hold after new image is ready, giving the browser time to composite all layers before revealing

### 4.7 Emboss UI

The emboss panel in the sidebar shows up to 4 pattern options (Flux Ribbed, Ribbed 45mm, Ribbed 60mm, Tappered). Each option uses an `EmbossThumbnail`:

- If the current design's `available_emboss` array includes the pattern's ID, it is **clickable**.
- If not, it is **greyed out** with an X overlay.
- Clicking a pattern that is already selected **deselects** it (toggle behaviour).
- Selecting an emboss pattern **clears T-Patti** (they are mutually exclusive).

The emboss overlay URL is resolved as:
```
/static/images/flat-embossed-vmt/emboss-panels/{designCode}/{embossPatternId}.png
```

Pre-generated by the offline `emboss_layer.py` tool.

### 4.8 Favorites & Download

**Favorites** are stored in `localStorage` under the key `univicoustic_favorites`. Each saved entry captures the full configuration object (design, size, thickness, emboss pattern, product type, category).

**Download** is handled by `src/lib/downloadPanelImages.js`:

- For **continuous designs**: fetches all slice URLs (`texture_urls`), bundles them into a ZIP file using JSZip, and triggers a browser download via `file-saver`.
- For **single designs**: fetches `texture_url` directly and saves the file.
- On any fetch failure, falls back to opening the URL(s) in new browser tabs.

A per-thumbnail **Download Panel** button also exists in every `DesignThumbnail` hover card.

---

## 5. Asset Organisation

```
backend/static/images/
├── flat-embossed-vmt/
│   ├── panels/
│   │   ├── vmd-line-and-texture/       ← VMD-LT-001.jpg … VMD-LT-025-3.jpg
│   │   ├── vmd-rhythm-and-repeat/      ← VMD-RR-001.jpg … VMD-RR-025.jpg
│   │   ├── vmd-quiet-bloom/            ← VMD-QB-001.jpg … VMD-QB-009.jpg
│   │   ├── vmd-indian-modern/          ← VMD-IM-001.jpg … VMD-IM-008.jpg
│   │   ├── vmd-color-block/            ← VMD-CB-001-A.jpg, VMD-CB-001-B.jpg, …
│   │   ├── vmd-fun-and-fantasy/        ← VMD-FF-001-A.jpg … VMD-FF-003-C.jpg
│   │   ├── vmd-marble/                 ← ST-NC-01-1200x2800.jpg … ST-NC-32…
│   │   ├── vmd-wood-classics/          ← WD-NC-01-1200x2800.jpg … WD-NC-37…
│   │   ├── vmd-leather/                ← LH-BR-01-1200x2800.jpg … LH-NE-02…
│   │   ├── vmd-luxury-textures/        ← FB-PT-39-1200x2800.jpg … FB-PT-86…
│   │   ├── vmd-modern-corporate/       ← FB-PT-44… FB-PT-87…
│   │   ├── vmd-pattered-weaves/        ← FB-PT-43… WP-GR-02…
│   │   ├── vmd-soft-texture/           ← TP-BL-01… TP-PU-02…
│   │   ├── vmd-nature-reimagined/      ← NA-BL-01… WP-OR-02…
│   │   └── vmd-woven-brushwork/        ← AB-BL-01… WP-NC-07…
│   ├── furniture/
│   │   └── vmd-{category-id}.png       ← one per category (transparent wall cutout)
│   ├── tpatti/
│   │   └── vmd-{category-id}.png       ← one per category (optional trim overlay)
│   ├── emboss-panels/
│   │   └── {designCode}/
│   │       └── {embossPatternId}.png   ← pre-generated RGBA overlay
│   └── embossed_line_thumbnails/
│       ├── flux_ribbed.png
│       ├── ribbed_45mm.png
│       ├── ribbed_60mm.png
│       └── tappered.png
└── vicstrip/
    ├── single-groove/                  ← {colorId}.jpg  (16 colours)
    ├── double-groove/
    ├── square/
    └── double-square/
```

### 5.1 Panel Thumbnails (categories)

Each design image lives at:
```
panels/{categoryId}/{designCode}.jpg
```
For **continuous (multi-panel) designs** the files are:
```
panels/{categoryId}/{designCode}-A.jpg   (or -1.jpg / -B.jpg etc.)
panels/{categoryId}/{designCode}-B.jpg
panels/{categoryId}/{designCode}-C.jpg
```

### 5.2 Furniture & T-Patti Overlays

Each VMD category has exactly **one** furniture PNG and **one** T-Patti PNG, both named after the backend category ID:
```
furniture/vmd-marble.png
tpatti/vmd-marble.png
```
The furniture PNG has a **transparent wall area** — the panel layer shines through exactly where the wall is. T-Patti is a semi-transparent decorative overlay shown on top of the panels.

### 5.3 Emboss Pattern Thumbnails

Small PNG thumbnails shown in the sidebar emboss picker:
```
embossed_line_thumbnails/flux_ribbed.png
embossed_line_thumbnails/ribbed_45mm.png
embossed_line_thumbnails/ribbed_60mm.png
embossed_line_thumbnails/tappered.png
```

### 5.4 VicStrip Panel Images

```
vicstrip/{patternId}/{colorId}.jpg
```
e.g. `vicstrip/single-groove/alpine-frost.jpg`

Pattern IDs and colour IDs are defined in `src/data/skus.js` (the `VICSTRIP_PRODUCT` constant) — the backend also includes this data in the catalogue but the frontend's `VICSTRIP_PRODUCT` is the canonical source for the preview path construction.

---

## 6. Design Systems & Naming Conventions

### 6.1 Design Code Format

Design codes follow the naming system of the underlying product line:

| Category / Code prefix | Example | Pattern |
|------------------------|---------|---------|
| VMD Line & Texture | `VMD-LT-001` | VMD-{abbrev}-{seq} |
| VMD Rhythm & Repeat | `VMD-RR-025` | |
| VMD Quiet Bloom | `VMD-QB-009` | |
| VMD Indian Modern | `VMD-IM-008` | |
| VMD Color Block | `VMD-CB-009` | |
| VMD Fun & Fantasy | `VMD-FF-003` | |
| Marble (Stone) | `ST-NC-01` | {material}-{colorGroup}-{seq} |
| Wood Classics | `WD-NC-01` | |
| Leather | `LH-BR-01`, `LH-GR-01` | LH-{colorGroup}-{seq} |
| Luxury Textures | `FB-PT-39` | |
| Modern Corporate | `FB-PT-44` | |
| Patterned Weaves | `FB-PT-43` | |
| Soft Texture | `TP-NE-01` | |
| Nature Reimagined | `NA-BL-01`, `WP-GR-04` | Mixed |
| Woven Brushwork | `SR-NC-02`, `AB-BL-01` | Mixed |

### 6.2 File Naming Convention

Raw files supplied by the design team often include extra info (size, material name in parentheses). The convention for files used by the configurator is to keep only the **design code**, stripped of `1200x2800` dimensions and any parenthetical name:

```
Original:  WD-NC-18-1200x2800(Almond_OAK).jpg
Clean:     WD-NC-18.jpg

Original:  FB-PT-39-1200x2800.jpg
Clean:     FB-PT-39.jpg

Original:  NA-BL-01-PanelA-1200x2800.jpg   (continuous slice)
Clean:     NA-BL-01-A.jpg
```

### 6.3 Panel Variants (single vs. continuous)

Some designs require **3 separate panels** to form one seamless pattern. The backend encodes this with `panel_variant: "continuous"` and a `texture_urls` list. The frontend distributes the three URLs to the three preview columns:

```js
// Continuous design entry in server.py:
{
  "panel_variant": "continuous",
  "texture_url":  "/static/…/VMD-LT-024-1.jpg",   // sidebar thumbnail
  "texture_urls": [
    "/static/…/VMD-LT-024-1.jpg",   // left column
    "/static/…/VMD-LT-024-2.jpg",   // centre column
    "/static/…/VMD-LT-024-3.jpg",   // right column
  ]
}
```

Download bundles all three slices into a ZIP file automatically.

---

## 7. Adding New Content

### 7.1 Adding a New Design to an Existing Category

1. **Drop the image file** into `backend/static/images/flat-embossed-vmt/panels/{categoryId}/`.
2. **Add a design entry** in `EXPLICIT_CATEGORY_DESIGNS["{Category Name}"]` inside `generate_mock_products()` in `server.py`:

```python
{
    "id": "vmd-design-lt-026",
    "product_type": "flat-embossed-vmd",
    "category": "Line & Texture",
    "design_code": "VMD-LT-026",
    "design_name": "Line & Texture Design 26",
    "texture_color": "#A0A0A0",   # hex fallback colour
    "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-line-and-texture/VMD-LT-026.jpg",
    "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-line-and-texture/VMD-LT-026.jpg",
    "color_name": "Cool Stone",
},
```

3. No frontend changes needed — the design appears automatically on next API fetch.

For **emboss-enabled** designs also add:
```python
"available_emboss": ["flux_ribbed", "ribbed_45mm", "ribbed_60mm", "tappered"],
```

For **continuous designs** see the `VMD-LT-024` or `VMD-CB-002` examples.

### 7.2 Adding a Completely New Category

1. **Create the folder** `backend/static/images/flat-embossed-vmt/panels/vmd-{your-category}/` and add design images.
2. **Add furniture PNG** at `backend/static/images/flat-embossed-vmt/furniture/vmd-{your-category}.png`.
3. **Add T-Patti PNG** at `backend/static/images/flat-embossed-vmt/tpatti/vmd-{your-category}.png` (or omit and set `tpatti: null` in the config).
4. **Register designs** in `EXPLICIT_CATEGORY_DESIGNS` in `server.py`.
5. **Add category to the list** — either `vmd_categories_non_emboss` or `vmd_categories_emboss` in `generate_mock_products()`.
6. **Add frontend config entry** in `FLAT_EMBOSSED_VMT_CONFIG` in `src/data/skus.js`:

```js
"vmd-your-category": {
  furniture: `${BACKEND_URL}/static/images/flat-embossed-vmt/furniture/vmd-your-category.png`,
  tpatti:    `${BACKEND_URL}/static/images/flat-embossed-vmt/tpatti/vmd-your-category.png`,
  renderMode: "portrait",
  repeat: 3,
  panelWidth: 1200,
  panelHeight: 2800,
},
```

The category ID used as the key must be:
```
"vmd-" + categoryName.toLowerCase().replace(/ /g,"-").replace(/&/g,"and")
```
which is the same transform the backend applies when auto-generating category IDs.

---

## 8. Technical Specifications System

Each product type has a `TECH_SPECS` dictionary entry in `server.py`:

```python
TECH_SPECS = {
    "flat-embossed-vmd": {
        "fire_rating": "Class A (ASTM E84)",
        "nrc_rating": "0.85 - 0.95",
        "sustainability": ["FSC Certified", "GREENGUARD Gold", "Red List Free"],
        "material": "High-Density Polyester Fiber",
        "thickness_mm": "12-25mm",
        "weight_kg_m2": "2.4 - 4.8",
        "installation": "Adhesive / Mechanical Fix",
        "warranty": "10 Years",
        "certifications": ["ISO 14001", "ISO 9001", "OEKO-TEX Standard 100"]
    },
    ...
}
```

These are served at `/api/products/{productId}/specs`. The frontend fetches specs whenever `selectedProductType` changes (using a `useEffect`). If the API call fails the frontend falls back to a hardcoded `DEFAULT_SPECS` object so the specs panel always shows *something*.

PDF technical datasheets can be viewed via the `/tech-specs/{filename}` endpoint which wraps any `.pdf` under `backend/static/technical_specification_pdfs/` in a minimal HTML page with a full-viewport `<embed>`.

---

## 9. Performance Optimisations

| Technique | Where | Effect |
|-----------|-------|--------|
| **Thumbnail cache** | `server.py /thumb/` | Full-res images not sent to thumbnail grid |
| **`React.memo`** on `DesignThumbnail`, `EmbossThumbnail`, `TechSpecsPanel` | `Configurator.jsx` | No re-render on unrelated parent state changes |
| **`useCallback`** on `saveFavorites` | `Configurator.jsx` | Stable reference prevents child re-renders |
| **`useRenderLog`** hook | All components | Dev-only render diff logging for profiling |
| **Module-level component definitions** | `Configurator.jsx` | Components defined outside parent function → React never unmounts/remounts them |
| **Double-buffer + ghost layer** | Both preview components | Zero white flash on texture change |
| **`MIN_LOADING_MS` + `img.decode()`** | Both preview components | New images decode off-screen before revealing |
| **`JSON.stringify` key** for `textureUrls` array dep | `FlatEmbossedPreview` | Avoids stale `useEffect` from array reference changes |
| **JPEG quality 82** in thumbnail generation | `server.py` | ~60% size reduction vs quality 100 |
| **`optimize: True`** Pillow flag | `server.py` | Huffman table optimisation on thumbnails |

---

## 10. Development & Running Locally

### Backend

```powershell
cd backend
myenv\Scripts\Activate.ps1   # activate virtual env
uvicorn server:app --reload --port 8001
```

The API is available at `http://localhost:8001/api/`.
The static file server is at `http://localhost:8001/static/`.

### Frontend

```powershell
cd frontend
npm install
npm start
```

The React dev server starts at `http://localhost:3000`.

Set `REACT_APP_BACKEND_URL=http://localhost:8001` in `frontend/.env` (or the default in `skus.js` applies).

### Running the Emboss Engine (offline)

```bash
python backend/emboss_layer.py \
  --pattern backend/static/images/flat-embossed-vmt/embossed_line_thumbnails/ribbed_60mm.png \
  --output output_overlay.png \
  --depth 2.0 \
  --bevel-width 30

python backend/deboss_engine.py \
  --panel my_panel.jpg \
  --pattern ribbed_pattern.png \
  --output result.png \
  --depth 1.5 \
  --light-angle 135
```

---

*Last updated: March 2026*
