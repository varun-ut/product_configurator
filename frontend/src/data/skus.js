// Hardcoded SKU data for VicStrip Panels
// Each pattern has 16 colors

// Colours are grouped visually in the picker by simple ordering — solid
// colours first, then wood finishes.  No header / divider in the UI; the
// adjacency is what creates the visual grouping.
const COLORS = [
  // ── Solid colours ───────────────────────────────────────────────────
  { id: "glacier-white",   name: "Glacier White",   hex: "#F8F8F8" },
  { id: "lunar-ash",       name: "Lunar Ash",       hex: "#B0B0B0" },
  { id: "merlot",          name: "Merlot",          hex: "#721F1F" },
  { id: "sage-green",      name: "Sage Green",      hex: "#838E7C" },
  { id: "carbon-black",    name: "Carbon Black",    hex: "#1C1C1C" },
  { id: "solara",          name: "Solara",          hex: "#78756C" },
  // ── Wood finishes ────────────────────────────────────────────────────
  { id: "alpine-frost",    name: "Alpine Frost",    hex: "#BCB9AB" },
  { id: "amber-walnut",    name: "Amber Walnut",    hex: "#A4A499" },
  { id: "auburn-oak",      name: "Auburn Oak",      hex: "#C99E61" },
  { id: "bourbon-walnut",  name: "Bourbon Walnut",  hex: "#41322B" },
  { id: "monarch-oak",     name: "Monarch Oak",     hex: "#8B5A2B" },
  { id: "obsidian-black",  name: "Obsidian Black",  hex: "#5B5849" },
  { id: "sierra-elm",      name: "Sierra Elm",      hex: "#9D5B37" },
  { id: "silver-birch",    name: "Silver Birch",    hex: "#C7BAA5" },
  { id: "toffee-oak",      name: "Toffee Oak",      hex: "#B17547" },
  { id: "windsor-oak",     name: "Windsor Oak",     hex: "#B5A680" },
];

// Canonical color-id → VCS thumbnail/panel code mapping. Source of truth for
// which VCS file shows which color: vcs0001.png == alpine-frost,
// vcs0008.png == merlot, vcs0015.png == toffee-oak, etc.
// COLORS array order (above) drives UI tile display order and is independent
// of this mapping — do NOT renumber to match COLORS index.
export const VICSTRIP_COLOR_TO_CODE = {
  "alpine-frost":    "VCS-0001",
  "amber-walnut":    "VCS-0002",
  "auburn-oak":      "VCS-0003",
  "bourbon-walnut":  "VCS-0004",
  "carbon-black":    "VCS-0005",
  "glacier-white":   "VCS-0006",
  "lunar-ash":       "VCS-0007",
  "merlot":          "VCS-0008",
  "monarch-oak":     "VCS-0009",
  "obsidian-black":  "VCS-0010",
  "sage-green":      "VCS-0011",
  "sierra-elm":      "VCS-0012",
  "silver-birch":    "VCS-0013",
  "solara":          "VCS-0014",
  "toffee-oak":      "VCS-0015",
  "windsor-oak":     "VCS-0016",
};

const PATTERNS = [
  {
    id: "square",
    name: "Square",
    colors: COLORS,
    sizes: ["600x600"],
  },
  {
    id: "double-square",
    name: "Double Square",
    colors: COLORS,
    sizes: ["600x600"],
  },
  {
    id: "single-groove",
    name: "Single Groove",
    colors: COLORS,
    sizes: ["600x2400"],
  },
  {
    id: "double-groove",
    name: "Double Groove",
    colors: COLORS,
    sizes: ["600x2400"],
  },
];

export const VICSTRIP_PRODUCT = {
  id: "vicstrip",
  name: "Univic Strip",
  patterns: PATTERNS,
};

// const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "http://localhost:8001";
// Assets (images, thumbs, PDFs, JSON catalog) are now served from the CDN bucket.
const ASSETS_URL = process.env.REACT_APP_ASSETS_URL || "http://localhost:8001";
// Shim: keeps all existing ${BACKEND_URL}/static/... references pointing at the CDN
// without touching every URL builder individually.
const BACKEND_URL = ASSETS_URL;

// Helper function to get VicStrip image path (served from CDN)
export const getImagePath = (patternId, colorId) => {
  return `${BACKEND_URL}/static/images/vicstrip/${patternId}/${colorId}.jpg`;
};

/**
 * Build thumbnail URL for VicStrip panels.
 * Filenames on disk use underscores for pattern names and lowercase design codes
 * e.g. patternId: "double-square", designCode: "VCS-0001" ->
 *  ${ASSETS_URL}/static/images/vicstrip/thumbnails/double_square_vcs0001.png
 */
export const getVicstripThumbnailUrl = (patternIdOrName, designCode) => {
  if (!patternIdOrName || !designCode) return null;
  const patternKey = String(patternIdOrName)
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/-/g, '_');
  const codeKey = String(designCode).toLowerCase().replace(/-/g, '');
  return `${ASSETS_URL}/static/images/vicstrip/thumbnails/${patternKey}_${codeKey}.png`;
};

// ─── Flat / Embossed VMT Panels ──────────────────────────────────────────────

/**
 * Per-category config for the Flat Embossed VMT layered preview.
 * Keys must match the category IDs returned by the backend API
 * (generated as: "vmd-" + category.toLowerCase().replace(/ /g,"-").replace(/&/g,"and"))
 *
 * How to add a new category:
 *   1. Add an entry below with the correct backend category ID as the key.
 *   2. Place assets in the corresponding folders:
 *        furniture : /images/flat-embossed-vmt/furniture/{categoryId}.png
 *        tpatti    : /images/flat-embossed-vmt/tpatti/{categoryId}.png  (optional)
 *        panels    : /images/flat-embossed-vmt/panels/{categoryId}/{designCode}.jpg
 */
