/**
 * The full UniVicoustic panel catalog flattened into a single browsable
 * list for the standalone draw-visualizer.
 *
 * Image-source split:
 *   - `thumbnailUrl` — what the picker grid `<img>` shows.  Always points
 *     at a small jpg / png (`_thumbcache/...` or vicstrip thumbnails dir,
 *     ~5–130 KB).  Lazy-loaded via the browser's native `loading="lazy"`.
 *   - `thumbnailGradient` — set when no small thumb file exists (Ombre).
 *     CSS background string the picker tile paints instantly with zero
 *     network — built from the base + overlay hex codes already in the
 *     filename, so colors are accurate.
 *   - `panelUrl` — the full-resolution panel jpg used as the wall texture
 *     after the user picks a tile.  Loaded via `useBlobPanel` so exactly
 *     one decoded panel bitmap lives in memory at a time.
 *
 * Why we now import from `@/data/skus` instead of hard-coding eight rows:
 *   - The configurator already maintains every product / pattern / color
 *     combination there.  Re-listing them here would mean two sources of
 *     truth and immediate drift the moment a SKU changes.
 *   - Removing the visualizer is still a 2-line change in App.js — this
 *     module just imports from skus.js, it doesn't modify it.  So nothing
 *     is "leaking back" into the rest of the app.
 *
 * Total catalog size is ~500 panels (Designer Textile alone is 5 fabrics
 * × ~55 shades).  PanelComposer renders them grouped by family with a
 * subfamily filter strip + lazy-loaded thumbnails so only the tiles in
 * the visible scroll window actually fetch.
 */
import {
  VICSTRIP_PRODUCT,
  VICSTRIP_COLOR_TO_CODE,
  getImagePath,
  getVicstripThumbnailUrl,
  COLOR_CORE_COLORS,
  COLOR_CORE_FABRIC_STRUCTURES,
  getColorCorePanelUrl,
  getColorCoreThumbnailUrl,
  DESIGNER_TEXTILE_FABRICS,
  DESIGNER_TEXTILE_COLOR_GROUPS,
  getDesignerTextilePanelUrl,
  getDesignerTextileThumbnailUrl,
  OMBRE_COLOR_CORE_BASE_COLORS,
  OMBRE_COLOR_CORE_OVERLAYS,
  getOmbreColorCorePanelUrl,
  WOOD_PERFORATION_PATTERNS,
} from "@/data/skus";

const ASSETS = process.env.REACT_APP_ASSETS_URL || "";

// ─── VicStrip ────────────────────────────────────────────────────────────────
// Canonical color-id → VCS code mapping lives in @/data/skus so the
// configurator and visualizer share one source of truth.

// Wall texture uses the pre-cropped 814×1900 cutouts at
// /static/images/vicstrip/panels/...  (same files the configurator's
// "Download Panel" hover serves up).  They tile much more cleanly than
// the larger room-render images because the cutout already has just one
// panel in frame.
const vicstripPanels = VICSTRIP_PRODUCT.patterns.flatMap((pattern) =>
  pattern.colors.map((color) => {
    const designCode = VICSTRIP_COLOR_TO_CODE[color.id];
    return {
      id: `vicstrip-${pattern.id}-${color.id}`,
      name: `${pattern.name} · ${color.name}`,
      family: "VicStrip",
      subfamily: pattern.id,
      subfamilyLabel: pattern.name,
      thumbnailUrl: getVicstripThumbnailUrl(pattern.id, designCode),
      panelUrl: `${ASSETS}/static/images/vicstrip/panels/${pattern.id}/${color.id}.jpg`,
      // If the cropped cutout is missing on the CDN, fall back to the
      // full room-render at /static/images/vicstrip/{pattern}/{color}.jpg.
      panelFallbackUrl: getImagePath(pattern.id, color.id),
    };
  }),
);