export const FLAT_EMBOSSED_VMT_CONFIG = {
  "vmd-line-and-texture": {
    /** PNG with transparent wall cutout — furniture drives canvas height */
    furniture: `${BACKEND_URL}/static/images/flat-embossed-vmt/furniture/vmd-line-and-texture.png`,
    /** Optional decorative overlay PNG. Set to null if none. */
    tpatti: `${BACKEND_URL}/static/images/flat-embossed-vmt/tpatti/vmd-line-and-texture.png`,
    renderMode: "portrait",
    /** Number of panel columns shown side-by-side */
    repeat: 3,
    /** Real physical dimensions (mm) — used for CSS aspect-ratio */
    panelWidth: 1200,
    panelHeight: 2800,
  },
  "vmd-rhythm-and-repeat": {
    furniture: `${BACKEND_URL}/static/images/flat-embossed-vmt/furniture/vmd-rhythm-and-repeat.png`,
    tpatti: `${BACKEND_URL}/static/images/flat-embossed-vmt/tpatti/vmd-rhythm-and-repeat.png`,
    renderMode: "portrait",
    repeat: 3,
    panelWidth: 1200,
    panelHeight: 2800,
  },
  "vmd-quiet-bloom": {
    furniture: `${BACKEND_URL}/static/images/flat-embossed-vmt/furniture/vmd-quiet-bloom.png`,
    tpatti: `${BACKEND_URL}/static/images/flat-embossed-vmt/tpatti/vmd-quiet-bloom.png`,
    renderMode: "portrait",
    repeat: 3,
    panelWidth: 1200,
    panelHeight: 2800,
  },
  "vmd-fun-and-fantasy": {
    furniture: `${BACKEND_URL}/static/images/flat-embossed-vmt/furniture/vmd-fun-and-fantasy.png`,
    tpatti: `${BACKEND_URL}/static/images/flat-embossed-vmt/tpatti/vmd-fun-and-fantasy.png`,
    renderMode: "portrait",
    repeat: 3,
    panelWidth: 1200,
    panelHeight: 2800,
  },
  "vmd-indian-modern": {
    furniture: `${BACKEND_URL}/static/images/flat-embossed-vmt/furniture/vmd-indian-modern.png`,
    tpatti: `${BACKEND_URL}/static/images/flat-embossed-vmt/tpatti/vmd-indian-modern.png`,
    renderMode: "portrait",
    repeat: 3,
    panelWidth: 1200,
    panelHeight: 2800,
  },
  "vmd-color-block": {
    furniture: `${BACKEND_URL}/static/images/flat-embossed-vmt/furniture/vmd-color-block.png`,
    tpatti: `${BACKEND_URL}/static/images/flat-embossed-vmt/tpatti/vmd-color-block.png`,
    renderMode: "portrait",
    repeat: 3,
    panelWidth: 1200,
    panelHeight: 2800,
  },
  "vmd-marble": {
    furniture: `${BACKEND_URL}/static/images/flat-embossed-vmt/furniture/vmd-marble.png`,
    tpatti: `${BACKEND_URL}/static/images/flat-embossed-vmt/tpatti/vmd-marble.png`,
    renderMode: "portrait",
    repeat: 3,
    // When true, the center slice may be flipped in the preview to preserve
    // mirrored continuity for marble or other symmetric patterns.
    mirrorCenter: true,
    panelWidth: 1200,
    panelHeight: 2800,
  },
  "vmd-luxury-textures": {
    furniture: `${BACKEND_URL}/static/images/flat-embossed-vmt/furniture/vmd-luxury-textures.png`,
    tpatti: `${BACKEND_URL}/static/images/flat-embossed-vmt/tpatti/vmd-luxury-textures.png`,
    renderMode: "portrait",
    repeat: 3,
    panelWidth: 1200,
    panelHeight: 2800,
  },
  "vmd-leather": {
    furniture: `${BACKEND_URL}/static/images/flat-embossed-vmt/furniture/vmd-leather.png`,
    tpatti: `${BACKEND_URL}/static/images/flat-embossed-vmt/tpatti/vmd-leather.png`,
    renderMode: "portrait",
    repeat: 3,
    panelWidth: 1200,
    panelHeight: 2800,
  },
  "vmd-woven-brushwork": {
    furniture: `${BACKEND_URL}/static/images/flat-embossed-vmt/furniture/vmd-woven-brushwork.png`,
    tpatti: `${BACKEND_URL}/static/images/flat-embossed-vmt/tpatti/vmd-woven-brushwork.png`,
    renderMode: "portrait",
    repeat: 3,
    panelWidth: 1200,
    panelHeight: 2800,
  },
  "vmd-nature-reimagined": {
    furniture: `${BACKEND_URL}/static/images/flat-embossed-vmt/furniture/vmd-nature-reimagined.png`,
    tpatti: `${BACKEND_URL}/static/images/flat-embossed-vmt/tpatti/vmd-nature-reimagined.png`,
    renderMode: "portrait",
    repeat: 3,
    panelWidth: 1200,
    panelHeight: 2800,
  },
  "vmd-patterned-weaves": {
    furniture: `${BACKEND_URL}/static/images/flat-embossed-vmt/furniture/vmd-patterned-weaves.png`,
    tpatti: `${BACKEND_URL}/static/images/flat-embossed-vmt/tpatti/vmd-patterned-weaves.png`,
    renderMode: "portrait",
    repeat: 3,
    panelWidth: 1200,
    panelHeight: 2800,
  },
  "vmd-wood-classics": {
    furniture: `${BACKEND_URL}/static/images/flat-embossed-vmt/furniture/vmd-wood-classics.png`,
    tpatti: `${BACKEND_URL}/static/images/flat-embossed-vmt/tpatti/vmd-wood-classics.png`,
    renderMode: "portrait",
    repeat: 3,
    panelWidth: 1200,
    panelHeight: 2800,
  },
  // Wood product — Wood Classics category (same assets as vmd-wood-classics)
  "wood-wood-classics": {
    furniture: `${BACKEND_URL}/static/images/flat-embossed-vmt/furniture/vmd-wood-classics.png`,
    tpatti: `${BACKEND_URL}/static/images/flat-embossed-vmt/tpatti/vmd-wood-classics.png`,
    renderMode: "portrait",
    repeat: 3,
    panelWidth: 1200,
    panelHeight: 2800,
  },
  // Wood product — Classic Parquet category
  "wood-classic-parquet": {
    furniture: `${BACKEND_URL}/static/images/wood/furniture/classic_parquet.png`,
    tpatti: `${BACKEND_URL}/static/images/wood/tpatti/classic_parquet.png`,
    renderMode: "portrait",
    repeat: 3,
    panelWidth: 1200,
    panelHeight: 2800,
  },
  // Wood product — Wood Perforations category
  "wood-perforations": {
    furniture: `${BACKEND_URL}/static/images/wood/furniture/wood-perfocations.png`,
    tpatti: null,
    renderMode: "portrait",
    repeat: 3,
    panelWidth: 1200,
    panelHeight: 2800,
  },
  // Fabrics product — Designer Textile category
  "fabrics-designer-textile": {
    furniture: `${BACKEND_URL}/static/images/fabric/designer_textile/furniture/designer_textile.png`,
    tpatti: `${BACKEND_URL}/static/images/fabric/designer_textile/tpatti/designer_textile.png`,
    renderMode: "portrait",
    repeat: 3,
    panelWidth: 1200,
    panelHeight: 2800,
  },
  // Fabrics product — Color Core category
  "fabrics-color-core": {
    furniture: `${BACKEND_URL}/static/images/fabric/furniture/color-core.png`,
    // tpatti: `${BACKEND_URL}/static/images/fabric/tpatti/color-core.png`,
    renderMode: "portrait",
    repeat: 3,
    panelWidth: 1200,
    panelHeight: 2800,
  },
  // Fabrics product — Luxury Textures category
  "fabrics-luxury-textures": {
    furniture: `${BACKEND_URL}/static/images/flat-embossed-vmt/furniture/vmd-luxury-textures.png`,
    tpatti: `${BACKEND_URL}/static/images/flat-embossed-vmt/tpatti/vmd-luxury-textures.png`,
    renderMode: "portrait",
    repeat: 3,
    panelWidth: 1200,
    panelHeight: 2800,
  },
  // Fabrics product — Modern Corporate category
  "fabrics-modern-corporate": {
    furniture: `${BACKEND_URL}/static/images/flat-embossed-vmt/furniture/vmd-modern-corporate-setup.png`,
    tpatti: `${BACKEND_URL}/static/images/flat-embossed-vmt/tpatti/vmd-modern-corporate-setup.png`,
    renderMode: "portrait",
    repeat: 3,
    panelWidth: 1200,
    panelHeight: 2800,
  },
  "vmd-soft-texture": {
    furniture: `${BACKEND_URL}/static/images/flat-embossed-vmt/furniture/vmd-soft-texture.png`,
    tpatti: `${BACKEND_URL}/static/images/flat-embossed-vmt/tpatti/vmd-soft-texture.png`,
    renderMode: "portrait",
    repeat: 3,
    panelWidth: 1200,
    panelHeight: 2800,
  },
  // Ombre product — Color Core Ombre category
  "ombre-color-core-ombre": {
    furniture: `${BACKEND_URL}/static/images/ombre/color-core-ombre/furniture/color-core-ombre.png`,
    // tpatti: `${BACKEND_URL}/static/images/ombre/color-core-ombre/tpatti/color-core-ombre.png`,
    tpatti: null,
    renderMode: "portrait",
    repeat: 3,
    panelWidth: 1200,
    panelHeight: 2800,
    panelRows: 2,
  },
};

/**
 * Fallback config used when categoryId is not found in FLAT_EMBOSSED_VMT_CONFIG.
 * Falls back to "Line & Texture" furniture so the preview is never blank.
 */
export const FLAT_EMBOSSED_VMT_DEFAULT_CONFIG = {
  furniture: `${BACKEND_URL}/static/images/flat-embossed-vmt/furniture/vmd-line-and-texture.png`,
  tpatti: null,
  renderMode: "portrait",
  repeat: 3,
  panelWidth: 1200,
  panelHeight: 2800,
};

/**
 * Emboss pattern definitions for Flat Embossed VMT panels.
 * Thumbnails are line-drawing PNGs shown in the sidebar for emboss-enabled categories.
 * Which patterns are clickable for a given print is driven by design.available_emboss[]
 * returned from the API. Pre-generated full-panel overlay images live at:
 *   /static/images/flat-embossed-vmt/emboss-panels/{designCode}/{id}.png
 */
// ── Single source of truth for emboss line-drawing thumbnails ──────────────
// Every product (Flat-Embossed VMD, Color Core, Designer Textile, Ombre)
// shares the same canonical folder.  Adding a new pattern: drop the source
// PNG into backend/static/images/emboss-thumbnails/ and regenerate the
// cache JPG / _area50 crop there too — no per-product duplication.
// Cache-bust version stamp appended to every emboss thumbnail URL. Because
// the S3 objects are uploaded with `Cache-Control: immutable`, browsers will
// otherwise keep an old copy pinned for a year and never refetch — bumping
// this constant forces a one-time refetch across every user's browser after
// a deploy. **Bump this whenever you replace one or more emboss thumbs.**
const EMBOSS_THUMB_VERSION = 2;
const EMBOSS_THUMB = (file) =>
  `${ASSETS_URL}/static/_thumbcache/emboss-thumbnails/${file.toLowerCase().replace(/\.[^.]+$/, '.jpg')}?v=${EMBOSS_THUMB_VERSION}`;

// Per-product aliases kept for backward-compatibility with existing call
// sites — they all resolve to the same canonical URL now.
const FVP_EMBOSS_THUMB = EMBOSS_THUMB;
export const FLAT_EMBOSSED_EMBOSS_PATTERNS = [
  { id: "flux_ribbed", name: "Flux Ribbed", thumbnailUrl: FVP_EMBOSS_THUMB("flux_ribbed.png") },
  { id: "ribbed_25mm", name: "Ribbed 25mm", thumbnailUrl: FVP_EMBOSS_THUMB("ribbed_25mm.png") },
  { id: "ribbed_45mm", name: "Ribbed 45mm", thumbnailUrl: FVP_EMBOSS_THUMB("ribbed_45mm.png") },
  { id: "ribbed_60mm", name: "Ribbed 60mm", thumbnailUrl: FVP_EMBOSS_THUMB("ribbed_60mm.png") },
  { id: "tappered",   name: "Tapered",    thumbnailUrl: FVP_EMBOSS_THUMB("tappered.png")   },
  { id: "triangle",   name: "Triangle",   thumbnailUrl: FVP_EMBOSS_THUMB("triangle.png")   },
  { id: "square_30",  name: "Square 30",  thumbnailUrl: FVP_EMBOSS_THUMB("square_30.png")  },
  { id: "deck",       name: "Deck",       thumbnailUrl: FVP_EMBOSS_THUMB("deck.png")       },
  { id: "aqualine",   name: "Aqualine",   thumbnailUrl: FVP_EMBOSS_THUMB("aqualine.png")   },
  { id: "penray",     name: "Penray",     thumbnailUrl: FVP_EMBOSS_THUMB("penray.png")     },
];

/**
 * Leather (vmd-leather) size → allowed emboss-pattern IDs.
 * Driven by product spec — other Bespoke Graphics categories (Marble, Nature
 * Reimagined) still show every pattern.  Lookup is `LEATHER_EMBOSS_BY_SIZE[size]`
 * and falls back to `null` if the size isn't listed (meaning "no filter").
 */
export const LEATHER_EMBOSS_BY_SIZE = {
  // Mirrors the fabric split: the 3D patterns sit at 1200x2800 and the mosaic
  // patterns (triangle, square_30, deck) at every smaller size.  Leather
  // carries a narrower set than fabric — no axis, square_8 or symmetric.
  "1200x2800": ["flux_ribbed", "ribbed_45mm", "ribbed_60mm", "tappered", "aqualine", "penray"],
  "1200x2400": ["triangle", "square_30", "deck"],
  "600x600":   ["triangle", "square_30", "deck"],
  "600x1200":  ["triangle", "square_30", "deck"],
};

/**
 * Converts a relative backend asset path (e.g. "/static/images/...")
 * to a fully-qualified URL using the backend base URL.
 * Already-absolute URLs (http/https) are returned unchanged.
 */
export const resolveAssetUrl = (path) => {
  if (!path) return null;
  if (path.startsWith("http")) return path;
  return `${BACKEND_URL}${path}`;
};

/**
 * Returns the backend path(s) for a panel texture.
 *
 * - "single"     (default) → returns a string:  …/{designCode}.jpg
 * - "continuous"           → returns a string[]: …/{designCode}-1.jpg, -2.jpg, -3.jpg
 *
 * File-naming convention for continuous panels:
 *   panels/{categoryId}/{designCode}-1.jpg   ← left column
 *   panels/{categoryId}/{designCode}-2.jpg   ← centre column
 *   panels/{categoryId}/{designCode}-3.jpg   ← right column
 *
 * @param {string} categoryId     - e.g. "vmd-line-and-texture"
 * @param {string} designCode     - e.g. "VMD-LT-009"
 * @param {"single"|"continuous"} [panelVariant="single"]
 * @param {number} [count=3]      - number of slices for continuous designs (3, 4, …)
 */
export const getFlatEmbossedPanelPath = (categoryId, designCode, panelVariant = "single", count = 3) => {
  const base = `${BACKEND_URL}/static/images/flat-embossed-vmt/panels/${categoryId}`;
  if (panelVariant === "continuous") {
    return Array.from({ length: count }, (_, i) => `${base}/${designCode}-${i + 1}.jpg`);
  }
  return `${base}/${designCode}.jpg`;
};

// ─── Wood Perforations ───────────────────────────────────────────────────────

/** Sizes available for the Wood Perforations category */
export const WOOD_PERFORATION_SIZES = [
  { id: "1200x2800", label: "1200×2800 mm" },
  { id: "1200x2400", label: "1200×2400 mm" },
  { id: "1200x600",  label: "1200×600 mm" },
  { id: "600x600",   label: "600×600 mm" },
];

/** All perforation overlay patterns. The same PNG file is used for every size. */
// const WOOD_PERF_THUMB = (file) => `${BACKEND_URL}/thumb/wood/perforations-thumbnails/${file}`;
const WOOD_PERF_THUMB = (file) => `${ASSETS_URL}/static/_thumbcache/wood/perforations-thumbnails/${file.replace(/\.[^.]+$/, '.jpg')}`;
export const WOOD_PERFORATION_PATTERNS = [
  { id: "PF-NC-07", name: "PF-NC-07", url: `${BACKEND_URL}/static/images/wood/perfocations/PF-NC-07_1200x2800.png`, thumbnailUrl: WOOD_PERF_THUMB("PF-NC-07_1200x2800.png") },
  { id: "PF-NC-08", name: "PF-NC-08", url: `${BACKEND_URL}/static/images/wood/perfocations/PF-NC-08_1200x2800.png`, thumbnailUrl: WOOD_PERF_THUMB("PF-NC-08_1200x2800.png") },
  { id: "PF-NC-10", name: "PF-NC-10", url: `${BACKEND_URL}/static/images/wood/perfocations/PF-NC-10_1200x2800.png`, thumbnailUrl: WOOD_PERF_THUMB("PF-NC-10_1200x2800.png") },
  { id: "PF-NC-11", name: "PF-NC-11", url: `${BACKEND_URL}/static/images/wood/perfocations/PF-NC-11_1200x2800.png`, thumbnailUrl: WOOD_PERF_THUMB("PF-NC-11_1200x2800.png") },
  { id: "PF-NC-12", name: "PF-NC-12", url: `${BACKEND_URL}/static/images/wood/perfocations/PF-NC-12_1200x2800.png`, thumbnailUrl: WOOD_PERF_THUMB("PF-NC-12_1200x2800.png") },
  { id: "PF-NC-20", name: "PF-NC-20", url: `${BACKEND_URL}/static/images/wood/perfocations/PF-NC-20_1200x2800.png`, thumbnailUrl: WOOD_PERF_THUMB("PF-NC-20_1200x2800.png") },
  { id: "PF-NC-21", name: "PF-NC-21", url: `${BACKEND_URL}/static/images/wood/perfocations/PF-NC-21_1200x2800.png`, thumbnailUrl: WOOD_PERF_THUMB("PF-NC-21_1200x2800.png") },
  { id: "PF-NC-25", name: "PF-NC-25", url: `${BACKEND_URL}/static/images/wood/perfocations/PF-NC-25_1200x2800.png`, thumbnailUrl: WOOD_PERF_THUMB("PF-NC-25_1200x2800.png") },
  { id: "PF-NC-26", name: "PF-NC-26", url: `${BACKEND_URL}/static/images/wood/perfocations/PF-NC-26_1200x2800.png`, thumbnailUrl: WOOD_PERF_THUMB("PF-NC-26_1200x2800.png") },
  { id: "PF-NC-29", name: "PF-NC-29", url: `${BACKEND_URL}/static/images/wood/perfocations/PF-NC-29_1200x2800.png`, thumbnailUrl: WOOD_PERF_THUMB("PF-NC-29_1200x2800.png") },
];

/** Pattern IDs excluded from the picker for a given size id */
export const WOOD_PERFORATION_EXCLUSIONS = {
  // "1200x2800": ["PF-NC-29"],
};

// ─── Color Core (Fabrics) ─────────────────────────────────────────────────────