// ─── Color Core (Fabrics) ────────────────────────────────────────────────────
const colorCorePanels = COLOR_CORE_FABRIC_STRUCTURES.flatMap((structure) =>
  COLOR_CORE_COLORS.map((color) => ({
    id: `colorcore-${structure.id}-${color.id}`,
    name: `${structure.name} · ${color.name}`,
    family: "Color Core",
    subfamily: structure.id,
    subfamilyLabel: structure.name,
    thumbnailUrl: getColorCoreThumbnailUrl(structure.id, color.id),
    panelUrl: getColorCorePanelUrl(structure.id, color.id),
  })),
);

// ─── Designer Textile ────────────────────────────────────────────────────────
const designerTextilePanels = DESIGNER_TEXTILE_FABRICS.flatMap((fabric) =>
  DESIGNER_TEXTILE_COLOR_GROUPS.filter((group) =>
    fabric.supportedColorGroups.includes(group.id),
  ).flatMap((group) =>
    group.shades.map((shade) => ({
      id: `dt-${fabric.id}-${shade.id}`,
      name: `${fabric.name} · ${shade.id.replace(/_/g, " ")}`,
      family: "Designer Textile",
      subfamily: fabric.id,
      subfamilyLabel: fabric.name,
      thumbnailUrl: getDesignerTextileThumbnailUrl(fabric.id, shade.id),
      panelUrl: getDesignerTextilePanelUrl(fabric.id, shade.id),
    })),
  ),
);

// ─── Ombre — Color Core Ombre ────────────────────────────────────────────────
// IMPORTANT: there's no `_thumbcache` for Ombre — the smallest file
// available per overlay is the 1200×2800 panel jpg (1–3 MB).  Loading 100+
// of those into the picker grid clogs the browser's connection pool and
// makes the Ombre tab feel "stuck" while you wait for the picker to fill.
// So we paint each tile as a CSS linear-gradient between the base color
// and the overlay color (both already known: base.hex from the catalog,
// overlay.hex from the filename `Ombre-#hex-Base_size.jpg`).  Zero network
// for the picker.  The real jpg is only fetched as `panelUrl` when the
// user actually clicks a tile.
const ombrePanels = OMBRE_COLOR_CORE_BASE_COLORS.flatMap((base) => {
  const overlays = OMBRE_COLOR_CORE_OVERLAYS[base.id] || [];
  return overlays.map((overlay) => ({
    id: `ombre-${base.id}-${overlay.hex.replace("#", "")}`,
    name: `${base.name} · ${overlay.hex}`,
    family: "Ombre",
    subfamily: base.id,
    subfamilyLabel: base.name,
    thumbnailUrl: null,
    thumbnailGradient: `linear-gradient(to bottom, ${base.hex} 0%, ${overlay.hex} 100%)`,
    panelUrl: getOmbreColorCorePanelUrl(base.id, overlay.filename),
  }));
});

// ─── Wood Perforations ───────────────────────────────────────────────────────
// One PNG per pattern; no color variants.  We use the raw url (transparent
// perforation overlay) as the texture — when warped onto the wall it gives
// the perforation rhythm without any specific wood color, which is fine
// for a "what does this pattern look like at this scale" preview.
const woodPanels = WOOD_PERFORATION_PATTERNS.map((p) => ({
  id: `wood-${p.id}`,
  name: p.name,
  family: "Wood Perforations",
  subfamily: "all",
  subfamilyLabel: "All",
  thumbnailUrl: p.thumbnailUrl,
  panelUrl: p.url,
}));