/** 20 solid base colors for Color Core */
export const COLOR_CORE_COLORS = [
  { id: "CC-01", name: "Oat",           hex: "#ecded3" },
  { id: "CC-02", name: "Apricot",       hex: "#e9ccc5" },
  { id: "CC-03", name: "Olive",         hex: "#abb86b" },
  { id: "CC-04", name: "Straw",         hex: "#f9d698" },
  { id: "CC-05", name: "Arabian Spice", hex: "#9e5239" },
  { id: "CC-06", name: "Coral Haze",    hex: "#b87857" },
  { id: "CC-07", name: "Fog",           hex: "#D3D3D3" },
  { id: "CC-08", name: "Glacier",       hex: "#b6b5b8" },
  { id: "CC-09", name: "Birch",         hex: "#95948d" },
  { id: "CC-11", name: "Smoke Blue",    hex: "#6e7f92" },
  { id: "CC-12", name: "Shadow",        hex: "#6e8890" },
  { id: "CC-13", name: "Sand",          hex: "#c6ab9a" },
  { id: "CC-14", name: "Pearl",         hex: "#c6b4a4" },
  { id: "CC-15", name: "Dune",          hex: "#96795e" },
  { id: "CC-16", name: "Mirage",        hex: "#8e9d98" },
  { id: "CC-17", name: "Taupe",         hex: "#a29083" },
  { id: "CC-18", name: "Concrete Gray", hex: "#909ea8" },
  { id: "CC-19", name: "Mushroom",      hex: "#aeadaf" },
  { id: "CC-20", name: "Alloy",         hex: "#767a82" },
];

/** 3 fabric structures for Color Core.
 *  Display order is reversed from the legacy order; `id` still maps to the
 *  underlying panel filename ({id}_{colorId}.jpg) so files/URLs are unchanged. */
export const COLOR_CORE_FABRIC_STRUCTURES = [
  { id: "FB-NE-06", name: "FB-CC-01" },
  { id: "FB-GY-28", name: "FB-CC-02" },
  { id: "FB-GY-03", name: "FB-CC-03" },
];

/**
 * Returns the panel URL for a given Color Core color + structure combo.
 * Served via /thumb/ for thumbnails (auto-generated by the backend).
 */
export const getColorCorePanelUrl = (structureId, colorId) =>
  `${BACKEND_URL}/static/images/fabric/color-core/panels/${structureId}_${colorId}.jpg`;

// export const getColorCoreThumbnailUrl = (structureId, colorId) =>
//   `${BACKEND_URL}/thumb/fabric/color-core/panels/${structureId}_${colorId}.jpg`;
export const getColorCoreThumbnailUrl = (structureId, colorId) =>
  `${ASSETS_URL}/static/_thumbcache/fabric/color-core/panels/${structureId}_${colorId}.jpg`;

export const COLOR_CORE_SIZES = ["1200x2800", "1200x2400", "600x600", "600x1200"];

const CC_EMBOSS_THUMB = EMBOSS_THUMB;

/**
 * Thicknesses a pattern cannot be manufactured in.
 *
 * Alter Flute is only produced on a 12mm panel, so it must not be offerable on
 * 25mm — quoting that combination would send an unmakeable spec to the factory.
 * It's the same physical emboss in Colour Core and Designer Textile, hence the
 * shared constant across both pattern lists.
 *
 * Declared per pattern alongside availableSizes so a future restriction is a
 * data edit rather than another special case in the configurator.
 */
export const ALTER_FLUTE_EXCLUDED_THICKNESSES = ["25mm (PET Panel)"];

/**
 * True when `pattern` may be offered at `thickness`.  A pattern with no
 * excludedThicknesses, or a thickness not yet chosen, is always allowed.
 */
export const isEmbossAvailableForThickness = (pattern, thickness) =>
  !thickness || !pattern?.excludedThicknesses?.includes(thickness);

export const COLOR_CORE_EMBOSS_PATTERNS = [
  { id: "ribbed_25mm", name: "Ribbed 25mm",  thumbnailUrl: CC_EMBOSS_THUMB("ribbed_25mm.png"),  availableSizes: ["1200x2800"] },
  { id: "ribbed_45mm", name: "Ribbed 45mm",  thumbnailUrl: CC_EMBOSS_THUMB("ribbed_45mm.png"),  availableSizes: ["1200x2800"] },
  { id: "ribbed_60mm", name: "Ribbed 60mm",  thumbnailUrl: CC_EMBOSS_THUMB("ribbed_60mm.png"),  availableSizes: ["1200x2800"] },
  { id: "ribbed_duo",  name: "Ribbed Duo",   thumbnailUrl: CC_EMBOSS_THUMB("ribbed_duo.png"),   availableSizes: ["1200x2800"] },
  { id: "elliptera",  name: "Elliptera",    thumbnailUrl: CC_EMBOSS_THUMB("elliptera.png"),    availableSizes: ["1200x2800"] },
  { id: "ellipsia",   name: "Ellipsia",     thumbnailUrl: CC_EMBOSS_THUMB("ellipsia.png"),     availableSizes: ["1200x2800"] },
  { id: "flux_ribbed",name: "Flux Ribbed",  thumbnailUrl: CC_EMBOSS_THUMB("flux_ribbed.png"),  availableSizes: ["1200x2800"] },
  { id: "aqualine",   name: "Aqualine",     thumbnailUrl: CC_EMBOSS_THUMB("aqualine.png"),     availableSizes: ["1200x2800"] },
  { id: "tappered",   name: "Tapered",      thumbnailUrl: CC_EMBOSS_THUMB("tappered.png"),     availableSizes: ["1200x2800"] },
  { id: "axis",       name: "Axis",         thumbnailUrl: CC_EMBOSS_THUMB("axis.png"),          availableSizes: ["1200x2400"], panelRows: 6 },
  { id: "square_30",  name: "Square 30",    thumbnailUrl: CC_EMBOSS_THUMB("square_30.png"),    availableSizes: ["1200x2400"], panelRows: 6 },
  { id: "deck",       name: "Deck",         thumbnailUrl: CC_EMBOSS_THUMB("deck.png"),          availableSizes: ["1200x2400"], panelRows: 6 },
  { id: "triangle",   name: "Triangle",     thumbnailUrl: CC_EMBOSS_THUMB("triangle.png"),      availableSizes: ["1200x2400"], panelRows: 6 },
  { id: "square_8",   name: "Square 8",     thumbnailUrl: CC_EMBOSS_THUMB("square_8.png"),     availableSizes: ["1200x2400"], panelRows: 6 },
  { id: "symmetric",  name: "Symmetric",    thumbnailUrl: CC_EMBOSS_THUMB("symmetric.png"),    availableSizes: ["1200x2400"], panelRows: 6 },
  { id: "alter_flute",name: "Alter Flute",  thumbnailUrl: CC_EMBOSS_THUMB("afterflute.png"),  availableSizes: ["1200x2800"], excludedThicknesses: ALTER_FLUTE_EXCLUDED_THICKNESSES },
  { id: "bloom",      name: "Bloom",        thumbnailUrl: CC_EMBOSS_THUMB("bloom.png"),        availableSizes: ["1200x2800"] },
  { id: "drift",      name: "Drift",        thumbnailUrl: CC_EMBOSS_THUMB("drift.png"),        availableSizes: ["1200x2800"] },
  { id: "shard",      name: "Shard",        thumbnailUrl: CC_EMBOSS_THUMB("shard.png"),        availableSizes: ["1200x2800"] },
  { id: "weave",      name: "Weave",        thumbnailUrl: CC_EMBOSS_THUMB("weave.png"),        availableSizes: ["1200x2800"] },
  { id: "penray",     name: "Penray",       thumbnailUrl: CC_EMBOSS_THUMB("penray.png"),       availableSizes: ["1200x2800"] },
];

export const getColorCoreEmbossUrl = (structureId, embossId, colorId) =>
  `${BACKEND_URL}/static/images/fabric/color-core/emboss/${structureId}_${colorId}_${embossId}.png`;

// ─── Ombre — Color Core Ombre ─────────────────────────────────────────────────

/** 10 base colors for Color Core Ombre */
export const OMBRE_COLOR_CORE_BASE_COLORS = [
  { id: "coral_haze", name: "Coral Haze", hex: "#AF7454", fileLabel: "CoralHaze" },
  { id: "apricot",    name: "Apricot",    hex: "#E0C3BC", fileLabel: "Apricot"   },
  { id: "gleam",      name: "Gleam",      hex: "#A5AF88", fileLabel: "Gleam"     },
  { id: "blue_fog",   name: "Blue Fog",   hex: "#92ABB9", fileLabel: "BlueFog"   },
  { id: "sand",       name: "Sand",       hex: "#BBA191", fileLabel: "Sand"      },
  { id: "pearl",      name: "Pearl",      hex: "#BBAA9A", fileLabel: "Pearl"     },
  { id: "oat",        name: "Oat",        hex: "#E6D8CD", fileLabel: "Oat"       },
  { id: "birch",      name: "Birch",      hex: "#8B8C86", fileLabel: "Birch"     },
  { id: "mushroom",   name: "Mushroom",   hex: "#A3A3A4", fileLabel: "Mushroom"  },
  { id: "glacier",    name: "Glaciar",    hex: "#AAACAB", fileLabel: "Glacier"   },
];

/**
 * Ombre overlay options per base color.
 * Each entry maps a base color id → array of available overlays.
 * `hex` is used as the swatch color in the UI.
 * `filename` is the exact file under panels/{baseColorId}/.
 */
export const OMBRE_COLOR_CORE_OVERLAYS = {
  coral_haze: [
    { hex: "#61442e", filename: "Ombre-#61442e-CoralHaze_1200x2800.jpg" },
    { hex: "#6b1d03", filename: "Ombre-#6b1d03-CoralHaze_1200x2800.jpg" },
    { hex: "#6d2932", filename: "Ombre-#6d2932-CoralHaze_1200x2800.jpg" },
    { hex: "#735138", filename: "Ombre-#735138-CoralHaze_1200x2800.jpg" },
    { hex: "#7e2404", filename: "Ombre-#7e2404-CoralHaze_1200x2800.jpg" },
    // { hex: "#7b7d7d", filename: "Ombre-#7b7d7d-CoralHaze_1200x2800.jpg" },
    // { hex: "#717474", filename: "Ombre-#717474-CoralHaze_1200x2800.jpg" },
    // { hex: "#5e6060", filename: "Ombre-#5e6060-CoralHaze_1200x2800.jpg" },
    // { hex: "#5c5e5e", filename: "Ombre-#5c5e5e-CoralHaze_1200x2800.jpg" },
  ],
  apricot: [
    { hex: "#641e16", filename: "Ombre-#641e16-Apricot_1200x2800.jpg" },
    { hex: "#6b1d03", filename: "Ombre-#6b1d03-Apricot_1200x2800.jpg" },
    { hex: "#6d2932", filename: "Ombre-#6d2932-Apricot_1200x2800.jpg" },
    { hex: "#6e3500", filename: "Ombre-#6e3500-Apricot_1200x2800.jpg" },
    { hex: "#7b241c", filename: "Ombre-#7b241c-Apricot_1200x2800.jpg" },
  ],
  gleam: [
    { hex: "#005232", filename: "Ombre-#005232-Gleam_1200x2800.jpg" },
    { hex: "#0b5345", filename: "Ombre-#0b5345-Gleam_1200x2800.jpg" },
    { hex: "#425b00", filename: "Ombre-#425b00-Gleam_1200x2800.jpg" },
    { hex: "#565e07", filename: "Ombre-#565e07-Gleam_1200x2800.jpg" },
    { hex: "#5d5d00", filename: "Ombre-#5d5d00-Gleam_1200x2800.jpg" },
    { hex: "#717474", filename: "Ombre-#717474-Gleam_1200x2800.jpg" },
  ],
  blue_fog: [
    { hex: "#2260ff", filename: "Ombre-#2260ff-BlueFog_1200x2800.jpg" },
    { hex: "#5d6d7e", filename: "Ombre-#5d6d7e-BlueFog_1200x2800.jpg" },
    { hex: "#6082b6", filename: "Ombre-#6082b6-BlueFog_1200x2800.jpg" },
    { hex: "#6f8faf", filename: "Ombre-#6f8faf-BlueFog_1200x2800.jpg" },
    { hex: "#717474", filename: "Ombre-#717474-BlueFog_1200x2800.jpg" },
    { hex: "#717d7e", filename: "Ombre-#717d7e-BlueFog_1200x2800.jpg" },
  ],
  sand: [
    { hex: "#573016", filename: "Ombre-#573016-Sand_1200x2800.jpg" },
    { hex: "#61442f", filename: "Ombre-#61442f-Sand_1200x2800.jpg" },
    { hex: "#65412a", filename: "Ombre-#65412a-Sand_1200x2800.jpg" },
    { hex: "#6e3500", filename: "Ombre-#6e3500-Sand_1200x2800.jpg" },
    { hex: "#7f6954", filename: "Ombre-#7f6954-Sand_1200x2800.jpg" },
    { hex: "#855e42", filename: "Ombre-#855e42-Sand_1200x2800.jpg" },
  ],
  pearl: [
    { hex: "#573016", filename: "Ombre-#573016-Pearl_1200x2800.jpg" },
    { hex: "#61442f", filename: "Ombre-#61442f-Pearl_1200x2800.jpg" },
    { hex: "#65412a", filename: "Ombre-#65412a-Pearl_1200x2800.jpg" },
    { hex: "#6c5947", filename: "Ombre-#6c5947-Pearl_1200x2800.jpg" },
    { hex: "#6e3500", filename: "Ombre-#6e3500-Pearl_1200x2800.jpg" },
    { hex: "#735138", filename: "Ombre-#735138-Pearl_1200x2800.jpg" },
    { hex: "#855e42", filename: "Ombre-#855e42-Pearl_1200x2800.jpg" },
    { hex: "#964b00", filename: "Ombre-#964b00-Pearl_1200x2800.jpg" },
  ],
  oat: [
    { hex: "#3f1a01", filename: "Ombre-#3f1a01-Oat_1200x2800.jpg" },
    { hex: "#573016", filename: "Ombre-#573016-Oat_1200x2800.jpg" },
    { hex: "#65412a", filename: "Ombre-#65412a-Oat_1200x2800.jpg" },
    { hex: "#735138", filename: "Ombre-#735138-Oat_1200x2800.jpg" },
    { hex: "#937a62", filename: "Ombre-#937a62-Oat_1200x2800.jpg" },
    { hex: "#954535", filename: "Ombre-#954535-Oat_1200x2800.jpg" },
    { hex: "#a58863", filename: "Ombre-#a58863-Oat_1200x2800.jpg" },
    { hex: "#ad6d68", filename: "Ombre-#ad6d68-Oat_1200x2800.jpg" },
  ],
  birch: [
    { hex: "#00416a", filename: "Ombre-#00416a-Birch_1200x2800.jpg" },
    { hex: "#005232", filename: "Ombre-#005232-Birch_1200x2800.jpg" },
    { hex: "#0c8683", filename: "Ombre-#0c8683-Birch_1200x2800.jpg" },
    { hex: "#0d47a1", filename: "Ombre-#0d47a1-Birch_1200x2800.jpg" },
    { hex: "#311b92", filename: "Ombre-#311b92-Birch_1200x2800.jpg" },
    { hex: "#425b00", filename: "Ombre-#425b00-Birch_1200x2800.jpg" },
    { hex: "#447476", filename: "Ombre-#447476-Birch_1200x2800.jpg" },
    { hex: "#4d6072", filename: "Ombre-#4d6072-Birch_1200x2800.jpg" },
    { hex: "#524F81", filename: "Ombre-#524F81-Birch_1200x2800.jpg" },
    { hex: "#565e07", filename: "Ombre-#565e07-Birch_1200x2800.jpg" },
    { hex: "#5c5e5e", filename: "Ombre-#5c5e5e-Birch_1200x2800.jpg" },
    { hex: "#6082b6", filename: "Ombre-#6082b6-Birch_1200x2800.jpg" },
    { hex: "#61442f", filename: "Ombre-#61442f-Birch_1200x2800.jpg" },
    { hex: "#6b1d03", filename: "Ombre-#6b1d03-Birch_1200x2800.jpg" },
    { hex: "#828d10", filename: "Ombre-#828d10-Birch_1200x2800.jpg" },
    { hex: "#954535", filename: "Ombre-#954535-Birch_1200x2800.jpg" },
  ],
  mushroom: [
    { hex: "#00416a", filename: "Ombre-#00416a-Mushroom_1200x2800.jpg" },
    { hex: "#005232", filename: "Ombre-#005232-Mushroom_1200x2800.jpg" },
    { hex: "#0b5345", filename: "Ombre-#0b5345-Mushroom_1200x2800.jpg" },
    { hex: "#0c8683", filename: "Ombre-#0c8683-Mushroom_1200x2800.jpg" },
    { hex: "#0d47a1", filename: "Ombre-#0d47a1-Mushroom_1200x2800.jpg" },
    { hex: "#311b92", filename: "Ombre-#311b92-Mushroom_1200x2800.jpg" },
    { hex: "#413226", filename: "Ombre-#413226-Mushroom_1200x2800.jpg" },
    { hex: "#425b00", filename: "Ombre-#425b00-Mushroom_1200x2800.jpg" },
    { hex: "#447476", filename: "Ombre-#447476-Mushroom_1200x2800.jpg" },
    { hex: "#4d6072", filename: "Ombre-#4d6072-Mushroom_1200x2800.jpg" },
    { hex: "#524F81", filename: "Ombre-#524F81-Mushroom_1200x2800.jpg" },
    { hex: "#561c24", filename: "Ombre-#561c24-Mushroom_1200x2800.jpg" },
    { hex: "#565e07", filename: "Ombre-#565e07-Mushroom_1200x2800.jpg" },
    { hex: "#5c5e5e", filename: "Ombre-#5c5e5e-Mushroom_1200x2800.jpg" },
    { hex: "#5d5d00", filename: "Ombre-#5d5d00-Mushroom_1200x2800.jpg" },
    { hex: "#6082b6", filename: "Ombre-#6082b6-Mushroom_1200x2800.jpg" },
    { hex: "#61442f", filename: "Ombre-#61442f-Mushroom_1200x2800.jpg" },
    { hex: "#6a5acd", filename: "Ombre-#6a5acd-Mushroom_1200x2800.jpg" },
    { hex: "#6b1d03", filename: "Ombre-#6b1d03-Mushroom_1200x2800.jpg" },
    { hex: "#828d10", filename: "Ombre-#828d10-Mushroom_1200x2800.jpg" },
    { hex: "#954535", filename: "Ombre-#954535-Mushroom_1200x2800.jpg" },
  ],
  glacier: [
    { hex: "#00416a", filename: "Ombre-#00416a-Glacier_1200x2800.jpg" },
    { hex: "#005232", filename: "Ombre-#005232-Glacier_1200x2800.jpg" },
    { hex: "#0b5345", filename: "Ombre-#0b5345-Glacier_1200x2800.jpg" },
    { hex: "#0c8683", filename: "Ombre-#0c8683-Glacier_1200x2800.jpg" },
    { hex: "#0d47a1", filename: "Ombre-#0d47a1-Glacier_1200x2800.jpg" },
    { hex: "#311b92", filename: "Ombre-#311b92-Glacier_1200x2800.jpg" },
    { hex: "#425b00", filename: "Ombre-#425b00-Glacier_1200x2800.jpg" },
    { hex: "#447476", filename: "Ombre-#447476-Glacier_1200x2800.jpg" },
    { hex: "#4d6072", filename: "Ombre-#4d6072-Glacier_1200x2800.jpg" },
    { hex: "#4e6a58", filename: "Ombre-#4e6a58-Glacier_1200x2800.jpg" },
    { hex: "#524F81", filename: "Ombre-#524F81-Glacier_1200x2800.jpg" },
    { hex: "#561c24", filename: "Ombre-#561c24-Glacier_1200x2800.jpg" },
    { hex: "#565e07", filename: "Ombre-#565e07-Glacier_1200x2800.jpg" },
    { hex: "#5c5e5e", filename: "Ombre-#5c5e5e-Glacier_1200x2800.jpg" },
    { hex: "#6082b6", filename: "Ombre-#6082b6-Glacier_1200x2800.jpg" },
    { hex: "#61442f", filename: "Ombre-#61442f-Glacier_1200x2800.jpg" },
    { hex: "#6a5acd", filename: "Ombre-#6a5acd-Glacier_1200x2800.jpg" },
    { hex: "#6b1d03", filename: "Ombre-#6b1d03-Glacier_1200x2800.jpg" },
    { hex: "#769e85", filename: "Ombre-#769e85-Glacier_1200x2800.jpg" },
    { hex: "#828d10", filename: "Ombre-#828d10-Glacier_1200x2800.jpg" },
    { hex: "#867a2f", filename: "Ombre-#867a2f-Glacier_1200x2800.jpg" },
    { hex: "#954535", filename: "Ombre-#954535-Glacier_1200x2800.jpg" },
    { hex: "#a0632b", filename: "Ombre-#a0632b-Glacier_1200x2800.jpg" },
    { hex: "#a32c00", filename: "Ombre-#a32c00-Glacier_1200x2800.jpg" },
    { hex: "#a36a00", filename: "Ombre-#a36a00-Glacier_1200x2800.jpg" },
  ],
};