// ─── Bespoke Graphics — async-loaded (~316 designs across 15 categories) ─────
//
// Bespoke Graphics is the user-facing name for what skus.js calls
// `flat-embossed-vmd`.  The design list isn't in skus.js — the configurator
// fetches it from products.json at runtime (same file the API used to
// serve, now hosted directly on the CDN).  Re-stating ~316 design codes
// inline would be insane and would drift on every catalog edit, so we
// fetch + map the same JSON.
//
// Each design entry already has both `thumbnail_url` (small _thumbcache
// jpg) and `texture_url` (full panel jpg), so we don't need to rebuild
// any URLs — just resolve them against ASSETS.
//
// `loadBespokeGraphicsPanels()` resolves to an array of panel objects
// with the same shape as the static lists above.  Caller merges them
// into the in-memory catalog when the fetch completes.  If the fetch
// fails (offline / CDN down), we silently skip Bespoke Graphics — the
// other families still work.
// products.json shape (top-level array of products):
//   [{ id: "flat-embossed-vmd", name: "Bespoke Graphics", active: true,
//      categories: [{ id, name, product_type, designs: [{ design_code,
//      design_name, texture_url, thumbnail_url, ... }] }] }, ...]
let bespokePromise = null;
export function loadBespokeGraphicsPanels() {
  if (bespokePromise) return bespokePromise;
  const url = `${ASSETS}/data/products.json`;
  bespokePromise = fetch(url, { cache: "force-cache" })
    .then((res) => {
      if (!res.ok) throw new Error(`products.json HTTP ${res.status}`);
      return res.json();
    })
    .then((products) => {
      const root = Array.isArray(products) ? products : [];
      const bespoke = root.find((p) => p?.id === "flat-embossed-vmd");
      const categories = Array.isArray(bespoke?.categories) ? bespoke.categories : [];

      const resolve = (path) =>
        !path ? null : path.startsWith("http") ? path : `${ASSETS}${path}`;

      const panels = [];
      for (const cat of categories) {
        const designs = Array.isArray(cat?.designs) ? cat.designs : [];
        for (const d of designs) {
          const thumb = resolve(d.thumbnail_url || d.texture_url);
          const tex = resolve(d.texture_url || d.thumbnail_url);
          if (!thumb || !tex) continue;
          panels.push({
            id: `bespoke-${cat.id}-${d.design_code || d.id}`,
            name: `${cat.name} · ${d.design_name || d.design_code}`,
            family: "Bespoke Graphics",
            subfamily: cat.id,
            subfamilyLabel: cat.name,
            thumbnailUrl: thumb,
            panelUrl: tex,
          });
        }
      }
      return panels;
    })
    .catch((err) => {
      console.warn("[visualizer-draw] could not load Bespoke Graphics:", err);
      return [];
    });
  return bespokePromise;
}

// ─── Combined catalog + family ordering ──────────────────────────────────────
//
// Synchronous baseline — Bespoke Graphics is appended via
// loadBespokeGraphicsPanels() once products.json arrives.  PanelComposer
// keeps a stateful copy and merges on resolve.
export const SAMPLE_PANELS = [
  ...vicstripPanels,
  ...colorCorePanels,
  ...designerTextilePanels,
  ...ombrePanels,
  ...woodPanels,
];

/** Display order for the family tab strip. */
export const PANEL_FAMILIES = [
  "VicStrip",
  "Color Core",
  "Designer Textile",
  "Bespoke Graphics",
  "Ombre",
  "Wood Perforations",
];

/**
 * Returns the ordered list of {id, label} subfamilies for a given family.
 * Order preserves first-seen insertion order from SAMPLE_PANELS so the
 * tabs match the canonical order of patterns / structures / fabrics in
 * skus.js.
 */
export function getSubfamiliesFor(family) {
  const seen = new Map();
  for (const p of SAMPLE_PANELS) {
    if (p.family !== family) continue;
    if (!seen.has(p.subfamily)) {
      seen.set(p.subfamily, p.subfamilyLabel);
    }
  }
  const subs = Array.from(seen, ([id, label]) => ({ id, label }));
  // Hide the subfamily strip for families that only have one subfamily
  // (e.g. Wood Perforations) — caller can detect via subs.length === 1.
  return subs;
}