/** Returns the full URL for an ombre panel image.
 * The filename contains `#` characters (e.g. "Ombre-#641e16-Apricot_1200x2800.jpg")
 * which must be percent-encoded so the browser doesn't treat them as URL fragments.
 */
export const getOmbreColorCorePanelUrl = (baseColorId, filename) =>
  `${BACKEND_URL}/static/images/ombre/color-core-ombre/panels/${baseColorId}/${encodeURIComponent(filename)}`;

const OMBRE_EMBOSS_THUMB = EMBOSS_THUMB;
// Ombre Color Core emboss patterns now render at BOTH product sizes —
// previously 1200x2400 was groove-only, but that restriction was lifted
// (both sizes carry both emboss and groove panels now).  availableSizes
// feeds the size-dropdown filter: both entries here → the Size select shows
// both sizes under Embossed + Color Core Ombre, matching Grooving.
export const OMBRE_COLOR_CORE_EMBOSS_PATTERNS = [
  { id: "flux_ribbed", name: "Flux Ribbed", suffix: "Flux Ribbed", thumbnailUrl: OMBRE_EMBOSS_THUMB("flux_ribbed.png"), availableSizes: ["1200x2400", "1200x2800"] },
  { id: "ribbed_25mm", name: "Ribbed 25mm", suffix: "Ribbed 25mm", thumbnailUrl: OMBRE_EMBOSS_THUMB("ribbed_25mm.png"), availableSizes: ["1200x2400", "1200x2800"] },
  { id: "ribbed_45mm", name: "Ribbed 45mm", suffix: "Ribbed 45mm", thumbnailUrl: OMBRE_EMBOSS_THUMB("ribbed_45mm.png"), availableSizes: ["1200x2400", "1200x2800"] },
  { id: "ribbed_60mm", name: "Ribbed 60mm", suffix: "Ribbed 60mm", thumbnailUrl: OMBRE_EMBOSS_THUMB("ribbed_60mm.png"), availableSizes: ["1200x2400", "1200x2800"] },
  { id: "ribbed_duo",  name: "Ribbed Duo",  suffix: "Ribbed Duo",  thumbnailUrl: OMBRE_EMBOSS_THUMB("ribbed_duo.png"),  availableSizes: ["1200x2400", "1200x2800"] },
  { id: "tappered",   name: "Tapered",     suffix: "Tappered",    thumbnailUrl: OMBRE_EMBOSS_THUMB("tappered.png"),    availableSizes: ["1200x2400", "1200x2800"] },
];

/** Derives emboss panel URL from the selected overlay filename + emboss pattern.
 * e.g. "Ombre-#641e16-Apricot_1200x2800.jpg" + flux_ribbed → "Ombre-#641e16-Apricot_1200x2800_Flux Ribbed.png" */
export const getOmbreEmbossPanelUrl = (pattern, overlayFilename) => {
  const base = overlayFilename.replace(/\.[^.]+$/, "");
  const filename = `${base}_${pattern.suffix}.png`;
  return `${BACKEND_URL}/static/images/ombre/color-core-ombre/emboss/${pattern.id}/${encodeURIComponent(filename)}`;
};

// ─── Ombre — Color Core Ombre Groove ─────────────────────────────────────────

// const GROOVE_THUMB = (file) => `${BACKEND_URL}/thumb/ombre/color-core-ombre/groove_thumbnails/${file}`;
const GROOVE_THUMB = (file) => `${ASSETS_URL}/static/_thumbcache/ombre/color-core-ombre/groove_thumbnails/${file.replace(/\.[^.]+$/, '.jpg')}`;
// Ombre Color Core groove patterns work at both of the Ombre product sizes.
// Under Grooving + Ombre, every size in this union stays visible in the Size
// dropdown.
export const OMBRE_COLOR_CORE_GROOVE_PATTERNS = [
  { id: "aqualine", name: "Aqualine", suffix: "Aqualine", thumbnailUrl: GROOVE_THUMB("AQUALINE.png"), availableSizes: ["1200x2400", "1200x2800"] },
  { id: "arcane",   name: "Arcane",   suffix: "Arcane",   thumbnailUrl: GROOVE_THUMB("ARCANE.png"),   availableSizes: ["1200x2400", "1200x2800"] },
  { id: "arcadia",  name: "Arcadia",  suffix: "Arcadia",  thumbnailUrl: GROOVE_THUMB("ARCADIA.png"),  availableSizes: ["1200x2400", "1200x2800"] },
  { id: "drift",    name: "Drift",    suffix: "Drift",    thumbnailUrl: GROOVE_THUMB("DRIFT.png"),    availableSizes: ["1200x2400", "1200x2800"] },
  { id: "ellis",    name: "Ellis",    suffix: "Ellis",    thumbnailUrl: GROOVE_THUMB("ELLIS.png"),    availableSizes: ["1200x2400", "1200x2800"] },
  { id: "stripe",   name: "Stripe",   suffix: "Stripe",   thumbnailUrl: GROOVE_THUMB("STRIPE.png"),   availableSizes: ["1200x2400", "1200x2800"] },
  { id: "sway",     name: "Sway",     suffix: "Sway",     thumbnailUrl: GROOVE_THUMB("SWAY.png"),     availableSizes: ["1200x2400", "1200x2800"] },
  { id: "twine",    name: "Twine",    suffix: "Twine",    thumbnailUrl: GROOVE_THUMB("TWINE.png"),    availableSizes: ["1200x2400", "1200x2800"] },
  { id: "vault",    name: "Vault",    suffix: "Vault",    thumbnailUrl: GROOVE_THUMB("VAULT.png"),    availableSizes: ["1200x2400", "1200x2800"] },
];

/** Derives groove panel URL from the selected overlay filename + groove pattern.
 * Disk layout: groove/{PATTERN_UPPER}/{PATTERN_UPPER}_Ombre-{hex}-{overlay}_{size}.png
 * e.g. groove/AQUALINE/AQUALINE_Ombre-#641e16-Apricot_1200x2800.png */
export const getOmbreGroovePanelUrl = (pattern, overlayFilename) => {
  const base = overlayFilename.replace(/\.[^.]+$/, ""); // strip extension
  const folderName = pattern.id.toUpperCase(); // e.g. "AQUALINE"
  const filename = `${folderName}_${base}.png`; // e.g. "AQUALINE_Ombre-#641e16-Apricot_1200x2800.png"
  return `${BACKEND_URL}/static/images/ombre/color-core-ombre/groove/${folderName}/${encodeURIComponent(filename)}`;
};

// ─── Designer Textile (Fabrics) ───────────────────────────────────────────────

/**
 * Color groups for Designer Textile, each with named shades.
 * Shades map directly to the panel filename fragment (e.g. Blue_1 → FB1_Blue_1.jpg).
 */
export const DESIGNER_TEXTILE_COLOR_GROUPS = [
  {
    id: "Blue",
    name: "Blue",
    shades: [
      { id: "Blue_1", hex: "#7AA4BD" },
      { id: "Blue_2", hex: "#355270" },
      { id: "Blue_3", hex: "#7A869A" },
      { id: "Blue_4", hex: "#8BAECA" },
      { id: "Blue_5", hex: "#95A6B8" },
      { id: "Blue_6", hex: "#026C84" },
      { id: "Blue_7", hex: "#7CACB6" },
      { id: "Blue_8", hex: "#8CBEBD" },
    ],
  },
  {
    id: "Green",
    name: "Green",
    shades: [
      { id: "Green_1", hex: "#5A8059" },
      { id: "Green_2", hex: "#667E64" },
      { id: "Green_3", hex: "#5F897B" },
      { id: "Green_4", hex: "#4B7A6A" },
      { id: "Green_5", hex: "#817B41" },
      { id: "Green_6", hex: "#A4A272" },
      { id: "Green_7", hex: "#949456" },
    ],
  },
  {
    id: "Grey",
    name: "Grey",
    shades: [
      { id: "Grey_1",  hex: "#DADADA" },
      { id: "Grey_2",  hex: "#DBD8CF" },
      { id: "Grey_3",  hex: "#969696" },
      { id: "Grey_4",  hex: "#737977" },
      { id: "Grey_5",  hex: "#6F696B" },
      { id: "Grey_6",  hex: "#7B7B7B" },
      { id: "Grey_7",  hex: "#AEB3B7" },
      { id: "Grey_8",  hex: "#B3AEAA" },
      { id: "Grey_9",  hex: "#6F7478" },
      { id: "Grey_10", hex: "#A19AA2" },
    ],
  },
  {
    id: "Neutral",
    name: "Neutral",
    shades: [
      { id: "Neutral_1",  hex: "#D7CEC8" },
      { id: "Neutral_2",  hex: "#CDB9A9" },
      { id: "Neutral_3",  hex: "#735243" },
      { id: "Neutral_4",  hex: "#D1B59A" },
      { id: "Neutral_5",  hex: "#CDAE90" },
      { id: "Neutral_6",  hex: "#A78C6C" },
      { id: "Neutral_7",  hex: "#BAAE98" },
      { id: "Neutral_8",  hex: "#D1A684" },
      { id: "Neutral_9",  hex: "#785C46" },
      { id: "Neutral_10", hex: "#D4B690" },
      { id: "Neutral_11", hex: "#E1D3C8" },
    ],
  },
  {
    id: "Yellow",
    name: "Yellow",
    shades: [
      { id: "Yellow_1", hex: "#E3D043" },
      { id: "Yellow_2", hex: "#BFAE46" },
      { id: "Yellow_3", hex: "#C99132" },
      { id: "Yellow_4", hex: "#E3B941" },
      { id: "Yellow_5", hex: "#EDBB3C" },
    ],
  },
  {
    id: "Rust",
    name: "Rust",
    shades: [
      { id: "Rust_1", hex: "#7F311A" },
      { id: "Rust_2", hex: "#5E2118" },
      { id: "Rust_3", hex: "#975F34" },
      { id: "Rust_4", hex: "#9A3A24" },
      { id: "Rust_5", hex: "#934A27" },
    ],
  },
  {
    id: "Brown",
    name: "Brown",
    shades: [
      { id: "Brown_1", hex: "#84522F" },
      { id: "Brown_2", hex: "#725432" },
      { id: "Brown_3", hex: "#5E4831" },
      { id: "Brown_4", hex: "#97775E" },
    ],
  },
  {
    id: "Pink",
    name: "Pink",
    shades: [
      { id: "Pink_1", hex: "#986466" },
      { id: "Pink_2", hex: "#94716D" },
      { id: "Pink_3", hex: "#C19CA3" },
      { id: "Pink_4", hex: "#BD908F" },
      { id: "Pink_5", hex: "#CAAFBA" },
    ],
  },
];

/**
 * Fabric variants for Designer Textile.
 * supportedColorGroups: which color group IDs have panel images for this fabric.
 * Panel files live at: designer_textile/panels/{fabricId}_{shadeId}.jpg
 * e.g. panels/FB1_Blue_1.jpg
 *
 * How to add a new fabric:
 *   1. Add an entry below with appropriate supportedColorGroups.
 *   2. Place panel images at: designer_textile/panels/{id}_{ColorGroup_N}.jpg
 */
export const DESIGNER_TEXTILE_FABRICS = [
  { id: "FB1", name: "FB1", supportedColorGroups: ["Blue", "Green", "Grey", "Neutral", "Yellow", "Rust", "Brown", "Pink"] },
  { id: "FB2", name: "FB2", supportedColorGroups: ["Blue", "Green", "Grey", "Neutral", "Yellow", "Rust", "Brown", "Pink"] },
  { id: "FB3", name: "FB3", supportedColorGroups: ["Blue", "Green", "Grey", "Neutral", "Yellow", "Rust", "Brown", "Pink"] },
  { id: "FB4", name: "FB4", supportedColorGroups: ["Blue", "Green", "Grey", "Neutral", "Yellow", "Rust", "Brown", "Pink"] },
  { id: "FB5", name: "FB5", supportedColorGroups: ["Blue", "Green", "Grey", "Neutral", "Yellow", "Rust", "Brown", "Pink"] },
];

export const DESIGNER_TEXTILE_SIZES = [
  { id: "1200x2800", label: "1200×2800 mm" },
  { id: "1200x2400", label: "1200×2400 mm" },
  { id: "600x600",   label: "600×600 mm" },
  { id: "600x1200",  label: "600×1200 mm" },
];

/** Thicknesses specific to Designer Textile */
export const DESIGNER_TEXTILE_THICKNESSES = [
  "12mm (PET Panel)",
  "25mm (PET Panel)",
  "PET Wool",
];

/**
 * Emboss patterns available for Designer Textile.
 * availableSizes gates which patterns are clickable for a given size selection.
 * Thumbnails live at: designer_textile/emboss_thumbnails/{id}.png
 */
// Emboss patterns for Designer Textile, split strictly by size — the same
// split applies to Colour Core above.  A pattern belongs to exactly one size;
// the two sets never overlap:
//   1200x2800 : the 15 "3D" patterns  — ribbed family, elliptera, ellipsia,
//               flux ribbed, drift, aqualine, tapered, weave, bloom,
//               alter flute, penray, shard
//   1200x2400 : the 6 "mosaic" patterns — axis, deck, square_8, square_30,
//               symmetric, triangle
//
// The 600-series sizes carry NO emboss patterns at all: the mosaic patterns
// used to be offered at 600x600 and 600x1200, so those sizes now fall out of
// the Size dropdown on the Embossed surface entirely
// (getAvailableSizesForSurface unions these arrays to build it).
const DT_EMBOSS_THUMB = EMBOSS_THUMB;

export const DESIGNER_TEXTILE_EMBOSS_PATTERNS = [
  // ── 3D patterns — 1200x2800 only ─────────────────────────────────────────
  { id: "ribbed_25mm", name: "Ribbed 25mm",  filenameSuffix: "Ribbed 25mm",  thumbnailUrl: DT_EMBOSS_THUMB("ribbed_25mm.png"),  availableSizes: ["1200x2800"] },
  { id: "ribbed_45mm", name: "Ribbed 45mm",  filenameSuffix: "Ribbed 45mm",  thumbnailUrl: DT_EMBOSS_THUMB("ribbed_45mm.png"),  availableSizes: ["1200x2800"] },
  { id: "ribbed_60mm", name: "Ribbed 60mm",  filenameSuffix: "Ribbed 60mm",  thumbnailUrl: DT_EMBOSS_THUMB("ribbed_60mm.png"),  availableSizes: ["1200x2800"] },
  { id: "ribbed_duo",  name: "Ribbed Duo",   filenameSuffix: "Ribbed Duo",   thumbnailUrl: DT_EMBOSS_THUMB("ribbed_duo.png"),   availableSizes: ["1200x2800"] },
  { id: "elliptera",   name: "Elliptera",    filenameSuffix: "Elliptera",    thumbnailUrl: DT_EMBOSS_THUMB("elliptera.png"),    availableSizes: ["1200x2800"] },
  { id: "ellipsia",    name: "Ellipsia",     filenameSuffix: "Ellipsia",     thumbnailUrl: DT_EMBOSS_THUMB("ellipsia.png"),     availableSizes: ["1200x2800"] },
  { id: "flux_ribbed", name: "Flux Ribbed",  filenameSuffix: "Flux Ribbed",  thumbnailUrl: DT_EMBOSS_THUMB("flux_ribbed.png"),  availableSizes: ["1200x2800"] },
  { id: "drift",       name: "Drift",        filenameSuffix: "Drift",        thumbnailUrl: DT_EMBOSS_THUMB("drift.png"),        availableSizes: ["1200x2800"] },
  { id: "aqualine",    name: "Aqualine",     filenameSuffix: "Aqualine",     thumbnailUrl: DT_EMBOSS_THUMB("aqualine.png"),     availableSizes: ["1200x2800"] },
  { id: "tappered",    name: "Tapered",      filenameSuffix: "Tappered",     thumbnailUrl: DT_EMBOSS_THUMB("tappered.png"),     availableSizes: ["1200x2800"] },
  { id: "weave",       name: "Weave",        filenameSuffix: "Weave",        thumbnailUrl: DT_EMBOSS_THUMB("weave.png"),        availableSizes: ["1200x2800"] },
  { id: "bloom",       name: "Bloom",        filenameSuffix: "Bloom",        thumbnailUrl: DT_EMBOSS_THUMB("bloom.png"),        availableSizes: ["1200x2800"] },
  { id: "alterflute",  name: "Alter Flute",  filenameSuffix: "Alterflute",   thumbnailUrl: DT_EMBOSS_THUMB("afterflute.png"),   availableSizes: ["1200x2800"], excludedThicknesses: ALTER_FLUTE_EXCLUDED_THICKNESSES },
  { id: "penray",      name: "Penray",       filenameSuffix: "Penray",       thumbnailUrl: DT_EMBOSS_THUMB("penray.png"),       availableSizes: ["1200x2800"] },
  { id: "shard",       name: "Shard",        filenameSuffix: "Shard",        thumbnailUrl: DT_EMBOSS_THUMB("shard.png"),        availableSizes: ["1200x2800"] },
  // ── Mosaic patterns — 1200x2400 only ─────────────────────────────────────
  { id: "axis",        name: "Axis",         filenameSuffix: "Axis",         thumbnailUrl: DT_EMBOSS_THUMB("axis.png"),         availableSizes: ["1200x2400"], panelRows: 6 },
  { id: "square_8",    name: "Square 8",     filenameSuffix: "Square 8",     thumbnailUrl: DT_EMBOSS_THUMB("square_8.png"),     availableSizes: ["1200x2400"], panelRows: 6 },
  { id: "square_30",   name: "Square 30",    filenameSuffix: "Square 30",    thumbnailUrl: DT_EMBOSS_THUMB("square_30.png"),    availableSizes: ["1200x2400"], panelRows: 6 },
  { id: "deck",        name: "Deck",         filenameSuffix: "Deck",         thumbnailUrl: DT_EMBOSS_THUMB("deck.png"),         availableSizes: ["1200x2400"], panelRows: 6 },
  { id: "triangle",    name: "Triangle",     filenameSuffix: "Triangle",     thumbnailUrl: DT_EMBOSS_THUMB("triangle.png"),     availableSizes: ["1200x2400"], panelRows: 6 },
  { id: "symmetric",   name: "Symmetric",    filenameSuffix: "Symmetric",    thumbnailUrl: DT_EMBOSS_THUMB("symmetric.png"),    availableSizes: ["1200x2400"],                        panelRows: 6 },
];

/**
 * Returns the full-resolution panel URL for a given fabric + shade.
 * File naming: panels/{fabricId}_{shadeId}.jpg  e.g. panels/FB1_Blue_1.jpg
 * Used server-side / as a fallback; in the UI prefer useDTPanel() which
 * manages a Blob URL so only one decoded image lives in memory at a time.
 */
export const getDesignerTextilePanelUrl = (fabricId, shadeId) =>
  `${BACKEND_URL}/static/images/fabric/designer_textile/panels/${fabricId}_${shadeId}.jpg`;

/**
 * Returns the /thumb/ URL for a fabric + shade combination.
 * The backend center-crops + resizes to 200×200 px on first request and
 * caches the result — subsequent requests return the tiny cached file.
 * Used for the fabric picker thumbnails so they stay ~5–15 KB each.
 */
// export const getDesignerTextileThumbnailUrl = (fabricId, shadeId) =>
//   `${BACKEND_URL}/thumb/fabric/designer_textile/panels/${fabricId}_${shadeId}.jpg`;
export const getDesignerTextileThumbnailUrl = (fabricId, shadeId) =>
  (fabricId && shadeId)
    ? `${ASSETS_URL}/static/_thumbcache/fabric/designer_textile/panels/${fabricId}_${shadeId}.jpg`
    : null;

/**
 * Returns the pre-rendered embossed panel URL (reserved for future use).
 * File naming: emboss/{embossId}/{fabricId}_{shadeId}_{filenameSuffix}.png
 *
 * @param {string} fabricId        - e.g. "FB1"
 * @param {string} embossId        - folder-level pattern id (e.g. "ribbed_25mm")
 * @param {string} shadeId         - e.g. "Blue_1"
 * @param {string} filenameSuffix  - exact suffix from pattern.filenameSuffix
 */
export const getDesignerTextileEmbossUrl = (fabricId, embossId, shadeId, filenameSuffix) =>
  `${BACKEND_URL}/static/images/fabric/designer_textile/emboss_panels/${embossId}/${encodeURIComponent(`${fabricId}_${shadeId}_${filenameSuffix}.png`)}`;

