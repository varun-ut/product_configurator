import { useState, useEffect, useCallback, useRef, memo, useMemo } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { useRenderLog, RENDER_DEBUG } from "@/hooks/use-render-log";
// import axios from "axios"; // removed: product catalog + specs now fetched from CDN JSON
import { toast } from "sonner";
import { Download, Heart, Trash2, RefreshCw, Shield, Flame, Leaf, Award, ZoomIn, ZoomOut, X, FileText, MessageCircle, SplitSquareHorizontal, ArrowDown, ArrowRight, User, LogOut, ChevronDown, HelpCircle, Package, Loader2, Search, Pencil, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { getUser, logout, onAuthChange } from "@/lib/auth";
import { track } from "@/lib/analytics";
import { toPng } from "html-to-image";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import CanvasPreview from "@/components/CanvasPreview";
import FlatEmbossedPreview, { preloadImages } from "@/components/FlatEmbossedPreview";
import VicStripPreview from "@/components/VicStripPreview";
import { VICSTRIP_PRODUCT, VICSTRIP_COLOR_TO_CODE, getImagePath, getFlatEmbossedPanelPath, FLAT_EMBOSSED_VMT_CONFIG, resolveAssetUrl, FLAT_EMBOSSED_EMBOSS_PATTERNS, LEATHER_EMBOSS_BY_SIZE, WOOD_PERFORATION_SIZES, WOOD_PERFORATION_PATTERNS, WOOD_PERFORATION_EXCLUSIONS, COLOR_CORE_COLORS, COLOR_CORE_FABRIC_STRUCTURES, getColorCorePanelUrl, getColorCoreThumbnailUrl, COLOR_CORE_EMBOSS_PATTERNS, COLOR_CORE_SIZES, getColorCoreEmbossUrl, OMBRE_COLOR_CORE_BASE_COLORS, OMBRE_COLOR_CORE_OVERLAYS, getOmbreColorCorePanelUrl, OMBRE_COLOR_CORE_EMBOSS_PATTERNS, getOmbreEmbossPanelUrl, OMBRE_COLOR_CORE_GROOVE_PATTERNS, getOmbreGroovePanelUrl, DESIGNER_TEXTILE_COLOR_GROUPS, DESIGNER_TEXTILE_FABRICS, DESIGNER_TEXTILE_SIZES, DESIGNER_TEXTILE_THICKNESSES, getDesignerTextileThumbnailUrl, getDesignerTextilePanelUrl, DESIGNER_TEXTILE_EMBOSS_PATTERNS, getDesignerTextileEmbossUrl, getVicstripThumbnailUrl, isEmbossAvailableForThickness } from "@/data/skus";
import { useBlobPanel, useMultiBlobPanels } from "@/hooks/use-blob-panel";
import { downloadPanelImages } from "@/lib/downloadPanelImages";
import { saveImageFile } from "@/lib/downloadImageFile";
import SignatureOmbreRoomPreview from "@/components/SignatureOmbreRoomPreview";
import { OmbreEmbossEngine } from "@/lib/OmbreEmbossEngine";
import ChatWidget from "@/components/ChatWidget";

// const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
// const API = `${BACKEND_URL}/api`;
// Products catalog + tech specs are now fetched as static JSON from the CDN.
const ASSETS_URL = process.env.REACT_APP_ASSETS_URL || "http://localhost:8001";

// Boot loader toggles (quickly reversible without touching JSX)
const ENABLE_BOOT_WHITE_OVERLAY = true;
const BOOT_OVERLAY_EXTRA_MS = 500;

// ── Signature Ombre: 6 emboss patterns with OBJ models ──────────────────────
// thumbnailUrl points at the pre-resized 400×400 center-cropped PNGs under
// /thumbs/ — the originals under /images/emboss_thumbnails/*.png are
// 2000×4655 portrait rectangles that alias badly when the browser has to
// downsample them ~17× to the grid tile.  The /thumbs/ set mirrors what the
// Designer Textile backend thumbnailer produces (200×200 center-crop), just
// done once at build time rather than on-demand at request time.  Originals
// are preserved next to the thumbs in case higher-res is needed elsewhere.
const SO_PATTERNS = [
  { id: 'ribbed-25',   name: 'Ribbed 25',   modelUrl: '/models/emboss/ribbed-25.obj',   thumbnailUrl: '/images/emboss_thumbnails/thumbs/ribbed_25mm.png' },
  { id: 'ribbed-45',   name: 'Ribbed 45',   modelUrl: '/models/emboss/ribbed-45.obj',   thumbnailUrl: '/images/emboss_thumbnails/thumbs/ribbed_45mm.png' },
  { id: 'ribbed-60',   name: 'Ribbed 60',   modelUrl: '/models/emboss/ribbed-60.obj',   thumbnailUrl: '/images/emboss_thumbnails/thumbs/ribbed_60mm.png' },
  { id: 'ribbed-duo',  name: 'Ribbed Duo',  modelUrl: '/models/emboss/ribbed-duo.obj',  thumbnailUrl: '/images/emboss_thumbnails/thumbs/ribbed_duo.png?v=2' },
  { id: 'tapered',     name: 'Tapered',     modelUrl: '/models/emboss/tapered.obj',     thumbnailUrl: '/images/emboss_thumbnails/thumbs/tappered.png' },
  { id: 'flux-ribbed', name: 'Flux Ribbed', modelUrl: '/models/emboss/flux-ribbed.obj', thumbnailUrl: '/images/emboss_thumbnails/thumbs/flux_ribbed.png' },
];
// ── Signature Ombre: overlay color palette (grouped by hue family) ────────
// Codes (BL-01, BR-02, etc.) are the canonical product identifiers from the
// SignatureOmbreCodes spec sheet — the UI surfaces these instead of the hex
// values.
const SO_COLORS_BY_GROUP = [
  { group: 'Blue', colors: [
    { code: 'BL-01', hex: '#7cabc5' }, { code: 'BL-02', hex: '#355270' },
    { code: 'BL-03', hex: '#828fa3' }, { code: 'BL-04', hex: '#91bad9' },
    { code: 'BL-05', hex: '#a0b7c9' }, { code: 'BL-06', hex: '#006f8a' },
    { code: 'BL-07', hex: '#7cb3bd' }, { code: 'BL-08', hex: '#93cbc9' },
  ]},
  { group: 'Brown', colors: [
    { code: 'BR-01', hex: '#7c4d25' }, { code: 'BR-02', hex: '#6e512d' },
    { code: 'BR-03', hex: '#543d24' }, { code: 'BR-04', hex: '#ab8d70' },
  ]},
  { group: 'Green', colors: [
    { code: 'GR-01', hex: '#5f855a' }, { code: 'GR-02', hex: '#708b6d' },
    { code: 'GR-03', hex: '#689885' }, { code: 'GR-04', hex: '#578d79' },
    { code: 'GR-05', hex: '#928b48' }, { code: 'GR-06', hex: '#abaa75' },
    { code: 'GR-07', hex: '#a5a35d' },
  ]},
  { group: 'Grey', colors: [
    { code: 'GY-01', hex: '#d9d9d9' }, { code: 'GY-02', hex: '#edece1' },
    { code: 'GY-03', hex: '#8e8e8e' }, { code: 'GY-04', hex: '#7c807e' },
    { code: 'GY-05', hex: '#797374' }, { code: 'GY-06', hex: '#858283' },
    { code: 'GY-07', hex: '#c3cbcd' }, { code: 'GY-08', hex: '#cac6c3' },
    { code: 'GY-09', hex: '#7a7e80' }, { code: 'GY-10', hex: '#b2aab1' },
  ]},
  { group: 'Neutral', colors: [
    { code: 'NE-01', hex: '#ebdfd9' }, { code: 'NE-02', hex: '#e7d0bd' },
    { code: 'NE-03', hex: '#845e4f' }, { code: 'NE-04', hex: '#e8c9ab' },
    { code: 'NE-05', hex: '#e9c5a4' }, { code: 'NE-06', hex: '#bc9c7a' },
    { code: 'NE-07', hex: '#ccbfa6' }, { code: 'NE-08', hex: '#e3b692' },
    { code: 'NE-09', hex: '#806449' }, { code: 'NE-10', hex: '#f4d1a8' },
    { code: 'NE-11', hex: '#f0e1d4' },
  ]},
  { group: 'Pink', colors: [
    { code: 'PK-01', hex: '#b57777' }, { code: 'PK-02', hex: '#ac827d' },
    { code: 'PK-03', hex: '#d3a7ae' }, { code: 'PK-04', hex: '#d69fa0' },
    { code: 'PK-05', hex: '#ddbac8' },
  ]},
  { group: 'Rust', colors: [
    { code: 'RU-01', hex: '#813923' }, { code: 'RU-02', hex: '#5d241b' },
    { code: 'RU-03', hex: '#9d6632' }, { code: 'RU-04', hex: '#9b3b22' },
    { code: 'RU-05', hex: '#8e4725' },
  ]},
  { group: 'Yellow', colors: [
    { code: 'YL-01', hex: '#f3dd41' }, { code: 'YL-02', hex: '#cfbd46' },
    { code: 'YL-03', hex: '#d89a2f' }, { code: 'YL-04', hex: '#f8c941' },
    { code: 'YL-05', hex: '#fcb606' },
  ]},
];

// hex → code reverse lookup, derived once from SO_COLORS_BY_GROUP so any
// place that only has the hex (e.g. the selection-summary mini-cards which
// store hex as the value) can resolve the user-facing code label.
const SO_HEX_TO_CODE = Object.fromEntries(
  SO_COLORS_BY_GROUP.flatMap(g => g.colors.map(c => [c.hex.toLowerCase(), c.code]))
);
const soCodeForHex = (hex) => (hex ? SO_HEX_TO_CODE[hex.toLowerCase()] ?? hex : hex);

// ── Signature Ombre: blend presets (dark zone % from bottom → top = white) ─
const SO_BLEND_PRESETS = [
  { label: '30/70', value: 30 },
  { label: '40/60', value: 40 },
  { label: '50/50', value: 50 },
];

// NRC hover hints applied to every thickness dropdown across the app.
// Every product's thickness options are one of these three PET variants
// (VicStrip labels have been reconciled with the rest).  These are the
// defaults; per-product overrides go in THICKNESS_NRC_HINTS_BY_PRODUCT.
const THICKNESS_NRC_HINTS = {
  "12mm (PET Panel)": "0.45 NRC can be increased to 0.9 (See Tech Specs for further details)",
  "25mm (PET Panel)": "0.7 NRC can be increased to 0.9 (See Tech Specs for further details)",
  "PET Wool":         "0.7 NRC can be increased to 0.9 (See Tech Specs for further details)",
};

// Per-product NRC overrides. Anything not listed here falls back to the
// THICKNESS_NRC_HINTS default. Add a new productId key + thickness map to
// override values for a specific product line.
const THICKNESS_NRC_HINTS_BY_PRODUCT = {
  vicstrip: {
    "12mm (PET Panel)": "0.5 NRC can be increased to 0.9 (See Tech Specs for further details)",
    "25mm (PET Panel)": "0.75 NRC can be increased to 0.9 (See Tech Specs for further details)",
  },
};

// Resolves the NRC hint for a (productId, thickness) pair — override wins,
// otherwise falls back to the global default. Returns undefined when no
// hint is defined (the dropdown skips the tooltip in that case).
const resolveThicknessHint = (productId, thickness) =>
  THICKNESS_NRC_HINTS_BY_PRODUCT[productId]?.[thickness] ?? THICKNESS_NRC_HINTS[thickness];

// Shared SelectItem that auto-wraps in a Tooltip when the thickness has an
// NRC hint defined.  Use this in every thickness dropdown so the "floater"
// hover behaviour is consistent across products/categories.
const ThicknessSelectItem = ({ thickness, testIdPrefix = "thickness", disabled = false, disabledReason, productId }) => {
  const hint = resolveThicknessHint(productId, thickness);
  const item = (
    <SelectItem value={thickness} disabled={disabled} data-testid={`${testIdPrefix}-${thickness}`}>
      {thickness}
    </SelectItem>
  );
  // When disabled, the disabledReason replaces the NRC hint as the tooltip content.
  const tooltipText = disabled ? disabledReason : hint;
  if (!tooltipText) return item;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{item}</TooltipTrigger>
      <TooltipContent side="right" className="max-w-[220px] text-center bg-slate-100 text-slate-700 border border-slate-200">
        {tooltipText}
      </TooltipContent>
    </Tooltip>
  );
};

// Technical specs data (fallback)
const DEFAULT_SPECS = {
  "flat-embossed-vmd": {
    fire_rating: "Class A (ASTM E84)",
    nrc_rating: "0.85 - 0.95",
    sustainability: ["FSC Certified", "GREENGUARD Gold", "Red List Free"],
    material: "High-Density Polyester Fiber",
    thickness_mm: "12-25mm",
    weight_kg_m2: "2.4 - 4.8",
    installation: "Adhesive / Mechanical Fix",
    warranty: "10 Years",
    certifications: ["ISO 14001", "ISO 9001", "OEKO-TEX Standard 100"]
  },
  "ombre": {
    fire_rating: "Class A (ASTM E84)",
    nrc_rating: "0.80 - 0.90",
    sustainability: ["Recycled Content 60%", "GREENGUARD Gold", "Red List Free"],
    material: "HD Acoustic Felt",
    thickness_mm: "9-12mm",
    weight_kg_m2: "1.8 - 2.2",
    installation: "Adhesive Mount",
    warranty: "8 Years",
    certifications: ["ISO 14001", "Declare Label", "HPD"]
  },
  "vicstrip": {
    fire_rating: "Class B (ASTM E84)",
    nrc_rating: "0.70 - 0.85",
    sustainability: ["FSC Certified Wood", "Low VOC", "Red List Free"],
    material: "MDF Core + Acoustic Backing",
    thickness_mm: "12-25mm",
    weight_kg_m2: "3.2 - 5.5",
    installation: "Rail System / Direct Fix",
    warranty: "15 Years",
    certifications: ["ISO 14001", "PEFC", "EPD Verified"]
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// Module-level components — defined OUTSIDE Configurator so React never
// unmounts/remounts them on parent re-renders. React.memo skips re-renders
// when props are shallowly equal.
// ─────────────────────────────────────────────────────────────────────────────

const TechSpecsPanel = memo(({ specs }) => (
  <div className="space-y-6" data-testid="tech-specs-panel">
    <div className="flex items-start gap-3">
      <div className="p-2 rounded-lg bg-red-50"><Flame className="h-5 w-5 text-red-500" /></div>
      <div>
        <h4 className="font-manrope font-bold text-sm">Fire Rating</h4>
        <p className="text-sm text-[hsl(215,16%,47%)]">{specs.fire_rating || "N/A"}</p>
      </div>
    </div>
    <div className="flex items-start gap-3">
      <div className="p-2 rounded-lg bg-blue-50">
        <svg className="h-5 w-5 text-blue-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/>
          <path d="M12 6v6l4 2"/>
        </svg>
      </div>
      <div>
        <h4 className="font-manrope font-bold text-sm">NRC Rating</h4>
        <p className="text-sm text-[hsl(215,16%,47%)]">{specs.nrc_rating || "N/A"}</p>
      </div>
    </div>
    <div className="flex items-start gap-3">
      <div className="p-2 rounded-lg bg-gray-100">
        <svg className="h-5 w-5 text-gray-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <path d="M3 9h18M9 3v18"/>
        </svg>
      </div>
      <div>
        <h4 className="font-manrope font-bold text-sm">Material</h4>
        <p className="text-sm text-[hsl(215,16%,47%)]">{specs.material || "N/A"}</p>
      </div>
    </div>
    <div className="grid grid-cols-2 gap-4">
      <div className="p-3 rounded-lg bg-[hsl(var(--secondary))]">
        <p className="text-xs text-[hsl(215,16%,47%)]">Thickness</p>
        <p className="font-manrope font-bold text-sm">{specs.thickness_mm || "N/A"}</p>
      </div>
      <div className="p-3 rounded-lg bg-[hsl(var(--secondary))]">
        <p className="text-xs text-[hsl(215,16%,47%)]">Weight</p>
        <p className="font-manrope font-bold text-sm">{specs.weight_kg_m2 || "N/A"} kg/m²</p>
      </div>
    </div>
    <div className="flex items-start gap-3">
      <div className="p-2 rounded-lg bg-green-50"><Leaf className="h-5 w-5 text-green-500" /></div>
      <div className="flex-1">
        <h4 className="font-manrope font-bold text-sm">Sustainability</h4>
        <div className="flex flex-wrap gap-1.5 mt-1">
          {(specs.sustainability || []).map((item, i) => (
            <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">{item}</span>
          ))}
        </div>
      </div>
    </div>
    <div className="flex items-start gap-3">
      <div className="p-2 rounded-lg bg-amber-50"><Award className="h-5 w-5 text-amber-500" /></div>
      <div className="flex-1">
        <h4 className="font-manrope font-bold text-sm">Certifications</h4>
        <div className="flex flex-wrap gap-1.5 mt-1">
          {(specs.certifications || []).map((item, i) => (
            <span key={i} className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-700">{item}</span>
          ))}
        </div>
      </div>
    </div>
    <div className="grid grid-cols-2 gap-4 pt-4 border-t">
      <div>
        <p className="text-xs text-[hsl(215,16%,47%)]">Installation</p>
        <p className="font-medium text-sm">{specs.installation || "N/A"}</p>
      </div>
      <div>
        <p className="text-xs text-[hsl(215,16%,47%)]">Warranty</p>
        <p className="font-medium text-sm">{specs.warranty || "N/A"}</p>
      </div>
    </div>
  </div>
));
TechSpecsPanel.displayName = "TechSpecsPanel";

// Maps raw vicstrip category/pattern names to display-friendly labels
const VICSTRIP_DISPLAY_LABEL = (name) => {
  if (!name) return name;
  const n = name.toLowerCase().replace(/[-_\s]+/g, ' ').trim();
  if (n === 'double groove') return 'Double Groove';
  if (n === 'single groove') return 'Single Groove';
  if (n === 'square') return 'Single Groove';
  if (n === 'double square') return 'Double Groove';
  return name;
};

const DesignThumbnail = memo(({ design, isSelected, onSelect }) => {
  const bgColor = design.texture_color || "#CCCCCC";
  const thumbUrl = resolveAssetUrl(design.thumbnail_url || design.texture_url || null);
  const isVicstrip = design.product_type === 'vicstrip';
  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        <div
          className={`thumbnail-item ${isSelected ? "selected" : ""}`}
          style={{
            backgroundColor: bgColor,
            backgroundImage: thumbUrl ? `url("${thumbUrl}")` : undefined,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
          onClick={() => onSelect(design)}
          data-testid={`design-thumbnail-${design.id}`}
        />
      </HoverCardTrigger>
      <HoverCardContent side="right" align="start" className="w-72 p-0 overflow-hidden" data-testid={`design-hover-${design.id}`}>
        <div
          className="h-32 w-full"
          style={{
            backgroundColor: bgColor,
            backgroundImage: thumbUrl ? `url("${thumbUrl}")` : undefined,
            backgroundSize: "cover",
            backgroundPosition: "center",
          }}
        />
        <div className="p-4 space-y-2">
          <div className="space-y-1 text-xs">
            {/* Product Code row hidden for Univic Strip per product spec —
                the colour name + pattern + size give enough info there. */}
            {!isVicstrip && (
              <div className="flex justify-between">
                <span className="text-[hsl(215,16%,47%)]">Product Code</span>
                <span className="font-mono font-medium">{design.design_code}</span>
              </div>
            )}
            {isVicstrip && design.color_name && (
              <div className="flex justify-between">
                <span className="text-[hsl(215,16%,47%)]">Color</span>
                <span className="font-medium">{design.color_name}</span>
              </div>
            )}
            {design.category && (
              <div className="flex justify-between">
                <span className="text-[hsl(215,16%,47%)]">Category</span>
                <span className="font-medium">{isVicstrip ? VICSTRIP_DISPLAY_LABEL(design.category) : design.category}</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 pt-2 border-t">
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={async (e) => {
                e.stopPropagation();
                try {
                  await downloadPanelImages({ design, categoryId: design.category_id || (design.category && design.category.toLowerCase().replace(/ /g,'-')) });
                } catch (err) {
                  toast.error('Failed to download panel');
                }
              }}
              data-testid={`download-panel-btn-${design.id}`}
            >
              <Download className="h-4 w-4 mr-1" />
              Download Panel
            </Button>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
});
DesignThumbnail.displayName = "DesignThumbnail";

// Derive the full-quality original PNG path from a thumbnail URL.
// Single canonical folder now (`/static/images/emboss-thumbnails/`), so the
// transform is just: swap `/_thumbcache/` → `/images/`, force the `.png`
// extension, then point at the `_area50` cropped copy used for hover.
// The <img onError> fallback restores the thumbnail if the original 404s.
function getEmbossOriginalUrl(thumbUrl) {
  if (!thumbUrl) return thumbUrl;
  if (!thumbUrl.includes('/_thumbcache/')) return thumbUrl;
  // Split off any query string (e.g. `?v=2` cache-bust) so the regexes can
  // anchor on the file extension; re-attach it after the transform so the
  // hover preview shares the same cache-bust version.
  const [path, query] = thumbUrl.split('?');
  const transformed = path
    .replace('/_thumbcache/', '/images/')
    .replace(/\.jpe?g$/i, '.png')
    .replace(/\.png$/i, '_area50.png');
  return query ? `${transformed}?${query}` : transformed;
}

const EmbossThumbnail = memo(({ pattern, isSelected, onSelect, disabled, panelUrl, downloadFilename }) => {
  // Eagerly prefetch the full-quality hover preview into the browser's HTTP
  // cache so the HoverCard popup paints instantly the moment the user hovers
  // (no spinner, no flash from grid-thumb → original). Fires once per pattern
  // thanks to memo + the thumbnailUrl dep. Skipped when the hover URL is the
  // same as the grid thumb (no separate area50 original — e.g. Signature
  // Ombre patterns that point at /thumbs/*.png directly).
  useEffect(() => {
    if (!pattern.thumbnailUrl) return;
    const hoverUrl = getEmbossOriginalUrl(pattern.thumbnailUrl);
    if (hoverUrl === pattern.thumbnailUrl) return;
    const img = new Image();
    img.decoding = "async";
    img.src = hoverUrl;
  }, [pattern.thumbnailUrl]);

  // Optional panel download (only Color Core Ombre emboss/groove pass a panelUrl).
  // The panel image is the pattern baked onto the currently-selected base
  // colour + overlay, so the URL is computed by the caller, not here.
  const handleDownloadPanel = async (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (!panelUrl) return;
    try {
      const res = await fetch(panelUrl, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = downloadFilename || `UniVicoustic - ${pattern.name}.png`;
      link.href = blobUrl;
      link.click();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
    } catch (err) {
      console.error('[Emboss panel download] failed:', err);
      toast.error('Could not download this panel. Please try again.');
    }
  };

  return (
  <HoverCard openDelay={250} closeDelay={100}>
    <HoverCardTrigger asChild>
      <div
        className={`thumbnail-item emboss-thumbnail ${isSelected && !disabled ? "selected" : ""} ${disabled ? "disabled" : ""}`}
        style={{
          backgroundColor: "#ffffff",
          cursor: disabled ? "default" : "pointer",
          position: "relative",
        }}
        onClick={disabled ? undefined : () => onSelect(pattern)}
        data-testid={`emboss-thumbnail-${pattern.id}`}
      >
        {pattern.thumbnailUrl && (
          <img
            src={pattern.thumbnailUrl}
            alt={pattern.name}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}
        {disabled ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundColor: "rgba(0,0,0,0.52)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
            }}
          >
            <X className="h-4 w-4 text-white/70" />
          </div>
        ) : (
          <div className="emboss-thumbnail-label">
            {pattern.name}
          </div>
        )}
      </div>
    </HoverCardTrigger>
    <HoverCardContent side="right" align="start" className="w-64 p-0 overflow-hidden">
      {pattern.thumbnailUrl ? (
        // Use the full-quality original PNG on hover (not the small _thumbcache
        // JPG that drives the grid tile). The grid keeps the cheap thumb for
        // fast initial render; the hover preview lazy-loads the original so
        // sub-pixel patterns and fine ribbing don't look blurry when upscaled.
        // The grid thumb is reused as a placeholder via the same <img> tag's
        // initial paint while the full-res loads.
        <img
          src={getEmbossOriginalUrl(pattern.thumbnailUrl)}
          alt={pattern.name}
          loading="lazy"
          decoding="async"
          className="w-full aspect-square object-cover"
          style={{ imageRendering: 'auto' }}
          onError={(e) => {
            // Fallback to the thumbnail if the original 404s for any reason.
            if (e.currentTarget.src !== pattern.thumbnailUrl) {
              e.currentTarget.src = pattern.thumbnailUrl;
            }
          }}
        />
      ) : (
        <div className="aspect-square w-full bg-gray-100" />
      )}
      <div className="p-3">
        <p className="font-manrope font-bold text-sm">{pattern.name}</p>
        {panelUrl && (
          <div className="flex items-center gap-2 pt-2 mt-2 border-t">
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={handleDownloadPanel}
              data-testid={`emboss-download-${pattern.id}`}
            >
              <Download className="h-4 w-4 mr-1" />
              Download Panel
            </Button>
          </div>
        )}
      </div>
    </HoverCardContent>
  </HoverCard>
  );
});
EmbossThumbnail.displayName = "EmbossThumbnail";

// ─── HDRI Lighting angle dial ─────────────────────────────────────────────────
// Standalone interactive SVG dial. Angle: 0° = top (12-o'clock), clockwise.
const LightingAngleDial = memo(({ angle, onChange, accentColor }) => {
  const dialRef = useRef(null);
  const draggingRef = useRef(false);
  const SIZE = 76;
  const CX = SIZE / 2;
  const RADIUS = 24;
  const color = accentColor || '#F59E0B';
  const rad = (angle * Math.PI) / 180;
  const indX = CX + Math.sin(rad) * RADIUS;
  const indY = CX - Math.cos(rad) * RADIUS;

  const getAngle = (e) => {
    const rect = dialRef.current.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    return ((90 + Math.atan2(dy, dx) * 180 / Math.PI) + 360) % 360;
  };

  const handleMouseDown = (e) => {
    e.preventDefault();
    draggingRef.current = true;
    onChange(Math.round(getAngle(e)));
    const onMove = (ev) => { if (draggingRef.current) onChange(Math.round(getAngle(ev))); };
    const onUp = () => {
      draggingRef.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <svg
        ref={dialRef}
        width={SIZE}
        height={SIZE}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        onMouseDown={handleMouseDown}
        style={{ cursor: 'crosshair', display: 'block', touchAction: 'none', userSelect: 'none' }}
        aria-label={`Light angle: ${Math.round(angle)} degrees`}
        role="slider"
        aria-valuenow={Math.round(angle)}
        aria-valuemin={0}
        aria-valuemax={359}
      >
        {/* Track ring */}
        <circle cx={CX} cy={CX} r={RADIUS} fill="none" stroke="#E2E8F0" strokeWidth={5} />
        {/* Cardinal tick marks (N/E/S/W) placed just outside the ring */}
        {[0, 90, 180, 270].map((a) => {
          const tr = (a * Math.PI) / 180;
          return (
            <line
              key={a}
              x1={CX + Math.sin(tr) * (RADIUS + 4)} y1={CX - Math.cos(tr) * (RADIUS + 4)}
              x2={CX + Math.sin(tr) * (RADIUS + 8)} y2={CX - Math.cos(tr) * (RADIUS + 8)}
              stroke="#CBD5E1" strokeWidth={1.5} strokeLinecap="round"
            />
          );
        })}
        {/* ↑ north label inside top */}
        <text x={CX} y={CX - RADIUS + 11} textAnchor="middle" fill="#94A3B8" fontSize={7} fontFamily="system-ui,sans-serif">↑</text>
        {/* Spoke from center to indicator */}
        <line x1={CX} y1={CX} x2={indX} y2={indY} stroke={color} strokeWidth={1.5} strokeLinecap="round" opacity={0.45} />
        {/* Center pivot dot */}
        <circle cx={CX} cy={CX} r={2.5} fill={color} opacity={0.35} />
        {/* Indicator dot — sits on the track ring */}
        <circle cx={indX} cy={indY} r={6} fill={color} opacity={0.92} />
        {/* Small highlight inside the indicator dot */}
        <circle cx={indX - Math.sin(rad) * 1.8} cy={indY + Math.cos(rad) * 1.8} r={2} fill="white" opacity={0.45} />
      </svg>
      <span style={{ fontSize: 9, color: '#94A3B8', fontVariantNumeric: 'tabular-nums', letterSpacing: '0.04em' }}>
        {Math.round(angle)}°
      </span>
    </div>
  );
});
LightingAngleDial.displayName = 'LightingAngleDial';

// Maps public URL slugs to internal product IDs
const URL_SLUG_TO_PRODUCT_ID = {
  "bespoke-graphics": "flat-embossed-vmd",
};
const PRODUCT_ID_TO_URL_SLUG = Object.fromEntries(
  Object.entries(URL_SLUG_TO_PRODUCT_ID).map(([slug, id]) => [id, slug])
);

// ── New top-level taxonomy: Flat | Embossed | Grooving ───────────────────────
// Maps each surface type to the product-line IDs that belong there.
const SURFACE_SERIES_MAP = {
  flat:     ['flat-embossed-vmd', 'wood', 'fabrics', 'ombre'],
  embossed: ['flat-embossed-vmd', 'wood', 'fabrics', 'ombre'],
  grooving: ['ombre', 'vicstrip'],
};

// Returns the subset of categories valid for a given surface type + product.
// Pure function — safe to call inside handlers before state updates flush.
function getCategoriesForSurface(categories, surfaceType, productId) {
  if (!surfaceType || !categories?.length) return categories ?? [];
  if (surfaceType === 'flat') {
    if (productId === 'flat-embossed-vmd' || productId === 'wood')
      return categories.filter(c => !c.emboss_available || c.flat_available);
    // ombre: Color Core Ombre stays under Flat (renders as the flat ombre
    // gradient).  Signature Ombre is excluded from Flat — it's embossed-only.
    // This mirrors the Grooving branch below where the same filter applies.
    if (productId === 'ombre')
      return categories.filter(c => c.id === 'ombre-color-core-ombre');
    return categories; // fabrics: all categories visible under Flat
  }
  if (surfaceType === 'embossed') {
    if (productId === 'flat-embossed-vmd' || productId === 'wood' || productId === 'fabrics')
      return categories.filter(c => c.emboss_available);
    return categories; // ombre: both sub-categories
  }
  if (surfaceType === 'grooving') {
    if (productId === 'ombre')
      return categories.filter(c => c.id === 'ombre-color-core-ombre');
    return categories; // vicstrip: no category-level filtering
  }
  return categories;
}

// ── Size filtering by surface type ───────────────────────────────────────────
// Given a category id + surface type, returns either a Set<string> of sizes
// that should be visible in the Size dropdown, or null meaning "no filter
// applies" (e.g. surface is Flat, or the matching pattern set has no
// availableSizes metadata yet, or the category isn't known here).
//
// Driven entirely by each pattern set's `availableSizes` arrays so adding
// restrictions later is a pure data change.  Under Embossed we union the
// emboss patterns for that category; under Grooving we union the groove
// patterns; under Flat we short-circuit to null (Flat has no relief overlay
// so every size is fine).
function getAvailableSizesForSurface(categoryId, surfaceType, patternSets) {
  if (!categoryId || !surfaceType) return null;
  if (surfaceType === 'flat') {
    // Flat-only product rule: Color Core and Designer Textile do not offer
    // the 600-series sizes in their flat variants. Embossed / grooving still
    // get them via the pattern.availableSizes metadata below.
    if (categoryId === 'fabrics-color-core' || categoryId === 'fabrics-designer-textile') {
      return new Set(['1200x2800', '1200x2400']);
    }
    return null; // no emboss/groove restriction on Flat
  }

  const pick = (which) => {
    if (which === 'emboss') {
      if (categoryId === 'fabrics-color-core')       return patternSets.colorCore;
      if (categoryId === 'fabrics-designer-textile') return patternSets.designerTextile;
      if (categoryId === 'ombre-color-core-ombre')   return patternSets.ombreEmboss;
      return patternSets.flatEmbossed; // FE-VMD / wood / other fabrics
    }
    // which === 'groove'
    if (categoryId === 'ombre-color-core-ombre')     return patternSets.ombreGroove;
    return null; // no groove patterns known for this category
  };

  const patterns = pick(surfaceType === 'grooving' ? 'groove' : 'emboss');
  if (!patterns || !patterns.length) return null;

  const union = new Set();
  let anyHasMetadata = false;
  for (const p of patterns) {
    if (Array.isArray(p.availableSizes)) {
      anyHasMetadata = true;
      p.availableSizes.forEach(s => union.add(s));
    }
  }
  // If NO pattern in this set declares availableSizes, we can't filter —
  // signal "no filter" so the caller just shows the full size list.
  return anyHasMetadata ? union : null;
}

// ── Per-category size exclusions ─────────────────────────────────────────────
// Sizes a category does not offer on a given surface, independent of any
// pattern metadata.  getAvailableSizesForSurface above derives its answer from
// the emboss/groove patterns' `availableSizes`; these categories have no such
// metadata (their pattern sets don't declare sizes), so a product-spec rule
// like "Wood Classics isn't made at 1200x2400 when embossed" has nowhere to
// live there and is stated directly here instead.
//
// Keyed by category id → surface → excluded sizes.  Only the listed surface is
// affected: Flat and Grooving keep every size.
const SIZE_EXCLUSIONS_BY_CATEGORY = {
  'wood-wood-classics':     { embossed: ['1200x2400'] },
  'ombre-color-core-ombre': { embossed: ['1200x2400'] },
  'signature-ombre':        { embossed: ['1200x2400'] },
};

function isSizeExcluded(categoryId, surfaceType, size) {
  return Boolean(
    SIZE_EXCLUSIONS_BY_CATEGORY[categoryId]?.[surfaceType]?.includes(size),
  );
}

const Configurator = () => {
  // URL shape: /:surfaceType/:productType — e.g. /flat/bespoke-graphics.
  // Both params are optional so the route tree `/`, `/:surfaceType`, and
  // `/:surfaceType/:productType` all land here; validation happens inside.
  const { surfaceType: surfaceTypeParam, productType: productTypeParam } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  // Whitelist of valid surface tab slugs — used both for URL validation and
  // for mapping to the internal `selectedSurfaceType` state.
  const VALID_SURFACES = ['flat', 'embossed', 'grooving'];

  // Products from API
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showBootOverlay, setShowBootOverlay] = useState(ENABLE_BOOT_WHITE_OVERLAY);
  const [chatOpen, setChatOpen] = useState(false);
  
  // Product type selection
  const [selectedProductType, setSelectedProductType] = useState(null);
  const [selectedCategory, setSelectedCategory] = useState(null);
  // Surface type: new top-level filter (Flat | Embossed | Grooving)
  const [selectedSurfaceType, setSelectedSurfaceType] = useState('flat');

  // ── Per-tab state snapshots ──────────────────────────────────────────────
  // Each surface tab (Flat | Embossed | Grooving) keeps its own configuration
  // so switching tabs restores exactly what the user had there last time,
  // instead of carrying the current tab's series/category/colours/etc. onto
  // the new tab.
  //
  // Starts null for every tab — the first time a tab is visited we fall
  // through to `handleProductTypeChange` (first valid series for that
  // surface) instead of restoring.  On every tab switch we capture the
  // outgoing tab's state into this ref before restoring the incoming one.
  //
  // IMPORTANT: `captureTabState` / `applyTabState` below must list EVERY
  // piece of state that's per-tab.  If a new useState is added that binds to
  // a user selection, add it to both helpers or its value will leak across
  // tabs (or get wiped on tab switch).
  const tabStatesRef = useRef({ flat: null, embossed: null, grooving: null });

  // Generic product state (for non-VicStrip products like VMD, Ombre)
  const [selectedDesign, setSelectedDesign] = useState(null);
  const [selectedSize, setSelectedSize] = useState(null);
  const [selectedDensity, setSelectedDensity] = useState(null);
  const [selectedPattern, setSelectedPattern] = useState(null);
  const [selectedColor, setSelectedColor] = useState(null);
  const [selectedThickness, setSelectedThickness] = useState(null);
  const [selectedEmbossPattern, setSelectedEmbossPattern] = useState(null);
  const [isEmbossed, setIsEmbossed] = useState(false);
  const [showTpatti, setShowTpatti] = useState(true);
  // Wood Perforations specific state
  const [selectedWoodPerfSize, setSelectedWoodPerfSize] = useState(null);
  const [selectedPerforation, setSelectedPerforation] = useState(null);
  // Color Core specific state
  const [selectedColorCoreColor, setSelectedColorCoreColor] = useState(null);
  const [selectedFabricStructure, setSelectedFabricStructure] = useState(null);
  const [selectedColorCoreEmboss, setSelectedColorCoreEmboss] = useState(null);
  // Designer Textile specific state
  const [selectedDTColorGroup, setSelectedDTColorGroup] = useState(null);
  const [selectedDTShade, setSelectedDTShade] = useState(null);
  const [selectedDTFabric, setSelectedDTFabric] = useState(null);
  const [selectedDTSize, setSelectedDTSize] = useState(null);
  const [selectedDTEmboss, setSelectedDTEmboss] = useState(null);
  // Ombre Color Core specific state
  const [selectedOmbreBaseColor, setSelectedOmbreBaseColor] = useState(null);
  const [selectedOmbreOverlay, setSelectedOmbreOverlay] = useState(null);
  const [selectedOmbreEmbossPattern, setSelectedOmbreEmbossPattern] = useState(null);
  const [selectedOmbreGroovePattern, setSelectedOmbreGroovePattern] = useState(null);
  const [ombreFinishType, setOmbreFinishType] = useState("emboss"); // "emboss" | "groove"
  // Signature Ombre real-time 3D configurator state
  const [soBaseColor, setSoBaseColor] = useState('#ffffff');
  // Overlay + emboss start unset — the preview stays blank until the user
  // picks a color.  Once a color is picked the flat ombre gradient renders;
  // once a pattern is picked on top, the embossed version renders.
  const [soOverlayColor, setSoOverlayColor] = useState(null);
  const [soBlend, setSoBlend] = useState(30);
  const [soColorGroup, setSoColorGroup] = useState('Blue');
  const [soLightRotation] = useState(-55 * (Math.PI / 180)); // fixed -55° (CCW from front) since the visual HDRI dial was removed
  const [soSelectedPattern, setSoSelectedPattern] = useState(null);
  const [soPanelImage, setSoPanelImage] = useState(null);
  const [soIsLoading, setSoIsLoading] = useState(false);
  const soEngineRef = useRef(null);
  const soDebounceRef = useRef(null);

  // UI state
  const [favorites, setFavorites] = useState([]);
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  // Inline-rename state for the Saved Configurations list. `renamingId` is the
  // favorite currently being edited (null = none); `renameDraft` holds the
  // in-progress text.
  const [renamingId, setRenamingId] = useState(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [techSpecs, setTechSpecs] = useState(null);
  const [isImageLoading, setIsImageLoading] = useState(false);
  const handleLoadingChange = useCallback((loading) => setIsImageLoading(loading), []);

  // ── Derived: series and categories filtered by selected surface type ─────
  const filteredSeries = useMemo(() => {
    const ids = SURFACE_SERIES_MAP[selectedSurfaceType] ?? [];
    return products.filter(p => p.active && ids.includes(p.id));
  }, [selectedSurfaceType, products]);

  const filteredCategories = useMemo(() =>
    getCategoriesForSurface(
      selectedProductType?.categories ?? [],
      selectedSurfaceType,
      selectedProductType?.id
    ),
    [selectedProductType, selectedSurfaceType]
  );

  // Emboss-first flow: under the Embossed surface tab, the panel grid is
  // gated on having an emboss pattern picked AND filters to only panels
  // that explicitly support that pattern.  Without an emboss selected the
  // grid is empty (UI shows a "pick an emboss" hint instead — see the
  // Print/Designs section JSX).
  const filteredDesigns = useMemo(() => {
    const designs = selectedCategory?.designs ?? [];
    if (selectedSurfaceType === 'embossed') {
      if (!selectedEmbossPattern?.id) return [];
      // Leather is the exception: its emboss compatibility is SIZE-driven
      // (LEATHER_EMBOSS_BY_SIZE), not per-design available_emboss — the emboss
      // selector is already gated by the current size. Filtering prints by
      // available_emboss here wrongly hid prints for size+emboss combos where
      // the size allows an emboss that a print's (stale/incomplete)
      // available_emboss list omits — e.g. `penray`/`deck` (no leather print
      // lists them) or `square_30` (only LH-BR-01 does), which blanked the
      // print grid. So for leather, show every design; size gates the emboss.
      if (selectedCategory?.id === 'vmd-leather') return designs;
      return designs.filter(d =>
        d.available_emboss?.includes(selectedEmbossPattern.id)
      );
    }
    return designs;
  }, [selectedCategory, selectedSurfaceType, selectedEmbossPattern?.id]);

  // ── Sizes visible in each size dropdown for the current surface tab ───────
  // Wraps getAvailableSizesForSurface so the component doesn't hand-wire each
  // pattern set.  Returns a Set<string> of allowed size ids, or null meaning
  // "no restriction — show every size".  Individual size selectors below use
  // `isSizeAllowedForSurface(sizeId)` to gate each SelectItem.
  const availableSizesForSurface = useMemo(
    () => getAvailableSizesForSurface(selectedCategory?.id, selectedSurfaceType, {
      colorCore:       COLOR_CORE_EMBOSS_PATTERNS,
      designerTextile: DESIGNER_TEXTILE_EMBOSS_PATTERNS,
      ombreEmboss:     OMBRE_COLOR_CORE_EMBOSS_PATTERNS,
      ombreGroove:     OMBRE_COLOR_CORE_GROOVE_PATTERNS,
      flatEmbossed:    FLAT_EMBOSSED_EMBOSS_PATTERNS,
    }),
    [selectedCategory, selectedSurfaceType]
  );
  const isSizeAllowedForSurface = useCallback(
    (size) => {
      // Category-level exclusions win outright — they're a product-spec fact,
      // not something the pattern metadata can express.
      if (isSizeExcluded(selectedCategory?.id, selectedSurfaceType, size)) return false;
      return availableSizesForSurface == null || availableSizesForSurface.has(size);
    },
    [availableSizesForSurface, selectedCategory?.id, selectedSurfaceType]
  );

  // Clear the currently-selected size when a surface / category change makes
  // it invalid (e.g. user switches from Grooving→Embossed while the size was
  // a groove-only size).  Shouldn't fire in practice with the tab-snapshot
  // machinery, but guards against it leaking.  Covers both selectedSize (most
  // products) and selectedDTSize (Designer Textile's separate state).
  // Goes through isSizeAllowedForSurface rather than the pattern-derived set
  // alone, so a category-level exclusion clears the selection too — e.g.
  // switching to Embossed on Wood Classics while 1200x2400 is selected.
  useEffect(() => {
    if (selectedSize && !isSizeAllowedForSurface(selectedSize)) {
      setSelectedSize(null);
    }
    if (selectedDTSize && !isSizeAllowedForSurface(selectedDTSize)) {
      setSelectedDTSize(null);
    }
  }, [isSizeAllowedForSurface, selectedSize, selectedDTSize]);

  // Thickness gates emboss: a pattern excluded at the chosen thickness (today
  // only Alter Flute, which is 12mm-only) is filtered out of the emboss grid
  // entirely.  Hiding the tile isn't enough on its own — the user can pick
  // Alter Flute first and change thickness afterwards, which would leave an
  // unbuildable pattern selected with no tile on screen to deselect it.  So we
  // clear it here instead of at each thickness dropdown.  Watching both values
  // rather than patching the selector covers every route into either one: the
  // thickness dropdown, a restored tab snapshot or favourite (which carry a
  // thickness), and a deep link (which carries only the emboss, landing on
  // whatever thickness is already selected).
  useEffect(() => {
    if (!selectedThickness) return;
    const ccStale = !isEmbossAvailableForThickness(selectedColorCoreEmboss, selectedThickness);
    const dtStale = !isEmbossAvailableForThickness(selectedDTEmboss, selectedThickness);
    if (!ccStale && !dtStale) return;
    const name = (ccStale ? selectedColorCoreEmboss : selectedDTEmboss).name;
    if (ccStale) setSelectedColorCoreEmboss(null);
    if (dtStale) setSelectedDTEmboss(null);
    toast.info(`${name} isn't available in ${selectedThickness} — emboss cleared`);
  }, [selectedThickness, selectedColorCoreEmboss, selectedDTEmboss]);

  // Size gates emboss for fabric the same way LEATHER_EMBOSS_BY_SIZE does for
  // leather: the 3D patterns are 1200x2800-only and the mosaic patterns
  // 1200x2400-only, so a size can strand a selected pattern with no tile left
  // on screen to deselect it.  The size dropdowns already clear the emboss on a
  // manual change; this covers the routes they don't — a restored tab snapshot,
  // a saved favourite, a deep link.  Silent, matching the leather guard.
  useEffect(() => {
    if (
      selectedColorCoreEmboss && selectedSize &&
      !selectedColorCoreEmboss.availableSizes?.includes(selectedSize)
    ) {
      setSelectedColorCoreEmboss(null);
    }
    if (
      selectedDTEmboss && selectedDTSize &&
      !selectedDTEmboss.availableSizes?.includes(selectedDTSize)
    ) {
      setSelectedDTEmboss(null);
    }
  }, [selectedSize, selectedDTSize, selectedColorCoreEmboss, selectedDTEmboss]);

  // Keep ombreFinishType in lock-step with the surface tab.  The on-screen
  // Emboss|Groove toggle was removed (the surface tab dictates the mode), but
  // a few places still read ombreFinishType so we keep it coherent here
  // instead of hunting every read site.  Also clears the opposite-type
  // pattern selection so a stale groove pattern can't leak into Embossed
  // rendering and vice versa.
  useEffect(() => {
    if (selectedProductType?.id !== 'ombre') return;
    if (selectedSurfaceType === 'embossed' && ombreFinishType !== 'emboss') {
      setOmbreFinishType('emboss');
      setSelectedOmbreGroovePattern(null);
    } else if (selectedSurfaceType === 'grooving' && ombreFinishType !== 'groove') {
      setOmbreFinishType('groove');
      setSelectedOmbreEmbossPattern(null);
    }
  }, [selectedSurfaceType, selectedProductType?.id, ombreFinishType]);

  // ── True when the user has filled every visible required field. Defaults
  //    (Blend, Studio Lighting, base white in Signature Ombre) count as filled
  //    since they're pre-populated; T-Profile toggle is always optional.
  //    Under Embossed surface, the emboss/pattern selection is required for
  //    every category that has one. Under Grooving (Color Core Ombre only),
  //    the groove pattern is required.
  const isConfigComplete = useMemo(() => {
    if (!selectedProductType) return false;
    const id = selectedProductType.id;
    const needsSize  = (selectedProductType.sizes?.length ?? 0) > 0;
    const needsThick = (selectedProductType.thicknesses?.length ?? 0) > 0;
    const requiresEmboss = selectedSurfaceType === 'embossed';
    const requiresGroove = selectedSurfaceType === 'grooving';

    if (id === "vicstrip") {
      // VicStrip has no emboss step.
      return !!(selectedPattern && selectedDesign && selectedSize && selectedThickness);
    }

    if (id === "ombre") {
      if (!selectedCategory) return false;
      if (selectedCategory.id === "signature-ombre") {
        // Base is fixed white, Blend has a default. Required: size + thickness
        // + overlay colour, plus the 3D pattern when on the Embossed tab.
        return !!(
          (!needsSize || selectedSize) &&
          (!needsThick || selectedThickness) &&
          soOverlayColor &&
          (!requiresEmboss || soSelectedPattern)
        );
      }
      // Color Core Ombre — base + overlay + size + thickness, plus the
      // surface-tied finish pattern (emboss/groove). Flat is a colour-gradient
      // only product so no finish pattern is required there.
      const base = !!(selectedOmbreBaseColor && selectedOmbreOverlay);
      const sizeAndThick = (!needsSize || !!selectedSize) && (!needsThick || !!selectedThickness);
      const finishOk =
        requiresEmboss ? !!selectedOmbreEmbossPattern :
        requiresGroove ? !!selectedOmbreGroovePattern :
        true;
      return base && sizeAndThick && finishOk;
    }

    if (id === "flat-embossed-vmd" || id === "wood") {
      if (!selectedCategory) return false;
      if (selectedCategory.id === "wood-perforations") {
        // Wood Perforations: size + design + thickness + the perforation pattern
        // (defaults to the first valid pattern on entry, so this is effectively
        // always filled — included here for correctness).
        return !!(
          selectedWoodPerfSize &&
          selectedDesign &&
          selectedPerforation &&
          (!needsThick || !!selectedThickness)
        );
      }
      // Generic Bespoke Graphics / Wood Classics — design + size + thickness,
      // plus an emboss pattern under the Embossed tab.
      return !!(
        selectedDesign &&
        (!needsSize || !!selectedSize) &&
        (!needsThick || !!selectedThickness) &&
        (!requiresEmboss || selectedEmbossPattern)
      );
    }

    if (id === "fabrics") {
      if (!selectedCategory) return false;
      if (selectedCategory.id === "fabrics-color-core") {
        return !!(
          selectedColorCoreColor &&
          selectedFabricStructure &&
          selectedSize &&
          (!needsThick || selectedThickness) &&
          (!requiresEmboss || selectedColorCoreEmboss)
        );
      }
      if (selectedCategory.id === "fabrics-designer-textile") {
        return !!(
          selectedDTShade &&
          selectedDTFabric &&
          selectedDTSize &&
          selectedThickness &&
          (!requiresEmboss || selectedDTEmboss)
        );
      }
      return !!(
        selectedDesign &&
        (!needsSize || !!selectedSize) &&
        (!needsThick || !!selectedThickness) &&
        (!requiresEmboss || selectedEmbossPattern)
      );
    }

    // Generic fallback
    return !!(
      selectedCategory && selectedDesign &&
      (!needsSize || !!selectedSize) &&
      (!needsThick || !!selectedThickness) &&
      (!requiresEmboss || selectedEmbossPattern)
    );
  }, [
    selectedProductType, selectedSurfaceType, selectedPattern, selectedDesign, selectedCategory,
    selectedSize, selectedThickness, selectedDTSize,
    selectedWoodPerfSize, selectedPerforation,
    selectedColorCoreColor, selectedFabricStructure, selectedColorCoreEmboss,
    selectedDTShade, selectedDTFabric, selectedDTEmboss,
    selectedOmbreBaseColor, selectedOmbreOverlay,
    selectedOmbreEmbossPattern, selectedOmbreGroovePattern,
    selectedEmbossPattern, soOverlayColor, soSelectedPattern,
  ]);

  // Designer Textile — Blob URL panel manager (exactly 1 full-res image in memory)
  // When an emboss pattern is selected, the pre-rendered emboss composite replaces the base panel.
  const isDTActive = selectedCategory?.id === "fabrics-designer-textile";
  const dtPanelUrl = isDTActive
    ? (selectedDTEmboss && selectedDTFabric?.id && selectedDTShade?.id
        ? getDesignerTextileEmbossUrl(selectedDTFabric.id, selectedDTEmboss.id, selectedDTShade.id, selectedDTEmboss.filenameSuffix)
        : (selectedDTFabric?.id && selectedDTShade?.id
            ? `${ASSETS_URL}/static/images/fabric/designer_textile/panels/${selectedDTFabric.id}_${selectedDTShade.id}.jpg`
            : null))
    : null;
  const { blobUrl: dtPanelBlobUrl, isLoading: dtPanelLoading } = useBlobPanel(dtPanelUrl);

  // Ombre — Blob URL panel manager (exactly 1 full-res image in memory)
  const isOmbreActive = selectedProductType?.id === "ombre";
  const ombrePanelUrl = isOmbreActive && selectedOmbreBaseColor && selectedOmbreOverlay
    ? getOmbreColorCorePanelUrl(selectedOmbreBaseColor.id, selectedOmbreOverlay.filename)
    : null;
  const { blobUrl: ombrePanelBlobUrl, isLoading: ombrePanelLoading } = useBlobPanel(ombrePanelUrl);

  // Color Core — Blob URL panel manager (exactly 1 full-res image in memory)
  const isCCActive = selectedCategory?.id === "fabrics-color-core";
  const ccPanelUrl = (isCCActive && selectedColorCoreColor && selectedFabricStructure)
    ? (selectedColorCoreEmboss
        ? getColorCoreEmbossUrl(
            selectedFabricStructure.id,
            selectedColorCoreEmboss.id,
            selectedColorCoreColor.id
          )
        : getColorCorePanelUrl(
            selectedFabricStructure.id,
            selectedColorCoreColor.id
          ))
    : null;
  const { blobUrl: ccPanelBlobUrl, isLoading: ccPanelLoading } = useBlobPanel(ccPanelUrl);

  // FVP single panel — flat-embossed, wood, non-CC/DT fabrics (non-continuous design)
  const fvpSingleUrl = (
    selectedProductType?.id !== "ombre" &&
    selectedProductType?.id !== "vicstrip" &&
    selectedCategory?.id !== "fabrics-color-core" &&
    selectedCategory?.id !== "fabrics-designer-textile" &&
    selectedDesign?.panel_variant !== "continuous"
  ) ? resolveAssetUrl(
      selectedDesign?.texture_url ||
      (selectedDesign?.design_code && selectedCategory?.id
        ? getFlatEmbossedPanelPath(selectedCategory.id, selectedDesign.design_code)
        : null)
    ) : null;
  const { blobUrl: fvpSingleBlobUrl, isLoading: fvpSingleLoading } = useBlobPanel(fvpSingleUrl);

  // FVP continuous panels — array of 3 slice URLs (e.g. marble)
  const fvpContinuousUrls = (
    selectedProductType?.id !== "ombre" &&
    selectedCategory?.id !== "fabrics-color-core" &&
    selectedCategory?.id !== "fabrics-designer-textile" &&
    selectedDesign?.panel_variant === "continuous" &&
    selectedDesign?.texture_urls?.length
  ) ? selectedDesign.texture_urls.map((u) => resolveAssetUrl(u)) : null;
  const { blobUrls: fvpContinuousBlobUrls, isLoading: fvpContinuousLoading } = useMultiBlobPanels(fvpContinuousUrls);

  // FVP emboss overlay (flat-embossed-vmt emboss patterns, not DT/wood-perf/ombre)
  const fvpEmbossUrl = (
    selectedEmbossPattern &&
    selectedDesign?.design_code &&
    selectedCategory?.id !== "fabrics-color-core" &&
    selectedCategory?.id !== "fabrics-designer-textile" &&
    selectedCategory?.id !== "wood-perforations" &&
    selectedProductType?.id !== "ombre"
  ) ? resolveAssetUrl(`/static/images/flat-embossed-vmt/emboss/${selectedDesign.design_code}/${selectedEmbossPattern.id}.png`)
    : null;
  const { blobUrl: fvpEmbossBlobUrl } = useBlobPanel(fvpEmbossUrl);

  // Wood perforation overlay
  const woodPerfEmbossUrl = selectedCategory?.id === "wood-perforations"
    ? (selectedPerforation?.url ?? null)
    : null;
  const { blobUrl: woodPerfEmbossBlobUrl } = useBlobPanel(woodPerfEmbossUrl);

  // Ombre emboss or groove overlay (mutually exclusive — emboss takes priority)
  const ombreEmbossUrl = isOmbreActive && selectedOmbreBaseColor && selectedOmbreOverlay
    ? selectedOmbreEmbossPattern
        ? getOmbreEmbossPanelUrl(selectedOmbreEmbossPattern, selectedOmbreOverlay.filename)
        : selectedOmbreGroovePattern
          ? getOmbreGroovePanelUrl(selectedOmbreGroovePattern, selectedOmbreOverlay.filename)
          : null
    : null;
  const { blobUrl: ombreEmbossBlobUrl } = useBlobPanel(ombreEmbossUrl);

  // VicStrip panel texture
  const vicstripUrl = (selectedProductType?.id === "vicstrip" && selectedPattern?.id && selectedDesign?.color?.id)
    ? getImagePath(selectedPattern.id, selectedDesign.color.id)
    : null;
  const { blobUrl: vicstripBlobUrl, isLoading: vicstripLoading } = useBlobPanel(vicstripUrl);

  // CanvasPreview texture (generic products not handled by specialised renderers)
  const isCanvasPreviewActive = (
    selectedProductType &&
    selectedProductType.id !== "flat-embossed-vmd" &&
    selectedProductType.id !== "wood" &&
    selectedProductType.id !== "fabrics" &&
    selectedProductType.id !== "ombre" &&
    selectedProductType.id !== "vicstrip"
  );
  const canvasPreviewUrl = isCanvasPreviewActive ? resolveAssetUrl(selectedDesign?.texture_url) : null;
  const { blobUrl: canvasBlobUrl } = useBlobPanel(canvasPreviewUrl);

  const canvasRef = useRef(null);

  // ── Auth state — drives the header (Sign in vs logged-in dropdown). ──
  // Reads from localStorage on mount and re-reads whenever the auth client
  // dispatches a change (login / logout / cross-tab update). Falls back to
  // null when logged out.
  const [authUser, setAuthUser] = useState(() => getUser());
  useEffect(() => {
    const unsubscribe = onAuthChange((next) => setAuthUser(next?.user ?? null));
    return unsubscribe;
  }, []);

  // ── Auto-detect new deploy and offer one-click reload ─────────────────────
  // Customers often keep the configurator tab open for long sessions and
  // never re-fetch index.html on their own — so after a deploy they're stuck
  // on the old bundle until they hard-refresh.  This effect compares the
  // currently-loaded bundle hash against the hash advertised by the live
  // index.html and shows a persistent reload toast when they diverge.
  //
  // Previously this used a setInterval(every 5 min).  That contributed to a
  // multi-second freeze when users returned to a backgrounded tab: Chrome
  // freezes inactive tabs after ~5 min, and on unfreeze the queued timer
  // plus the focus listener plus React's flush all fire at once, producing
  // a visible main-thread stall.  We now poll only on (a) initial mount
  // (after a 10s warm-up) and (b) when the tab becomes visible/focused.
  // A single in-flight guard prevents focus + visibilitychange from racing.
  useEffect(() => {
    const initialBundle = (
      document.querySelector('script[src*="static/js/main"]')?.getAttribute('src') || ''
    ).match(/main\.[a-f0-9]+\.js/)?.[0];
    if (!initialBundle) return;

    let notified = false;
    let inFlight = false;
    const check = async () => {
      if (notified || inFlight) return;
      inFlight = true;
      try {
        // Cache-buster query param sidesteps any intermediate CDN that
        // ignores the no-cache header on index.html.
        const res = await fetch(`/index.html?_v=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return;
        const text = await res.text();
        const latest = text.match(/main\.[a-f0-9]+\.js/)?.[0];
        if (!latest || latest === initialBundle) return;
        notified = true;
        toast("A new version is available", {
          description: "Reload to get the latest updates.",
          action: { label: "Reload", onClick: () => window.location.reload() },
          duration: Infinity,
        });
      } catch (_) {
        // Network blip — try again next focus/visibility event.
      } finally {
        inFlight = false;
      }
    };

    // Yield one frame after a focus/visibility transition so the browser can
    // finish the post-unfreeze paint before we start fetching/parsing.  This
    // is Fix 2 — smoothing the unfreeze instead of slamming the main thread.
    const deferredCheck = () => {
      requestAnimationFrame(() => check());
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') deferredCheck();
    };
    const onFocus = () => deferredCheck();

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    // First check ~10 s after mount, so a tab opened just before a deploy
    // catches the new bundle quickly without spamming on initial render.
    const initId = setTimeout(() => check(), 10_000);

    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
      clearTimeout(initId);
    };
  }, []);

  // Diagnostic: long-task logging.  Captures any task that blocks the main
  // thread for >50ms (the Long Tasks API threshold) and logs the duration
  // to the console.  Useful for correlating user-visible freezes with the
  // code path that caused them.  No-op in browsers without the API.
  useEffect(() => {
    // Off unless uv_debug is set — otherwise we'd run a PerformanceObserver +
    // console.warn for every long task, in dev and prod alike.
    if (!RENDER_DEBUG) return;
    if (typeof PerformanceObserver === 'undefined') return;
    if (!PerformanceObserver.supportedEntryTypes?.includes('longtask')) return;
    const obs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        // eslint-disable-next-line no-console
        console.warn(`[longtask] ${entry.duration.toFixed(0)}ms`, entry);
      }
    });
    try { obs.observe({ entryTypes: ['longtask'] }); } catch (_) {}
    return () => obs.disconnect();
  }, []);

  // ── Request-a-Sample modal state ──────────────────────────────────────────
  // Opens a form dialog prefilled with the current configurator state plus
  // user-info fields. On submit, POSTs to a Google Apps Script Web App URL
  // (configured via REACT_APP_SAMPLE_REQUEST_URL env var) which appends a
  // row to the linked Google Sheet.
  const [requestSampleOpen, setRequestSampleOpen] = useState(false);
  const [reqSampleSubmitting, setReqSampleSubmitting] = useState(false);
  const [reqSampleForm, setReqSampleForm] = useState({
    name: "",
    email: "",
    region: "",
    quantity: 1,
    sampleSize: "A4",
  });
  // Prefill the email from the logged-in user the first time the modal opens
  // for this session. User can still edit it.
  useEffect(() => {
    if (requestSampleOpen && authUser?.email && !reqSampleForm.email) {
      setReqSampleForm((f) => ({ ...f, email: authUser.email }));
    }
  }, [requestSampleOpen, authUser, reqSampleForm.email]);

  const handleRequestSampleSubmit = async (e) => {
    e.preventDefault();
    if (reqSampleSubmitting) return;

    // Build a key->value map of every entry shown in the live config summary.
    // The Sheet stores this as a single JSON column so we never have to
    // migrate columns when a new product type adds new fields.
    const details = {};
    configSummary.forEach(({ label, value, color }) => {
      details[label] = color ? `${value} (${color})` : value;
    });
    // Human-readable one-liner for the sheet (skip Series/Category which get
    // their own columns).
    const summary = configSummary
      .filter((entry) => entry.label !== "Series" && entry.label !== "Category")
      .map((entry) => `${entry.label}: ${entry.value}`)
      .join(" · ");

    const payload = {
      name: reqSampleForm.name.trim(),
      email: reqSampleForm.email.trim(),
      region: reqSampleForm.region,
      quantity: reqSampleForm.quantity,
      sampleSize: reqSampleForm.sampleSize,
      series: details["Series"] || "",
      category: details["Category"] || "",
      summary,
      details,
      submittedAt: new Date().toISOString(),
      userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    };

    const url = process.env.REACT_APP_SAMPLE_REQUEST_URL;
    if (!url) {
      // Env var unset — log loudly so misconfigured deploys are obvious, but
      // still close the modal so the user isn't blocked.
      console.warn("[RequestSample] REACT_APP_SAMPLE_REQUEST_URL is not set — request not sent. Payload was:", payload);
      toast.error("Sample request endpoint is not configured. Contact the site admin.");
      return;
    }

    setReqSampleSubmitting(true);
    try {
      // mode:'no-cors' because Apps Script Web Apps redirect through
      // script.googleusercontent.com which trips CORS. The request still
      // reaches the server and the row is appended; we just can't read
      // the response body.
      await fetch(url, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload),
      });
      // Treated as a conversion in the Brevo journey, so it fires only on a
      // successful submit — never on open or on a failed POST.  Note the
      // no-cors mode above means we can't read the response; "successful"
      // here means the request left the browser without throwing.
      track("sample_requested", {
        ...analyticsSnap(),
        region: payload.region,
        quantity: payload.quantity,
        sample_size: payload.sampleSize,
      });
      toast.success("Sample request submitted — we'll be in touch soon.");
      setRequestSampleOpen(false);
      // Reset the user-info fields; configSummary stays in sync with the
      // live configurator on its own.
      setReqSampleForm({
        name: "",
        email: authUser?.email || "",
        region: "",
        quantity: 1,
        sampleSize: "A4",
      });
    } catch (err) {
      console.error("[RequestSample] submission failed:", err);
      toast.error("Couldn't submit your request. Please try again.");
    } finally {
      setReqSampleSubmitting(false);
    }
  };
  const handleLogout = () => {
    logout();
    toast.success("Signed out.");
  };

  // ── Analytics snapshot — every "outcome" event (Save / Download / Compare /
  // TechSpecs) and most input events ride along with the user's full current
  // configuration so the dashboard can slice by any dimension (PRD 4.6).
  // Defined as a closure (no useCallback) — recomputed cheaply on each call.
  const analyticsSnap = () => ({
    surface: selectedSurfaceType,
    product_type: selectedProductType?.id,
    product_type_name: selectedProductType?.name,
    category: selectedCategory?.id,
    category_name: selectedCategory?.name,
    design_code: selectedDesign?.design_code,
    size: selectedSize,
    thickness: selectedThickness,
    emboss_pattern:
      selectedColorCoreEmboss?.id ||
      selectedDTEmboss?.id ||
      selectedEmbossPattern?.id ||
      soSelectedPattern ||
      selectedOmbreEmbossPattern?.id ||
      null,
  });

  const [zoomLevel, setZoomLevel] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const panStartRef = useRef({ x: 0, y: 0 });
  // rAF throttle for pan — mousemove fires 60–120+ Hz and each setPanOffset
  // re-renders the whole Configurator.  Coalesce to one state update per frame.
  const panRafRef = useRef(null);
  const panLatestRef = useRef(null);
  const [hdriLighting, setHdriLighting] = useState('none'); // 'none' | 'warm' | 'soft'
  const [lightAngle, setLightAngle] = useState(40); // degrees: 0=top, 90=right, 180=bottom, 270=left
  // Mobile: hide the "View Preview" FAB once the canvas is on-screen.
  const [canvasInView, setCanvasInView] = useState(false);
  useEffect(() => {
    const canvas = document.querySelector('[data-testid="canvas-area"]');
    if (!canvas || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(
      ([entry]) => setCanvasInView(entry.isIntersecting),
      { threshold: 0.3 }
    );
    obs.observe(canvas);
    return () => obs.disconnect();
  }, []);
  const ZOOM_STEP = 0.50;
  const ZOOM_MIN = 1.0;
  // Ombre uses a lower max because its panels stretch dramatically when
  // scaled up, but Signature Ombre paints to a real canvas with proper
  // resolution — it can comfortably zoom to 10x like every other product.
  const ZOOM_MAX =
    selectedProductType?.id === "ombre" && selectedCategory?.id !== "signature-ombre"
      ? 1.5
      : 10.0;
  const zoomIn = () => setZoomLevel(prev => {
    const next = Math.min(parseFloat((prev + ZOOM_STEP).toFixed(2)), ZOOM_MAX);
    if (next !== prev) track("zoom_in", { from: prev, to: next });
    return next;
  });
  const zoomOut = () => setZoomLevel(prev => {
    const next = Math.max(parseFloat((prev - ZOOM_STEP).toFixed(2)), ZOOM_MIN);
    if (next !== prev) track("zoom_out", { from: prev, to: next });
    return next;
  });

  // ── Custom zoom % inputter ──────────────────────────────────────────────────
  // Click the % readout → it becomes an editable input. Enter/blur commits the
  // value clamped to [ZOOM_MIN, ZOOM_MAX]; Escape cancels.  Width is held by
  // the same wrapping div so the surrounding +/- buttons don't shift.
  const [isEditingZoom, setIsEditingZoom] = useState(false);
  const [zoomInputValue, setZoomInputValue] = useState("");
  const zoomInputRef = useRef(null);
  const beginEditZoom = () => {
    setZoomInputValue(String(Math.round(zoomLevel * 100)));
    setIsEditingZoom(true);
  };
  const commitZoomInput = () => {
    const parsed = parseFloat(zoomInputValue);
    if (Number.isFinite(parsed)) {
      const clamped = Math.min(Math.max(parsed / 100, ZOOM_MIN), ZOOM_MAX);
      setZoomLevel(parseFloat(clamped.toFixed(2)));
    }
    setIsEditingZoom(false);
  };
  const cancelZoomInput = () => setIsEditingZoom(false);
  // Auto-focus + select-all the moment the inputter appears, so the user can
  // just start typing.
  useEffect(() => {
    if (isEditingZoom && zoomInputRef.current) {
      zoomInputRef.current.focus();
      zoomInputRef.current.select();
    }
  }, [isEditingZoom]);

  // Reset pan when zoom returns to 1
  useEffect(() => {
    if (zoomLevel === 1) setPanOffset({ x: 0, y: 0 });
  }, [zoomLevel]);

  const handlePanStart = useCallback((e) => {
    if (zoomLevel <= 1) return;
    isDraggingRef.current = true;
    setIsDragging(true);
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    panStartRef.current = { x: panOffset.x, y: panOffset.y };
  }, [zoomLevel, panOffset]);

  const handlePanMove = useCallback((e) => {
    if (!isDraggingRef.current) return;
    // Capture coords now; commit at most once per animation frame so a fast
    // mouse doesn't trigger a full re-render on every pointer event.
    panLatestRef.current = { x: e.clientX, y: e.clientY };
    if (panRafRef.current != null) return;
    panRafRef.current = requestAnimationFrame(() => {
      panRafRef.current = null;
      const p = panLatestRef.current;
      if (!p) return;
      const dx = p.x - dragStartRef.current.x;
      const dy = p.y - dragStartRef.current.y;
      setPanOffset({ x: panStartRef.current.x + dx, y: panStartRef.current.y + dy });
    });
  }, []);

  const handlePanEnd = useCallback(() => {
    isDraggingRef.current = false;
    setIsDragging(false);
    if (panRafRef.current != null) {
      cancelAnimationFrame(panRafRef.current);
      panRafRef.current = null;
    }
    panLatestRef.current = null;
  }, []);

  // ── Magnifier loupe ───────────────────────────────────────────────────────
  // Uses cloneNode(true) + CSS transform — fully synchronous, zero canvas rendering.
  // The clone is placed inside the circular lens div (overflow:hidden) and
  // repositioned on every mousemove via direct DOM style mutations (no React state).
  const magnifierRef = useRef(null);   // outer preview container
  const magnifierDivRef = useRef(null); // the lens circle (always in DOM)
  const lensCloneRef = useRef(null);    // cloned preview inside lens
  // rAF throttle for lens-follows-cursor updates. Mousemove fires 60-120 Hz
  // and each tick does a getBoundingClientRect() + DOM style mutations which
  // are synchronous layout work.  We coalesce to one update per frame.
  const lensRafRef = useRef(null);
  const lensMouseRef = useRef(null);
  const lensRectRef = useRef(null); // cached bounding rect, refreshed on enter
  const [magnifierActive, setMagnifierActive] = useState(false);
  // User-controlled toggle for the whole magnifier feature.  Persisted to
  // localStorage so the preference sticks across page loads.  Defaults to ON
  // (preserves the prior always-active behaviour for users who haven't
  // touched the toggle).
  const [magnifierEnabled, setMagnifierEnabled] = useState(() => {
    try {
      const stored = localStorage.getItem("uv_magnifier_enabled");
      return stored === null ? true : stored === "true";
    } catch (_) {
      return true;
    }
  });
  useEffect(() => {
    try { localStorage.setItem("uv_magnifier_enabled", String(magnifierEnabled)); } catch (_) {}
  }, [magnifierEnabled]);
  const MAGNIFIER_SIZE = 200;
  // Leather, Wood Perforations, and Fabrics (Color Core / Designer Textile /
  // Modern Corporate) all have fine micro-detail that benefits from a stronger
  // loupe than the default 2.5x — bump to 7x (700%) for those.
  const MAGNIFIER_ZOOM = (
    selectedProductType?.id === "ombre" && selectedSurfaceType === "grooving"
  ) ? 2.0
    : (
      selectedCategory?.id === "vmd-leather" ||
      selectedCategory?.id === "wood-perforations" ||
      selectedProductType?.id === "fabrics"
    ) ? 7.0 : 2.5;

  // ── Compare slider state ────────────────────────────────────────────────
  // Session-local A/B comparison.  Flow:
  //   1. User clicks "Compare" in the header → compareMode=true, sidebar
  //      stays active so they can configure each slot freely.
  //   2. Two slot tiles appear over the preview.  Clicking a slot captures
  //      a PNG of the currently-rendered preview + a text label.
  //   3. Once both slots are filled, "Apply" turns on compareApplied —
  //      live preview is replaced by the two captured images with a
  //      vertical draggable divider; the slider position is sliderPos% from
  //      the left edge, with Slot A visible on the left and Slot B on the
  //      right.
  //   4. Clicking the × on the slider exits compare mode entirely.
  const [compareMode, setCompareMode] = useState(false);
  const [compareSlots, setCompareSlots] = useState([null, null]); // each: { imageUrl, label }
  const [compareApplied, setCompareApplied] = useState(false);
  // Slider position is kept in a ref (NOT React state) so dragging doesn't
  // re-render the entire Configurator on every pointermove — that was the
  // source of the observable lag.  The divider/handle/clip-path elements get
  // their styles mutated directly via refs while dragging, and the ref is
  // also what we read if we ever need the current position for logic.
  const sliderPosRef = useRef(50);
  const sliderContainerRef = useRef(null);
  const sliderDividerRef = useRef(null);
  const sliderHandleRef = useRef(null);
  const sliderImgBRef = useRef(null);
  // Points at the zoom-wrapper div — the node that contains ONLY the live
  // preview (wall + furniture).  captureSlot uses this instead of
  // magnifierRef so the slot-tile overlay and the slider overlay (both
  // siblings of the zoom wrapper) don't get burned into the captured PNG.
  const previewContentRef = useRef(null);

  // Build a human-readable label from the current state — shows under each
  // slot so the user remembers which is which.  Short: "Surface • Series •
  // Category" truncated.
  const buildCompareLabel = useCallback(() => {
    const parts = [];
    if (selectedSurfaceType) parts.push(selectedSurfaceType.charAt(0).toUpperCase() + selectedSurfaceType.slice(1));
    if (selectedProductType?.name) parts.push(selectedProductType.name);
    if (selectedCategory?.name) parts.push(selectedCategory.name);
    return parts.join(' • ') || 'Current view';
  }, [selectedSurfaceType, selectedProductType, selectedCategory]);

  // Capture the currently-rendered preview area as a PNG data URL, then store
  // it in the given slot.  Uses html-to-image the same way FlatEmbossedPreview
  // does its Download — skipFonts silences cross-origin font-walk errors.
  //
  // Pre-step: convert every <img> in the capture area to a PNG data URL via
  // canvas.drawImage, then temporarily swap its src.  Reason: html-to-image
  // embeds images as base64 inside an SVG and rasterises the SVG to canvas,
  // and WebP inside <svg><image> is unreliable across browsers — capture
  // ends up with a transparent hole where the WebP-sourced furniture should
  // be.  Drawing the already-decoded <img> to a 2D canvas, then exporting as
  // PNG, gives html-to-image a format it can always embed.  Original srcs
  // are restored in `finally` so normal display continues to use WebP.
  const captureSlot = useCallback(async (slotIndex) => {
    const node = previewContentRef.current;
    if (!node) return;

    const imgs = Array.from(node.querySelectorAll('img'));
    const originalSrcs = imgs.map(img => img.getAttribute('src'));

    // Convert one image to a PNG data URL, scaled down so the resulting
    // base64 stays small enough for the browser to embed inside an SVG
    // (very large data URLs are silently dropped during SVG rasterisation,
    // which was leaving the 3000×3000 furniture missing from the capture).
    //   1. Try the live <img> via canvas.drawImage — fastest, no network.
    //   2. If that taints the canvas (cached without CORS, etc.), re-fetch
    //      the URL with a fresh crossOrigin="anonymous" <Image> so the
    //      browser performs a CORS-aware request and the canvas stays clean.
    // Returns the PNG data URL or `null` if everything fails.
    const CAPTURE_MAX_DIM = 1000;
    const drawScaledToPng = (src, label) => {
      const w = src.naturalWidth, h = src.naturalHeight;
      if (!w || !h) return null;
      const scale = Math.min(1, CAPTURE_MAX_DIM / Math.max(w, h));
      const cw = Math.max(1, Math.round(w * scale));
      const ch = Math.max(1, Math.round(h * scale));
      const c = document.createElement('canvas');
      c.width = cw;
      c.height = ch;
      c.getContext('2d').drawImage(src, 0, 0, cw, ch);
      const dataUrl = c.toDataURL('image/png');
      console.log(`[Compare] ${label || '?'}: ${w}×${h} → ${cw}×${ch}, data URL = ${(dataUrl.length / 1024 / 1024).toFixed(2)} MB`);
      return dataUrl;
    };
    const imgToPngDataUrl = (img) => new Promise((resolve) => {
      // Use alt text or last URL segment as a friendly label for diagnostics.
      const label = img.alt || (img.currentSrc || img.src || '').split('/').pop() || 'img';
      // Step 1: try the live element
      if (img.complete && img.naturalWidth) {
        try {
          resolve(drawScaledToPng(img, label));
          return;
        } catch (e) {
          // toDataURL throws SecurityError on tainted canvas. Fall through.
        }
      }
      // Step 2: re-fetch via a fresh CORS-anonymous Image
      const src = img.currentSrc || img.src;
      if (!src) { resolve(null); return; }
      const tmp = new Image();
      tmp.crossOrigin = 'anonymous';
      tmp.decoding = 'async';
      tmp.onload = () => {
        try {
          resolve(drawScaledToPng(tmp, label));
        } catch (e) {
          console.warn('[Compare] canvas taint on fresh fetch:', src, e);
          resolve(null);
        }
      };
      tmp.onerror = () => {
        console.warn('[Compare] fresh fetch failed:', src);
        resolve(null);
      };
      tmp.src = src;
    });

    try {
      const stats = { ok: 0, fail: 0, skipped: 0 };
      await Promise.all(imgs.map(async (img) => {
        const src = img.getAttribute('src');
        if (!src) { stats.skipped++; return; }
        const dataUrl = await imgToPngDataUrl(img);
        if (dataUrl) {
          img.src = dataUrl;
          stats.ok++;
        } else {
          stats.fail++;
        }
      }));
      console.log('[Compare] img preprocess:', stats, 'of', imgs.length);

      // Strip <source> children of any <picture> from the clone — they point
      // at WebP URLs, and WebP inside <svg><image> doesn't render reliably,
      // so the picture element ends up rendering the WebP source (blank) and
      // ignoring the <img>'s data URL we just installed. Filter returns
      // false for SOURCE so html-to-image skips it during cloneChildren.
      const dataUrl = await toPng(node, {
        pixelRatio: 2,
        skipFonts: true,
        cacheBust: false,
        filter: (n) => n?.nodeName !== 'SOURCE',
      });
      const label = buildCompareLabel();
      setCompareSlots(prev => {
        const next = [...prev];
        next[slotIndex] = { imageUrl: dataUrl, label };
        return next;
      });
    } catch (err) {
      console.error('[Compare] capture failed:', err);
      toast.error('Could not capture preview — try again.');
    } finally {
      // Restore the original src on every <img> we touched, even on failure,
      // so the visible preview keeps using the lightweight WebP URLs.
      imgs.forEach((img, i) => {
        if (originalSrcs[i] != null && img.getAttribute('src') !== originalSrcs[i]) {
          img.src = originalSrcs[i];
        }
      });
    }
  }, [buildCompareLabel]);

  const clearSlot = useCallback((slotIndex) => {
    setCompareSlots(prev => {
      const next = [...prev];
      next[slotIndex] = null;
      return next;
    });
  }, []);

  // Toggle compare button: enter compare mode if off; fully exit (including
  // applied slider) if on.  Slider position lives in a ref, reset on mount of
  // the slider overlay rather than here.
  const toggleCompareMode = useCallback(() => {
    setCompareMode(prev => {
      const next = !prev;
      track(next ? "compare_opened" : "compare_closed");
      if (prev) {
        setCompareSlots([null, null]);
        setCompareApplied(false);
      }
      return next;
    });
  }, []);

  const applyCompare = useCallback(() => {
    if (compareSlots[0] && compareSlots[1]) {
      sliderPosRef.current = 50;
      setCompareApplied(true);
    }
  }, [compareSlots]);

  const exitCompare = useCallback(() => {
    setCompareMode(false);
    setCompareApplied(false);
    setCompareSlots([null, null]);
    sliderPosRef.current = 50;
  }, []);

  // Mutate the slider DOM directly without going through React state.  Called
  // on every pointermove during a drag — keeps the interaction at 60 fps
  // regardless of how expensive the surrounding component tree is to render.
  const updateSliderVisually = useCallback((pct) => {
    const p = Math.max(0, Math.min(100, pct));
    sliderPosRef.current = p;
    if (sliderDividerRef.current) sliderDividerRef.current.style.left = `calc(${p}% - 1px)`;
    if (sliderHandleRef.current) sliderHandleRef.current.style.left = `${p}%`;
    if (sliderImgBRef.current) sliderImgBRef.current.style.clipPath = `inset(0 0 0 ${p}%)`;
  }, []);

  // Start a drag.  Uses window-level move/up listeners (no setPointerCapture)
  // because capture was swallowing click events on the close button, and the
  // window-listener pattern naturally handles the pointer leaving the preview
  // area while dragging.
  const startSliderDrag = useCallback((initialEvent) => {
    const container = sliderContainerRef.current;
    if (!container) return;
    initialEvent.preventDefault();

    const setFromEvent = (ev) => {
      const rect = container.getBoundingClientRect();
      if (rect.width === 0) return;
      updateSliderVisually(((ev.clientX - rect.left) / rect.width) * 100);
    };
    // Apply the initial click position immediately so a click-to-jump feels
    // responsive even if the user doesn't move before releasing.
    setFromEvent(initialEvent);

    const onMove = (ev) => setFromEvent(ev);
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, [updateSliderVisually]);

  // Container-level pointerdown: starts a drag unless the click originated
  // from an element that opts out (e.g. the close button or the labels).
  // The data-compare-nodrag attribute is the opt-out flag.
  const handleSliderContainerPointerDown = useCallback((e) => {
    if (e.target.closest?.('[data-compare-nodrag]')) return;
    startSliderDrag(e);
  }, [startSliderDrag]);

  const handleMagnifierEnter = useCallback(() => {
    // Suppress the magnifier while Compare is open — in compare mode the
    // preview is either covered by the slot-tile overlay (picking) or the
    // slider overlay (applied), and zooming into either is unhelpful and
    // interferes with the slot/slider interactions.  Without this guard,
    // Signature Ombre (whose isConfigComplete flips true as soon as a
    // thickness is picked, independent of colour) would still activate the
    // lens while every other product happened to stay gated because their
    // isConfigComplete requires a design/colour the user hasn't set yet.
    if (compareMode) return;
    // Respect the user-controlled toggle — when off, the lens never activates
    // on hover.  Cheaper than gating the toggle button at the event source
    // because it also short-circuits the re-snapshot useEffect below (which
    // calls handleMagnifierEnter on zoom/pan changes).
    if (!magnifierEnabled) return;
    if (!isConfigComplete || isDraggingRef.current) return;
    const node = magnifierRef.current;
    const lens = magnifierDivRef.current;
    if (!node || !lens) return;
    // Remove any stale clone
    while (lens.firstChild) lens.removeChild(lens.firstChild);
    // Deep-clone the preview node — synchronous, images already cached
    const clone = node.cloneNode(true);
    // Copy canvas pixel data — cloneNode creates blank canvases, so we manually
    // drawImage from each original canvas into its cloned counterpart.
    const origCanvases = Array.from(node.querySelectorAll('canvas'));
    const cloneCanvases = Array.from(clone.querySelectorAll('canvas'));
    origCanvases.forEach((orig, i) => {
      const dest = cloneCanvases[i];
      if (!dest) return;
      dest.width = orig.width;
      dest.height = orig.height;
      try {
        dest.getContext('2d')?.drawImage(orig, 0, 0);
      } catch (_) {}
    });
    clone.style.cssText = [
      'position:absolute',
      'top:0',
      'left:0',
      `width:${node.offsetWidth}px`,
      `height:${node.offsetHeight}px`,
      'pointer-events:none',
      'transform-origin:top left',
      `transform:scale(${MAGNIFIER_ZOOM})`,
      // Hint the browser to GPU-composite the clone so subsequent translates
      // (lens follows cursor) don't trigger re-rasterisation.
      'will-change:transform',
    ].join(';');
    lens.appendChild(clone);
    lensCloneRef.current = clone;
    // Cache the preview container's rect so the mousemove path doesn't have
    // to call getBoundingClientRect() on every tick.
    lensRectRef.current = node.getBoundingClientRect();
    setMagnifierActive(true);
  }, [isConfigComplete, compareMode, magnifierEnabled]);

  // If compare mode is toggled on while the lens is already on screen
  // (e.g. user hovers, then clicks the Compare button without moving the
  // cursor away), tear the lens down immediately so it doesn't linger over
  // the slot-tile overlay.
  useEffect(() => {
    if (!compareMode) return;
    setMagnifierActive(false);
    const lens = magnifierDivRef.current;
    if (lens) while (lens.firstChild) lens.removeChild(lens.firstChild);
    lensCloneRef.current = null;
  }, [compareMode]);

  // If the user toggles the magnifier OFF while the lens is currently
  // visible (cursor still over the preview), tear it down right away so the
  // toggle feels responsive — otherwise the lens would linger until the next
  // mouseleave.
  useEffect(() => {
    if (magnifierEnabled) return;
    setMagnifierActive(false);
    const lens = magnifierDivRef.current;
    if (lens) while (lens.firstChild) lens.removeChild(lens.firstChild);
    lensCloneRef.current = null;
  }, [magnifierEnabled]);

  // Re-snapshot the magnifier clone when zoom or pan state changes while the
  // lens is active.  Without this, the clone is a stale capture from the
  // moment of mouseenter — so panning a zoomed-in image makes the lens show
  // the wrong region under the cursor.  Skipped during an active drag so we
  // don't burn through DOM clones on every pointermove tick; the final
  // snapshot is taken when isDragging flips back to false.
  useEffect(() => {
    if (!magnifierActive || isDragging) return;
    handleMagnifierEnter();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoomLevel, isDragging]);

  // Clamp zoom when switching to ombre (which has a lower max) — but ONLY
  // when leaving Signature Ombre, since that category gets the standard
  // 10x ceiling. Without the category check, navigating from Signature
  // Ombre at zoom 5x to Color Core Ombre would snap to 1.5 mid-transition.
  useEffect(() => {
    if (
      selectedProductType?.id === "ombre" &&
      selectedCategory?.id !== "signature-ombre"
    ) {
      setZoomLevel(prev => Math.min(prev, 1.5));
    }
  }, [selectedProductType?.id, selectedCategory?.id]);

  // ── Signature Ombre engine lifecycle & rendering ───────────────────────────
  // Init engine + preload all OBJ models when Signature Ombre category is first selected
  useEffect(() => {
    if (selectedProductType?.id !== 'ombre' || selectedCategory?.id !== 'signature-ombre') return;
    if (soEngineRef.current) return; // already initialised
    const engine = new OmbreEmbossEngine();
    soEngineRef.current = engine;
    setSoIsLoading(true);
    engine.preloadAll(SO_PATTERNS).then(() => {
      setSoIsLoading(false);
    });
  }, [selectedProductType?.id, selectedCategory?.id]);

  // Dispose engine when user leaves the Ombre product entirely
  useEffect(() => {
    if (selectedProductType?.id === 'ombre') return;
    if (soEngineRef.current) {
      soEngineRef.current.dispose();
      soEngineRef.current = null;
      setSoPanelImage(null);
    }
  }, [selectedProductType?.id]);

  // Dispose on component unmount
  useEffect(() => {
    return () => {
      if (soEngineRef.current) { soEngineRef.current.dispose(); soEngineRef.current = null; }
      if (soDebounceRef.current) clearTimeout(soDebounceRef.current);
    };
  }, []);

  // Re-render panel whenever Signature Ombre config changes
  useEffect(() => {
    if (selectedProductType?.id !== 'ombre' || selectedCategory?.id !== 'signature-ombre') return;
    const engine = soEngineRef.current;
    // No color picked yet → wall reads as bare white (handled by the preview
    // component's null-panelImage fallback).  Nothing renders, nothing tiles.
    if (!soOverlayColor) {
      setSoPanelImage(null);
      return;
    }
    if (!soSelectedPattern) {
      // Color picked but no emboss — render the flat 2D ombre gradient via
      // the shared smoothstep-based builder (kept in sync with the embossed
      // path and free of the Mach band a naive 3-stop linear gradient produces).
      const cv = document.createElement('canvas');
      cv.width = 512; cv.height = 1024;
      const ctx2 = cv.getContext('2d');
      ctx2.fillStyle = OmbreEmbossEngine.buildOmbreGradient(ctx2, cv.width, cv.height, soOverlayColor, soBlend);
      ctx2.fillRect(0, 0, cv.width, cv.height);
      setSoPanelImage(cv.toDataURL('image/png'));
      return;
    }
    if (!engine || soIsLoading || !engine.isLoaded(soSelectedPattern)) return;
    if (soDebounceRef.current) clearTimeout(soDebounceRef.current);
    soDebounceRef.current = setTimeout(() => {
      try {
        const result = engine.render({
          baseColor: '#ffffff',
          overlayColor: soOverlayColor,
          ombrePercent: soBlend,
          patternId: soSelectedPattern,
          lightRotation: soLightRotation,
        });
        setSoPanelImage(result.dataUrl);
      } catch (err) {
        console.error('Signature Ombre render failed:', err);
      }
    }, 80);
  }, [soBaseColor, soOverlayColor, soBlend, soSelectedPattern, soLightRotation, soIsLoading, selectedProductType?.id, selectedCategory?.id]);

  // ── Analytics: configurator_loaded (once on mount, PRD 4.2) ───────────────
  useEffect(() => { track("configurator_loaded"); }, []);

  // ── Analytics: preview_rendered — fires the moment isConfigComplete flips
  //    false → true (i.e., the user has filled every required field). PRD 4.2. ──
  const previousReadyRef = useRef(false);
  useEffect(() => {
    if (isConfigComplete && !previousReadyRef.current) {
      track("preview_rendered", analyticsSnap());
    }
    previousReadyRef.current = isConfigComplete;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfigComplete]);

  // ── Analytics: configuration_abandoned (PRD 4.2). Fires on tab close /
  //    unload. Uses sendBeacon so the request survives the page tearing down. ──
  useEffect(() => {
    const onBeforeUnload = () => {
      // Only worth reporting if the user actually started configuring something.
      if (!selectedProductType) return;
      track("configuration_abandoned", { ...analyticsSnap(), config_complete: !!isConfigComplete });
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProductType, isConfigComplete]);

  // ── Analytics: category_dwell (PRD 4.3). Per-category dwell timer that
  //    starts on category selection, pauses when the tab is backgrounded
  //    (Page Visibility API), resumes on re-focus, and emits a single
  //    "category_dwell" event with duration_ms when:
  //      - the user picks a different category
  //      - the user closes the tab while on a category
  //
  //    Refs (not state) so handlers always read the latest values without
  //    re-running on every category switch.
  // ─────────────────────────────────────────────────────────────────────────
  const dwellCategoryRef = useRef(null);     // current category snapshot
  const dwellStartRef = useRef(null);        // ms timestamp when active period started (null = paused)
  const dwellAccumulatedRef = useRef(0);     // total ms accumulated across pause/resume cycles

  const flushDwell = (extraProps = {}) => {
    const cat = dwellCategoryRef.current;
    if (!cat) return;
    const liveMs = dwellStartRef.current ? Date.now() - dwellStartRef.current : 0;
    const totalMs = dwellAccumulatedRef.current + liveMs;
    // Discard sub-second blips — selecting then immediately switching isn't
    // signal, just exploration noise.
    if (totalMs < 1000) return;
    track("category_dwell", {
      category: cat.id,
      category_name: cat.name,
      product_type: selectedProductType?.id,
      surface: selectedSurfaceType,
      duration_ms: totalMs,
      duration_seconds: Math.round(totalMs / 1000),
      ...extraProps,
    });
  };

  // Fire on every category change — flush the OLD category's dwell, then
  // start the timer for the new one.
  useEffect(() => {
    flushDwell();
    if (selectedCategory) {
      dwellCategoryRef.current = selectedCategory;
      dwellStartRef.current = Date.now();
      dwellAccumulatedRef.current = 0;
    } else {
      dwellCategoryRef.current = null;
      dwellStartRef.current = null;
      dwellAccumulatedRef.current = 0;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCategory?.id]);

  // Pause/resume on tab visibility — so a user who alt-tabs for 10 minutes
  // doesn't inflate the dwell stat for the category they left open.
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) {
        // Bank elapsed time and pause.
        if (dwellStartRef.current) {
          dwellAccumulatedRef.current += Date.now() - dwellStartRef.current;
          dwellStartRef.current = null;
        }
      } else {
        // Resume — only if we actually have a category being timed.
        if (dwellCategoryRef.current && !dwellStartRef.current) {
          dwellStartRef.current = Date.now();
        }
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Final flush on tab close so the last category isn't lost.
  useEffect(() => {
    const onUnload = () => flushDwell({ ended_by: "unload" });
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Render logging (remove when done profiling) ────────────────────────────
  useRenderLog("Configurator", {
    selectedProductType: selectedProductType?.id,
    selectedCategory: selectedCategory?.id,
    selectedDesign: selectedDesign?.id ?? selectedDesign?.name,
    selectedSize,
    selectedDensity,
    selectedPattern: selectedPattern?.id ?? selectedPattern?.name,
    selectedColor: selectedColor?.hex ?? selectedColor,
    selectedThickness,
    isEmbossed,
    showTpatti,
    loading,
    favoritesOpen,
  });

  // Load products from CDN JSON (replaces /api/products)
  useEffect(() => {
    const fetchProducts = async () => {
      try {
        // const response = await axios.get(`${API}/products`);
        // const apiProducts = response.data;
        const response = await fetch(`${ASSETS_URL}/data/products.json`);
        const apiProducts = await response.json();
        setProducts(apiProducts);

        // ── URL → initial state resolution ──────────────────────────────
        // URL shape is /:surfaceType/:productType.  Rules (per spec):
        //   /                                         → /flat,    no series
        //   /flat | /embossed | /grooving             → that tab, no series
        //   /<surface>/<series>  (valid combo)        → both set
        //   /<surface>/<series>  (invalid combo)      → redirect to /flat
        //   /<invalid-surface>[/...]                  → redirect to /flat
        //   /<series>    (legacy, no surface prefix)  → redirect to /flat
        // Only a valid (surface × series) pair hydrates selectedProductType;
        // anything else lands on Flat with no series so the user picks fresh.
        const surfaceValid = surfaceTypeParam && VALID_SURFACES.includes(surfaceTypeParam);
        const resolvedId = productTypeParam ? (URL_SLUG_TO_PRODUCT_ID[productTypeParam] || productTypeParam) : null;
        const urlProduct = resolvedId ? apiProducts.find(p => p.id === resolvedId && p.active) : null;
        const combinationValid = surfaceValid && urlProduct &&
          (SURFACE_SERIES_MAP[surfaceTypeParam] ?? []).includes(urlProduct.id);

        if (combinationValid) {
          setSelectedSurfaceType(surfaceTypeParam);
          setSelectedProductType(urlProduct);
        } else if (surfaceValid && !productTypeParam) {
          // Bare /flat | /embossed | /grooving — show that tab, no series.
          setSelectedSurfaceType(surfaceTypeParam);
          setSelectedProductType(null);
        } else {
          // Root /, legacy series-only paths, invalid surface, or invalid
          // (surface × series) combination — redirect to /flat and clear.
          setSelectedSurfaceType('flat');
          setSelectedProductType(null);
          if (location.pathname !== '/flat') {
            // Carry the query string across. A campaign link lands on
            // /?utm_source=brevo&…; dropping it here meant GA4 saw a bare
            // /flat page_view and could not attribute the session. Deep-link
            // params (?dl=1&…) ride along for the same reason.
            navigate('/flat' + location.search, { replace: true });
          }
        }
        setLoading(false);
      } catch (error) {
        console.error("Failed to fetch products:", error);
        toast.error("Failed to load products");
        setLoading(false);
      }
    };
    fetchProducts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ENABLE_BOOT_WHITE_OVERLAY) {
      setShowBootOverlay(false);
      return;
    }

    if (loading) {
      setShowBootOverlay(true);
      return;
    }

    const timer = setTimeout(() => {
      setShowBootOverlay(false);
    }, BOOT_OVERLAY_EXTRA_MS);

    return () => clearTimeout(timer);
  }, [loading]);

  // Load tech specs from CDN JSON (replaces /api/products/{id}/specs)
  // Handle surfaceType hint from chat widget navigation state
  useEffect(() => {
    const st = location.state?.surfaceType;
    if (!st || loading) return;
    handleSurfaceTypeChange(st);
    // Clear the state so re-renders don't re-fire this
    navigate(location.pathname, { replace: true, state: {} });
  }, [location.state?.surfaceType, loading]);

  // ── Walkthrough (Shepherd.js) demo-fill helper ────────────────────────────
  // The public/univicoustic-tour.js script calls window.__uvTourFillDemo()
  // before it launches so every sidebar section (Category, Size, Thickness,
  // Designs, Emboss, Angle dial) is already rendered and each step's tooltip
  // has a real element to anchor to.  Without this, the tour hits orphan
  // floating dialogs on steps whose target is conditionally rendered.
  //
  // Fills: Embossed → Wood → Wood Classics → first design + size + thickness
  // + first emboss pattern.  Chose Wood Classics because it exercises the
  // most section types with the least cross-category complexity.
  //
  // Studio Lighting is intentionally NOT touched — previously this set it to
  // Warm so the Angle dial step had a visible dial, but that turned out to
  // be disruptive (people opening Replay tour didn't expect their lighting
  // to flip). The Angle step's attachTo falls back to the lighting widget if
  // the dial isn't there.
  useEffect(() => {
    if (!products?.length) return;
    window.__uvTourFillDemo = () => {
      const wood = products.find(p => p.id === 'wood');
      if (!wood) return;
      const classics = wood.categories?.find(c => c.id === 'wood-wood-classics');
      if (!classics) return;
      // Pick the first design that ACTUALLY supports emboss — Wood Classics
      // has many designs with empty available_emboss[] (flat-only renders),
      // and the post-emboss-first refactor hides the Emboss tile grid for
      // those, leaving the tour pointing at an empty section. Falling back
      // to designs[0] if none declare emboss so the demo still mostly works.
      const firstDesign =
        classics.designs?.find(d => Array.isArray(d.available_emboss) && d.available_emboss.length > 0)
        ?? classics.designs?.[0];
      const firstSize = wood.sizes?.[0];
      const firstThick = wood.thicknesses?.[0];
      // Choose an emboss pattern the chosen design supports, so the tile
      // appears as "selected" in the grid (instead of falling through to a
      // pattern that's been filtered out by the design's available_emboss).
      const allowedEmbossIds = firstDesign?.available_emboss ?? [];
      const firstEmboss =
        FLAT_EMBOSSED_EMBOSS_PATTERNS?.find(p => allowedEmbossIds.includes(p.id))
        ?? FLAT_EMBOSSED_EMBOSS_PATTERNS?.[0]
        ?? null;

      // Batched inside one event loop so React renders once.
      setSelectedSurfaceType('embossed');
      setSelectedProductType(wood);
      setSelectedCategory(classics);
      if (firstDesign) setSelectedDesign(firstDesign);
      if (firstSize) setSelectedSize(firstSize);
      if (firstThick) setSelectedThickness(firstThick);
      if (firstEmboss) setSelectedEmbossPattern(firstEmboss);
      // Keep the URL in sync so a refresh during the tour doesn't reset state.
      navigate('/embossed/wood');
    };
    return () => { try { delete window.__uvTourFillDemo; } catch (_) {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, navigate]);

  useEffect(() => {
    const fetchSpecs = async () => {
      if (selectedProductType?.id) {
        try {
          // const response = await axios.get(`${API}/products/${selectedProductType.id}/specs`);
          // setTechSpecs(response.data);
          const response = await fetch(`${ASSETS_URL}/data/tech-specs.json`);
          const allSpecs = await response.json();
          setTechSpecs(allSpecs[selectedProductType.id] || {});
        } catch (error) {
          setTechSpecs(DEFAULT_SPECS[selectedProductType.id] || null);
        }
      }
    };
    fetchSpecs();
  }, [selectedProductType]);

  // Debug: API fetch timing
  // (render-level state diffs are now handled by useRenderLog above)

  // Load favorites from localStorage
  useEffect(() => {
    const saved = localStorage.getItem("univicoustic_favorites");
    if (saved) {
      setFavorites(JSON.parse(saved));
    }
  }, []);

  // Save favorites to localStorage
  const saveFavorites = useCallback((newFavorites) => {
    localStorage.setItem("univicoustic_favorites", JSON.stringify(newFavorites));
    setFavorites(newFavorites);
  }, []);

  // Handle product type change
  // handleProductTypeChange accepts an optional overrideSurfaceType so it can
  // be called before React flushes the setSelectedSurfaceType update (e.g. from
  // handleSurfaceTypeChange). Falls back to the current selectedSurfaceType.
  const handleProductTypeChange = (productId, overrideSurfaceType) => {
    const product = products.find(p => p.id === productId);
    if (product && product.active) {
      track("series_changed", {
        from: selectedProductType?.id,
        to: productId,
        surface: overrideSurfaceType ?? selectedSurfaceType,
      });
      // URL now includes the active surface tab: /<surface>/<series>.
      // overrideSurfaceType handles the case where handleSurfaceTypeChange
      // flips the tab and immediately picks a series before React has
      // flushed the setSelectedSurfaceType update.
      const surface = overrideSurfaceType ?? selectedSurfaceType;
      const slug = PRODUCT_ID_TO_URL_SLUG[productId] || productId;
      navigate(`/${surface}/${slug}`);
      setSelectedProductType(product);
      
      // Clear all state first
      setPanOffset({ x: 0, y: 0 });
      setSelectedCategory(null);
      setSelectedDesign(null);
      setIsEmbossed(false);
      setSelectedPattern(null);
      setSelectedColor(null);
      setSelectedDensity(null);
      setSelectedSize(null);
      setSelectedThickness(null);
      setSelectedEmbossPattern(null);
      setSelectedWoodPerfSize(null);
      setSelectedPerforation(null);
      setSelectedColorCoreEmboss(null);
      setSelectedColorCoreColor(null);
      setSelectedFabricStructure(null);
      setSelectedDTColorGroup(null);
      setSelectedDTShade(null);
      setSelectedDTFabric(null);
      setSelectedDTSize(null);
      setSelectedDTEmboss(null);
      setSelectedOmbreBaseColor(null);
      setSelectedOmbreOverlay(null);
      setSelectedOmbreEmbossPattern(null);
      setSelectedOmbreGroovePattern(null);
      setOmbreFinishType("emboss");
      
      // Nothing pre-filled on product type change — user selects everything from scratch.
      if (product.id === "ombre") {
        // Keep finish-type state consistent; no visible selections yet
        setSelectedOmbreEmbossPattern(null);
        setSelectedOmbreGroovePattern(null);
        const st = overrideSurfaceType ?? selectedSurfaceType;
        setOmbreFinishType(st === 'grooving' ? 'groove' : 'emboss');
      }
    }
  };

  // Handle category change (for non-VicStrip products)
  const handleCategoryChange = (categoryId) => {
    const category = selectedProductType?.categories?.find(c => c.id === categoryId);
    if (category) {
      track("category_changed", {
        from: selectedCategory?.id,
        to: categoryId,
        category_name: category.name,
        surface: selectedSurfaceType,
        product_type: selectedProductType?.id,
      });
      setSelectedCategory(category);
      setIsEmbossed(false);
      setSelectedEmbossPattern(null);
      // Wood Perforations: auto-select first size, first print (design), and first pattern
      if (category.id === "wood-perforations") {
        const defaultSize = WOOD_PERFORATION_SIZES[0].id;
        const exclusions = WOOD_PERFORATION_EXCLUSIONS[defaultSize] || [];
        const defaultPattern = WOOD_PERFORATION_PATTERNS.find(p => !exclusions.includes(p.id));
        setSelectedDesign(category.designs?.[0] || null);
        setSelectedWoodPerfSize(defaultSize);
        setSelectedPerforation(defaultPattern || null);
      } else if (category.id === "fabrics-color-core") {
        // Color Core: clear all selections — user picks from scratch
        setSelectedColorCoreColor(null);
        setSelectedFabricStructure(null);
        setSelectedColorCoreEmboss(null);
        setSelectedSize(null);
        setSelectedDesign(null);
        if (selectedThickness?.includes("PET Wool")) setSelectedThickness(null);
      } else if (category.id === "fabrics-designer-textile") {
        // Designer Textile: auto-select first color + first compatible fabric so textures are immediately visible
        const firstGroup = DESIGNER_TEXTILE_COLOR_GROUPS[0];
        const firstShade = firstGroup?.shades?.[0] ?? null;
        const firstFabric = firstGroup
          ? (DESIGNER_TEXTILE_FABRICS.find(f => f.supportedColorGroups.includes(firstGroup.id)) ?? DESIGNER_TEXTILE_FABRICS[0])
          : null;
        setSelectedDTColorGroup(firstGroup ?? null);
        setSelectedDTShade(firstShade);
        setSelectedDTFabric(firstFabric);
        setSelectedDTSize(null);
        setSelectedDTEmboss(null);
        setSelectedThickness(null);
        setSelectedDesign(null);
      } else if (category.id === "ombre-color-core-ombre") {
        // Ombre Color Core: clear all selections — user picks from scratch
        setSelectedOmbreBaseColor(null);
        setSelectedOmbreOverlay(null);
        setSelectedOmbreEmbossPattern(null);
        setSelectedOmbreGroovePattern(null);
        // Force groove when the user has selected the Grooving surface type
        setOmbreFinishType(selectedSurfaceType === 'grooving' ? 'groove' : 'emboss');
        setSelectedDesign(null);
      } else if (category.id === "signature-ombre") {
        // Signature Ombre: clear all selections — user picks from scratch.
        // Overlay color and emboss start null so the preview stays blank until
        // the user picks a color.  Light rotation is locked to the -55° value
        // since the visual HDRI dial was removed; blend stays at the default.
        setSoPanelImage(null);
        setSoBaseColor('#ffffff');
        setSoOverlayColor(null);
        setSoBlend(50);
        setSoSelectedPattern(null);
        setSelectedDesign(null);
        setSelectedThickness(selectedProductType?.thicknesses?.[0] || null);
      } else if (category.designs?.length > 0) {
        // Under Embossed/Grooving the new emboss-first sidebar order requires
        // that no panel renders until the user has picked BOTH an emboss
        // pattern AND a design. Auto-selecting the first design here would
        // paint a non-embossed colour panel into the preview the moment the
        // user opens the category — exactly the thing the emboss-first move
        // was meant to prevent. Keep the auto-select only for Flat (where
        // panels are inherently un-embossed by design).
        if (selectedSurfaceType === 'flat') {
          setSelectedDesign(category.designs[0]);
        } else {
          setSelectedDesign(null);
        }
      } else {
        setSelectedDesign(null);
      }
    }
  };

  // VicStrip: handle size change — resets pattern to first available for new size
  const handleVicstripSizeChange = (size) => {
    setSelectedSize(size);
    const firstForSize = VICSTRIP_PRODUCT.patterns.find(p => p.sizes.includes(size));
    if (firstForSize) {
      setSelectedPattern(firstForSize);
      setSelectedDesign({ pattern: firstForSize, color: firstForSize.colors[0] });
      setSelectedCategory(null);
    }
  };

  // Preload + async-decode vicstrip thumbnail images when pattern/category changes
  useEffect(() => {
    if (selectedProductType?.id !== "vicstrip") return;
    const urls = [];
    const apiCategory = selectedProductType?.categories?.find(c => c.id === `vicstrip-${selectedPattern?.id}`);
    if (apiCategory?.designs?.length > 0) {
      apiCategory.designs.forEach((d) => {
        const url = getVicstripThumbnailUrl(selectedPattern?.id, d.design_code);
        if (url) urls.push(url);
      });
    } else if (selectedPattern) {
      const pid = selectedPattern.id || selectedPattern.name;
      (selectedPattern.colors || []).forEach((c) => {
        const code = VICSTRIP_COLOR_TO_CODE[c.id];
        if (!code) return;
        const url = getVicstripThumbnailUrl(pid, code);
        if (url) urls.push(url);
      });
    }

    urls.forEach((u) => {
      const img = new Image();
      img.decoding = 'async';
      img.src = u;
      if (img.decode) img.decode().catch(() => {});
    });
  }, [selectedProductType?.id, selectedProductType?.categories, selectedPattern?.id, selectedSize]);

  // VicStrip: handle pattern change
  const handlePatternChange = (patternId) => {
    const pattern = VICSTRIP_PRODUCT.patterns.find(p => p.id === patternId);
    if (pattern) {
      setSelectedPattern(pattern);
      setSelectedDesign({ pattern, color: pattern.colors[0] });
      // clear category when switching patterns
      setSelectedCategory(null);
    }
  };

  // Handle design selection (accept design object or color id for VicStrip)
  const handleDesignSelect = (designOrColor) => {
    if (!designOrColor) return;
    // PRD 4.2: track print/design selection. Treated as a "color swatch" event
    // for VicStrip (design tile = colour) and a "design_selected" for everything
    // else where the print is its own concept.
    track(selectedProductType?.id === "vicstrip" ? "color_swatch_clicked" : "design_selected", {
      design_id: designOrColor?.id,
      design_code: designOrColor?.design_code,
      design_name: designOrColor?.design_name,
      product_type: selectedProductType?.id,
      category: selectedCategory?.id,
      surface: selectedSurfaceType,
    });
    if (selectedProductType?.id === "vicstrip") {
      // VicStrip flow
      if (typeof designOrColor === 'object' && designOrColor.color) {
        setSelectedDesign(designOrColor);
      } else if (typeof designOrColor === 'object' && designOrColor.id) {
        const color = selectedPattern?.colors?.find(c => c.id === designOrColor.color?.id);
        if (color) setSelectedDesign({ pattern: selectedPattern, color });
      } else {
        const color = selectedPattern?.colors?.find(c => c.id === designOrColor);
        if (color) setSelectedDesign({ pattern: selectedPattern, color });
      }
    } else {
      // Generic product flow (VMD, Ombre, etc.)
      if (selectedDesign?.id !== designOrColor?.id) {
        // With the new "emboss-first" sidebar order users can pre-select an
        // emboss pattern before any design. Keep the selection across design
        // changes when the new design supports it; otherwise clear it. Toast
        // only when the new design has its own emboss options (i.e. the user
        // would have noticed a tile getting deselected).
        //
        // Leather is the exception: its emboss compatibility is driven by
        // SIZE (LEATHER_EMBOSS_BY_SIZE), not by per-design available_emboss,
        // so skip this per-design validation entirely for Leather.  Changing
        // the print code should never clear the emboss for leather.
        if (selectedCategory?.id !== 'vmd-leather') {
          const newAvailable = designOrColor?.available_emboss ?? [];
          if (selectedEmbossPattern && !newAvailable.includes(selectedEmbossPattern.id)) {
            if (newAvailable.length > 0) {
              toast.info(`${selectedEmbossPattern.name} isn't available for ${designOrColor.design_code} — emboss cleared`);
            }
            setSelectedEmbossPattern(null);
          }
        }
      }
      setSelectedDesign(designOrColor);
    }
  };

  // Handle ombre size change — force groove when 1200x2400 is selected
  // Ombre size change used to also force ombreFinishType="groove" when the
  // user picked 1200x2400 because that size was groove-only.  Both sizes now
  // carry both emboss + groove panels, so the forced switch is gone and this
  // handler just sets the size — the surface-type sync effect keeps
  // ombreFinishType coherent with the active tab.
  const handleOmbreSizeChange = useCallback((size) => {
    setSelectedSize(size);
  }, []);

  // Toggle emboss pattern selection (clicking the selected pattern deselects it)
  const handleEmbossPatternSelect = (pattern) => {
    setSelectedEmbossPattern(prev => {
      const isDeselecting = prev?.id === pattern.id;
      if (!isDeselecting) setShowTpatti(false);
      track("emboss_pattern_selected", {
        pattern_id: pattern?.id,
        pattern_name: pattern?.name,
        action: isDeselecting ? "deselect" : "select",
        category: selectedCategory?.id,
        product_type: selectedProductType?.id,
      });
      return isDeselecting ? null : pattern;
    });
  };

  // (groove thumbnails now served via /thumb/ — no eager preload needed)

  // For Leather: when the size changes and the currently-selected emboss
  // pattern is no longer in LEATHER_EMBOSS_BY_SIZE[size], clear it so the
  // sidebar doesn't show a stale selection that has no visible tile.
  useEffect(() => {
    if (selectedCategory?.id !== 'vmd-leather') return;
    if (!selectedEmbossPattern || !selectedSize) return;
    const allowed = LEATHER_EMBOSS_BY_SIZE[selectedSize] || [];
    if (!allowed.includes(selectedEmbossPattern.id)) {
      setSelectedEmbossPattern(null);
    }
  }, [selectedSize, selectedCategory, selectedEmbossPattern]);

  // Save current configuration to favorites
  const saveToFavorites = () => {
    // Use `isConfigComplete` instead of `selectedDesign` — the latter is null
    // for Ombre (Color Core + Signature) and a few other variants that store
    // their selection in product-specific state.  `isConfigComplete` already
    // encapsulates the per-product completeness rules and is what gates the
    // preview, so it's the authoritative "ready to save" check.
    if (!isConfigComplete) {
      toast.error("Please complete all selections first");
      track("save_clicked", { ...analyticsSnap(), result: "incomplete" });
      return;
    }
    // PRD 4.6: every Save event ships the full config snapshot.
    track("save_clicked", { ...analyticsSnap(), result: "saved" });

    // Persist a COMPLETE snapshot via the same captureTabState() mechanism the
    // surface-tab switcher uses.  This captures every product-specific field
    // (Ombre base/overlay/emboss, Wood-Perforation, Color-Core, Designer-
    // Textile, VicStrip, …) — not just the generic-design flow the old payload
    // covered.  `surfaceType` is stored alongside because the snapshot itself
    // is surface-agnostic but restore needs it.
    //
    // Display fields (title/subtitle/swatch) are derived from configSummary —
    // the same source as the on-canvas mini-cards — so the saved-list card
    // renders correctly for every product family.
    const summary = configSummary || [];
    const config = {
      id: Date.now().toString(),
      timestamp: new Date().toISOString(),
      surfaceType: selectedSurfaceType,
      productTypeId: selectedProductType?.id,
      // Card display metadata (see favorites list UI).
      displayTitle: selectedProductType?.name || 'Configuration',
      displaySubtitle: summary.map((e) => e.value).filter(Boolean).slice(0, 2).join(' · '),
      displaySwatch: summary.find((e) => e.color)?.color || null,
      // Complete, restorable state.  The structural objects (product +
      // category) are slimmed to {id,name} stubs — loadFavorite's
      // rehydrateSnapshot re-resolves them from the canonical `products`
      // array, so storing the full (≤25 KB) product object per save would
      // only bloat localStorage.  Leaf selections are kept as-is.
      snapshot: (() => {
        const s = captureTabState();
        return {
          ...s,
          selectedProductType: s.selectedProductType
            ? { id: s.selectedProductType.id, name: s.selectedProductType.name }
            : null,
          selectedCategory: s.selectedCategory
            ? { id: s.selectedCategory.id, name: s.selectedCategory.name }
            : null,
        };
      })(),
    };

    const newFavorites = [...favorites, config];
    saveFavorites(newFavorites);
    toast.success("Configuration saved!");
  };

  // Re-resolve the structural backbone (product + category) of a deserialized
  // snapshot against the canonical `products` array.  The snapshot's objects
  // came back from localStorage JSON as plain copies; re-pointing product and
  // category at the live objects keeps shapes/effects consistent with the rest
  // of the app.  Leaf selections (design, perforation, colours) keep their
  // serialized copies — the UI compares those by id, so copies render fine.
  const rehydrateSnapshot = (snap) => {
    const product = snap.selectedProductType?.id
      ? (products.find((p) => p.id === snap.selectedProductType.id) || snap.selectedProductType)
      : snap.selectedProductType;
    const category = snap.selectedCategory?.id && product?.categories
      ? (product.categories.find((c) => c.id === snap.selectedCategory.id) || snap.selectedCategory)
      : snap.selectedCategory;
    return { ...snap, selectedProductType: product, selectedCategory: category };
  };

  // Load favorite configuration
  const loadFavorite = (favorite) => {
    // New format (snapshot): restore the COMPLETE state via the same
    // applyTabState() path the surface-tab switcher uses — this correctly
    // restores every product family, sets the surface tab, and syncs the URL.
    if (favorite.snapshot) {
      const surface = favorite.surfaceType || selectedSurfaceType || 'flat';
      setSelectedSurfaceType(surface);
      applyTabState(rehydrateSnapshot(favorite.snapshot), surface);
      // Keep the restored config as the active state for the surface tab so a
      // later tab-switch-and-return doesn't lose it.
      tabStatesRef.current[surface] = rehydrateSnapshot(favorite.snapshot);
      setFavoritesOpen(false);
      toast.success("Configuration loaded!");
      return;
    }

    // ── Legacy format (saved before the snapshot migration) ────────────────
    // The old flat payload only carried enough to restore VicStrip and the
    // generic design-based flows (which stored a `design` object).  Ombre,
    // Wood-Perforations, and the Fabrics Color-Core/Designer-Textile flows
    // kept their selection in product-specific state that the old payload
    // never captured — so those can't be reloaded.  Rather than silently
    // restore a blank config and (mis)report success, tell the user to
    // re-save.  This is the case for the stale ombre saves created during
    // early testing before the snapshot mechanism landed.
    const legacyRestorable =
      favorite.productTypeId === "vicstrip" || !!favorite.design;
    if (!legacyRestorable) {
      toast.error("This saved design is from an older version and can't be reloaded — please re-create and save it.");
      setFavoritesOpen(false);
      return;
    }

    const product = products.find(p => p.id === favorite.productTypeId);
    if (product) {
      setSelectedProductType(product);

      if (favorite.productTypeId === "vicstrip") {
        // VicStrip flow
        const pattern = VICSTRIP_PRODUCT.patterns.find(p => p.id === favorite.pattern.id);
        if (pattern) {
          setSelectedPattern(pattern);
          const color = pattern.colors.find(c => c.id === favorite.color.id);
          if (color) {
            setSelectedDesign({ pattern, color });
          }
        }
        setSelectedSize(favorite.size || "600x600");
        setSelectedThickness(favorite.thickness || "12mm (PET Panel)");
      } else {
        // Generic product flow
        const category = product.categories?.find(c => c.id === favorite.categoryId);
        if (category) {
          setSelectedCategory(category);
          setSelectedDesign(favorite.design);
        }
        setSelectedSize(favorite.size);
        setSelectedDensity(favorite.density);
        setSelectedPattern(favorite.pattern);
        setSelectedColor(favorite.color);
        setSelectedThickness(favorite.thickness);
        setIsEmbossed(favorite.isEmbossed);
        if (favorite.embossPattern) setSelectedEmbossPattern(favorite.embossPattern);
      }
    }
    setFavoritesOpen(false);
    toast.success("Configuration loaded!");
  };

  // Delete favorite
  const deleteFavorite = (favoriteId, e) => {
    e.stopPropagation();
    const newFavorites = favorites.filter(f => f.id !== favoriteId);
    saveFavorites(newFavorites);
    toast.success("Favorite removed");
  };

  // ── Inline rename for saved configurations ────────────────────────────────
  // Enter edit mode for a card: seed the draft with the current display name.
  const beginRename = (favorite, e) => {
    e.stopPropagation();
    setRenamingId(favorite.id);
    setRenameDraft(favorite.name || favorite.displayTitle || favorite.productType || "");
  };
  // Commit the draft (trimmed) as the favorite's custom `name`.  Empty/blank
  // input clears the custom name so the card falls back to its default title.
  const commitRename = (favoriteId) => {
    const trimmed = renameDraft.trim();
    const newFavorites = favorites.map((f) =>
      f.id === favoriteId ? { ...f, name: trimmed || undefined } : f
    );
    saveFavorites(newFavorites);
    setRenamingId(null);
    setRenameDraft("");
  };
  const cancelRename = () => {
    setRenamingId(null);
    setRenameDraft("");
  };

  // Download rendered image
  const [downloading, setDownloading] = useState(false);
  // Synchronous companion to `downloading` — React state updates are async,
  // so the `if (downloading) return` guard inside downloadImage() can let a
  // second click slip through if it lands before React re-renders.  A ref
  // updates synchronously, blocking the second invocation in the same tick.
  const downloadingRef = useRef(false);
  // Scope chooser — the Download button opens this instead of downloading
  // straight away, so the user picks full scene vs wall only.
  const [downloadChoiceOpen, setDownloadChoiceOpen] = useState(false);
  // Picking an option closes the dialog and then downloads.  Note this only
  // ever *reads* downloadingRef via downloadImage()'s own guard — simply
  // dismissing the dialog (ESC / backdrop / Cancel) never touches the lock, so
  // an abandoned dialog can't leave the button permanently stuck in "Preparing…".
  const runDownload = (mode) => {
    setDownloadChoiceOpen(false);
    downloadImage(mode);
  };

  // Build a human-friendly download filename from the live configSummary.
  // Format: "UniVicoustic - <Series> - <Category/Pattern> - <Size> - …  .png"
  // Sanitises filesystem-unfriendly chars and caps total length to keep the
  // saved name readable across OSes.
  // `mode` ('full' | 'wall') tags the file so the two exports of the same
  // configuration don't collide in the user's Downloads folder.  The suffix is
  // reserved out of the 180-char budget BEFORE slicing, otherwise a long
  // config would truncate the tag away and reintroduce the collision.
  const buildDownloadFilename = (mode = 'full') => {
    const sanitize = (s) =>
      String(s ?? '')
        .replace(/[<>:"/\\|?*]+/g, '')
        .replace(/[#+]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    const parts = ['UniVicoustic'];
    for (const entry of configSummary) {
      const v = sanitize(entry?.value);
      if (v) parts.push(v);
    }
    const suffix = mode === 'wall' ? ' - Wall' : '';
    const joined = parts.join(' - ').slice(0, 180 - suffix.length);
    return `${joined}${suffix}.png`;
  };

  // Compose the source image with a branded header strip showing the live
  // configuration. Accepts any image source loadable by <img> (data URL,
  // object URL, or absolute URL) and returns a new data URL with the header
  // stitched on top. Header height is computed to fit content so rows never
  // overflow regardless of how many configSummary entries are present.
  const composeWithHeader = async (imgSrc) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';

    // Kick off the logo fetch in parallel with the source image fetch. The
    // logo lives in /public so it's same-origin — no CORS dance needed, but
    // setting crossOrigin keeps the canvas un-tainted regardless.
    const logo = new Image();
    logo.crossOrigin = 'anonymous';
    logo.src = '/univicoustic-logo.png';
    const logoReady = new Promise((resolve) => {
      logo.onload = () => resolve(true);
      logo.onerror = () => resolve(false); // non-fatal — fall back to text
    });

    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = imgSrc;
    });
    const logoLoaded = await logoReady;

    // Scale font sizes proportionally to image width so they look right on
    // small (1200 px) and large (4000 px) source assets alike.
    const baseFont = Math.max(16, Math.floor(img.width * 0.014));
    const brandFontPx = Math.floor(baseFont * 2);
    const taglineFontPx = Math.floor(baseFont * 0.72);
    const rowFontPx = Math.floor(baseFont * 0.95);
    const rowGap = Math.floor(rowFontPx * 1.45);
    const SIDE_PAD = Math.max(32, Math.floor(img.width * 0.025));
    const PAD_V = Math.floor(baseFont * 1.4);

    const visibleLines = (configSummary || [])
      .map((e) => `${e.label}:  ${e.value}`)
      .slice(0, 10);

    // Heights of the two content blocks → header is the taller of the two
    // (plus vertical padding top + bottom).
    const brandBlockHeight = brandFontPx + Math.floor(brandFontPx * 0.3) + taglineFontPx;
    const rowsBlockHeight = visibleLines.length * rowGap;
    const HEADER_HEIGHT = Math.max(brandBlockHeight, rowsBlockHeight) + PAD_V * 2;

    const out = document.createElement('canvas');
    out.width = img.width;
    out.height = img.height + HEADER_HEIGHT;
    const ctx = out.getContext('2d');

    // Header background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, HEADER_HEIGHT);

    // ── Brand block (left, vertically centred) ────────────────────────────
    const brandCenterY = HEADER_HEIGHT / 2;
    if (logoLoaded && logo.naturalWidth > 0) {
      // Size the logo by HEIGHT to roughly match the previous text+tagline
      // stack, then cap WIDTH at 35% of image width so very wide source
      // images don't end up with an over-large logo.
      const logoAspect = logo.naturalWidth / logo.naturalHeight;
      let logoH = brandBlockHeight;
      let logoW = logoH * logoAspect;
      const maxLogoW = Math.floor(img.width * 0.35);
      if (logoW > maxLogoW) {
        logoW = maxLogoW;
        logoH = logoW / logoAspect;
      }
      const logoY = brandCenterY - logoH / 2;
      ctx.drawImage(logo, SIDE_PAD, logoY, logoW, logoH);
    } else {
      // Fallback: original text rendering (kept in case the logo asset is
      // ever moved/renamed without updating this path).
      ctx.fillStyle = '#1f2937';
      ctx.font = `700 ${brandFontPx}px Manrope, system-ui, -apple-system, "Segoe UI", sans-serif`;
      ctx.textBaseline = 'alphabetic';
      ctx.textAlign = 'left';
      const brandBaseline = brandCenterY - Math.floor(brandFontPx * 0.1);
      ctx.fillText('UNIVICOUSTIC', SIDE_PAD, brandBaseline);
      ctx.font = `500 ${taglineFontPx}px system-ui, sans-serif`;
      ctx.fillStyle = '#dc6e6e';
      ctx.fillText('makes sound sense', SIDE_PAD + 2, brandBaseline + taglineFontPx + 4);
    }

    // ── Config rows (right, vertically centred) ───────────────────────────
    ctx.fillStyle = '#374151';
    ctx.font = `500 ${rowFontPx}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    const rowsStartY = HEADER_HEIGHT / 2 - rowsBlockHeight / 2 + rowGap / 2;
    visibleLines.forEach((line, i) => {
      ctx.fillText(line, out.width - SIDE_PAD, rowsStartY + i * rowGap);
    });

    // Thin accent line separating header from image
    ctx.fillStyle = '#dc6e6e';
    ctx.fillRect(0, HEADER_HEIGHT - 3, out.width, 3);

    // Original image below header
    ctx.drawImage(img, 0, HEADER_HEIGHT);

    return out.toDataURL('image/png');
  };

  // `mode`: 'full' → the room scene as rendered; 'wall' → just the wall.
  // How "wall" is produced differs per family because the previews are built
  // differently — see each branch below.  Both modes get the branded header.
  const downloadImage = async (mode = 'full') => {
    // Ref check first — `downloading` state may not have re-rendered yet from
    // a previous click in the same tick.  The ref is the authoritative lock.
    if (downloadingRef.current) return;
    downloadingRef.current = true;
    // EVERYTHING below must be inside the try, so the `finally` block resets
    // `downloadingRef` no matter what.  An earlier version had `track()` and
    // `setDownloading(true)` above the try — if either threw, the ref stayed
    // `true` forever and the button became dead.
    try {
      // PRD 4.6: full config snapshot accompanies every download event.
      // config_url rides the existing analytics pipe (dataLayer → GTM → Brevo),
      // so a follow-up email can link straight back to this exact panel.
      track("download_clicked", {
        ...analyticsSnap(),
        download_scope: mode,
        config_url: buildConfigUrl(),
      });
      setDownloading(true);
      // Yield two animation frames before the heavy, main-thread-blocking
      // encode (toPng / toDataURL on a large canvas).  This lets React paint
      // the "Preparing…" state and lets the browser hand the spinner's CSS
      // transform animation to the compositor thread BEFORE the block starts —
      // so the spinner keeps rotating smoothly during the freeze instead of
      // stuttering for the first few rotations.
      await new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve))
      );
      const filename = buildDownloadFilename(mode);
      const wallOnly = mode === 'wall';

      // Signature Ombre: composite wall canvas + room overlay, then header.
      // Wall-only simply skips the room overlay, leaving the ombre wall.
      if (selectedProductType?.id === 'ombre' && selectedCategory?.id === 'signature-ombre') {
        const wallCanvas = document.querySelector('.so-room canvas');
        const overlayImg = document.querySelector('.so-room img');
        if (!wallCanvas) return;
        const out = document.createElement('canvas'); out.width = 2000; out.height = 2000;
        const ctx = out.getContext('2d');
        ctx.drawImage(wallCanvas, 0, 0, 2000, 2000);
        if (!wallOnly && overlayImg?.complete && overlayImg.naturalWidth) ctx.drawImage(overlayImg, 0, 0, 2000, 2000);
        let rawUrl = out.toDataURL('image/png');
        let finalUrl = rawUrl;
        try { finalUrl = await composeWithHeader(rawUrl); }
        catch (err) { console.error('[download] header compose failed:', err); }
        // Blob-based download — large data: URLs fail silently on mobile.
        saveImageFile(finalUrl, filename);
        return;
      }

      // VicStrip: unlike the CSS-layered previews, its on-screen image IS a
      // full-room JPG — the room is baked into the pixels and can't be
      // un-composited.  So wall-only serves the pre-cropped panel cutout that
      // already ships alongside it (the same asset the per-design "Download
      // Panel" buttons use).  If that asset is missing for this combination we
      // warn and fall through to the normal full-scene capture rather than
      // failing the download outright.
      if (wallOnly && selectedProductType?.id === 'vicstrip') {
        const slug = selectedPattern?.id;
        const colorId = selectedDesign?.color?.id;
        if (slug && colorId) {
          let objUrl = null;
          try {
            const cutoutUrl = `${ASSETS_URL}/static/images/vicstrip/panels/${slug}/${colorId}.jpg`;
            const res = await fetch(cutoutUrl, { mode: 'cors', credentials: 'omit', cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status} for ${cutoutUrl}`);
            const blob = await res.blob();
            objUrl = URL.createObjectURL(blob);
            // Blob URLs are same-origin, so composeWithHeader's canvas never
            // taints — no CORS dance needed here.
            const finalUrl = await composeWithHeader(objUrl);
            saveImageFile(finalUrl, filename);
            return;
          } catch (err) {
            console.warn('[download] VicStrip wall cutout unavailable, falling back to full scene:', err);
            toast.info('Wall-only image is not available for this VicStrip design — downloading the full scene instead.');
          } finally {
            if (objUrl) URL.revokeObjectURL(objUrl);
          }
        }
      }

      if (canvasRef.current) {
        // canvasRef.current.downloadImage(filename, addHeader, opts) may be
        // async — await so the button stays busy until the file saves.
        // Previews that don't composite a room (e.g. CanvasPreview) simply
        // ignore `wallOnly` and return their canvas as-is.
        await canvasRef.current.downloadImage(filename, composeWithHeader, { wallOnly });
      }
    } catch (err) {
      console.error('[download] failed:', err);
      toast.error('Could not generate the download. Please try again.');
    } finally {
      downloadingRef.current = false;
      setDownloading(false);
    }
  };

  // View Tech Specs — opens the right PDF for the current configuration.
  // Extracted so both the desktop header and the mobile sidebar button can call it.
  const handleViewTechSpecs = () => {
    track("tech_specs_viewed", analyticsSnap());
    const productId = selectedProductType?.id;
    const catId = selectedCategory?.id;

    const isPetWool = selectedThickness?.includes("PET Wool");
    const isEmbossedSurface = selectedSurfaceType === 'embossed';
    const isGroovingSurface = selectedSurfaceType === 'grooving';

    // ── Required-selection gate ───────────────────────────────────────────
    // Products that have a single fixed PDF (VicStrip; anything under the
    // Grooving surface) can open the spec without further selection — those
    // PDFs are product-line documents that don't vary by category/thickness.
    // Everything else (Flat/Embossed) needs both a category and (where
    // applicable) a thickness picked first; otherwise we'd fall through to
    // a default PDF that doesn't match the user's actual configuration.
    const hasFixedPdf = (productId === "vicstrip") || isGroovingSurface;
    if (!hasFixedPdf) {
      if (!selectedCategory) {
        toast.error("Please select a category first");
        return;
      }
      const needsThickness = (
        productId === "flat-embossed-vmd" ||
        productId === "wood" ||
        (productId === "fabrics" && catId !== "fabrics-color-core") ||
        (productId === "ombre" && catId === "signature-ombre")
      );
      if (needsThickness && !selectedThickness) {
        toast.error("Please select a thickness first");
        return;
      }
    }

    let pdfFile;
    // ── Priority overrides (checked before product-specific logic) ─────────
    // VicStrip always uses its own PDF, even under Grooving. SURFACE_SERIES_MAP
    // only puts VicStrip under Grooving, but we keep this explicit so the
    // intent survives any future surface-mapping change.
    if (productId === "vicstrip") {
      pdfFile = "Univic Strip Series.pdf";
    }
    // Any non-VicStrip product under the Grooving surface tab shares one PDF.
    // Today that's only Ombre (per SURFACE_SERIES_MAP); future products that
    // gain grooving will pick this up automatically.
    else if (isGroovingSurface) {
      pdfFile = "Groove series.pdf";
    }
    // ── Per-product logic (Flat / Embossed surfaces only) ─────────────────
    else if (productId === "flat-embossed-vmd") {
      pdfFile = isEmbossedSurface
        ? (isPetWool ? "Embossed VMT Series (PET WOOL).pdf" : "Embossed VMT Series (PET).pdf")
        : (isPetWool ? "Flat Panel VMT (PET WOOL).pdf" : "Flat Panel VMT (PET).pdf");
    } else if (productId === "wood") {
      if (catId === "wood-classic-parquet") {
        pdfFile = isPetWool ? "Flat Panel VMT (PET WOOL).pdf" : "Flat Panel VMT (PET).pdf";
      } else {
        pdfFile = isEmbossedSurface
          ? (isPetWool ? "Embossed VMT Series (PET WOOL).pdf" : "Embossed VMT Series (PET).pdf")
          : (isPetWool ? "Flat Panel VMT (PET WOOL).pdf" : "Flat Panel VMT (PET).pdf");
      }
    } else if (productId === "fabrics") {
      if (catId === "fabrics-color-core") {
        pdfFile = isEmbossedSurface ? "Embossed VMT Series (PET).pdf" : "Flat Panel VMT (PET).pdf";
      } else {
        pdfFile = isEmbossedSurface
          ? (isPetWool ? "Embossed VMT Series (PET WOOL).pdf" : "Embossed VMT Series (PET).pdf")
          : (isPetWool ? "Flat Panel VMT (PET WOOL).pdf" : "Flat Panel VMT (PET).pdf");
      }
    } else if (productId === "ombre") {
      // Grooving-surface Ombre is handled by the isGroovingSurface override
      // above, so this branch only sees Flat / Embossed surfaces.
      if (catId === "ombre-color-core-ombre") {
        pdfFile = isEmbossedSurface
          ? "Embossed VMT Series (PET).pdf"
          : "Flat Panel VMT (PET).pdf";
      } else {
        pdfFile = isPetWool ? "Embossed VMT Series (PET WOOL).pdf" : "Embossed VMT Series (PET).pdf";
      }
    } else {
      pdfFile = isPetWool ? "Flat Panel VMT (PET WOOL).pdf" : "Flat Panel VMT (PET).pdf";
    }
    window.open(`${ASSETS_URL}/static/technical_specification_pdfs/${encodeURIComponent(pdfFile)}`, "_blank");
  };

  // Reset configuration
  const resetConfig = () => {
    if (selectedProductType) {
      track("reset_clicked", analyticsSnap());
      handleProductTypeChange(selectedProductType.id);
      toast.success("Configuration reset");
    }
  };

  // Snapshot every piece of per-tab state into a plain object.  Called on
  // every tab switch so the outgoing tab's configuration is preserved.  The
  // setters are stable so this closure over state values captures "now".
  const captureTabState = () => ({
    selectedProductType,
    selectedCategory,
    selectedDesign,
    selectedSize,
    selectedDensity,
    selectedPattern,
    selectedColor,
    selectedThickness,
    selectedEmbossPattern,
    isEmbossed,
    showTpatti,
    selectedWoodPerfSize,
    selectedPerforation,
    selectedColorCoreColor,
    selectedFabricStructure,
    selectedColorCoreEmboss,
    selectedDTColorGroup,
    selectedDTShade,
    selectedDTFabric,
    selectedDTSize,
    selectedDTEmboss,
    selectedOmbreBaseColor,
    selectedOmbreOverlay,
    selectedOmbreEmbossPattern,
    selectedOmbreGroovePattern,
    ombreFinishType,
    soBaseColor,
    soOverlayColor,
    soBlend,
    soColorGroup,
    soSelectedPattern,
  });

  // The "fresh" snapshot used for first-time tab visits.  Mirrors every
  // useState initial value for the per-tab fields; keeping this list in sync
  // with captureTabState is the same obligation flagged up at the ref
  // declaration.  Used when the user opens a tab for the first time this
  // session — no series selected, no downstream state, nothing bleeding over
  // from whichever tab they were on before.
  const INITIAL_TAB_SNAPSHOT = {
    selectedProductType: null,
    selectedCategory: null,
    selectedDesign: null,
    selectedSize: null,
    selectedDensity: null,
    selectedPattern: null,
    selectedColor: null,
    selectedThickness: null,
    selectedEmbossPattern: null,
    isEmbossed: false,
    showTpatti: true,
    selectedWoodPerfSize: null,
    selectedPerforation: null,
    selectedColorCoreColor: null,
    selectedFabricStructure: null,
    selectedColorCoreEmboss: null,
    selectedDTColorGroup: null,
    selectedDTShade: null,
    selectedDTFabric: null,
    selectedDTSize: null,
    selectedDTEmboss: null,
    selectedOmbreBaseColor: null,
    selectedOmbreOverlay: null,
    selectedOmbreEmbossPattern: null,
    selectedOmbreGroovePattern: null,
    ombreFinishType: 'emboss',
    soBaseColor: '#ffffff',
    soOverlayColor: null,
    soBlend: 30,
    soColorGroup: 'Blue',
    soSelectedPattern: null,
  };

  // Restore a previously captured snapshot (or the fresh INITIAL_TAB_SNAPSHOT
  // for a first-visit tab).  React batches the setter calls inside this event
  // handler so the whole restore renders once.  `surfaceTypeForUrl` is the
  // surface tab the snapshot belongs to — needed for the new URL shape
  // `/:surfaceType/:productType`, since the snapshot itself is surface-
  // agnostic.
  const applyTabState = (snapshot, surfaceTypeForUrl, opts = {}) => {
    setSelectedProductType(snapshot.selectedProductType);
    setSelectedCategory(snapshot.selectedCategory);
    setSelectedDesign(snapshot.selectedDesign);
    setSelectedSize(snapshot.selectedSize);
    setSelectedDensity(snapshot.selectedDensity);
    setSelectedPattern(snapshot.selectedPattern);
    setSelectedColor(snapshot.selectedColor);
    setSelectedThickness(snapshot.selectedThickness);
    setSelectedEmbossPattern(snapshot.selectedEmbossPattern);
    setIsEmbossed(snapshot.isEmbossed);
    setShowTpatti(snapshot.showTpatti);
    setSelectedWoodPerfSize(snapshot.selectedWoodPerfSize);
    setSelectedPerforation(snapshot.selectedPerforation);
    setSelectedColorCoreColor(snapshot.selectedColorCoreColor);
    setSelectedFabricStructure(snapshot.selectedFabricStructure);
    setSelectedColorCoreEmboss(snapshot.selectedColorCoreEmboss);
    setSelectedDTColorGroup(snapshot.selectedDTColorGroup);
    setSelectedDTShade(snapshot.selectedDTShade);
    setSelectedDTFabric(snapshot.selectedDTFabric);
    setSelectedDTSize(snapshot.selectedDTSize);
    setSelectedDTEmboss(snapshot.selectedDTEmboss);
    setSelectedOmbreBaseColor(snapshot.selectedOmbreBaseColor);
    setSelectedOmbreOverlay(snapshot.selectedOmbreOverlay);
    setSelectedOmbreEmbossPattern(snapshot.selectedOmbreEmbossPattern);
    setSelectedOmbreGroovePattern(snapshot.selectedOmbreGroovePattern);
    setOmbreFinishType(snapshot.ombreFinishType);
    setSoBaseColor(snapshot.soBaseColor);
    setSoOverlayColor(snapshot.soOverlayColor);
    setSoBlend(snapshot.soBlend);
    setSoColorGroup(snapshot.soColorGroup);
    setSoSelectedPattern(snapshot.soSelectedPattern);

    // Auto-fix Alter Flute (DT) / Alter Flute (CC) + PET Wool conflict on restore.
    // Pattern wins per the configurator's compatibility rule, so we silently drop
    // PET Wool. Silent (no toast) since snapshot restore is internal Compare flow.
    const ccAlterflute = snapshot.selectedColorCoreEmboss?.id === 'alter_flute';
    const dtAlterflute = snapshot.selectedDTEmboss?.id === 'alterflute';
    if ((ccAlterflute || dtAlterflute) && snapshot.selectedThickness?.includes('PET Wool')) {
      setSelectedThickness(null);
    }

    // Sync the URL to match whatever the snapshot represents.  A snapshot
    // with a series → /<surface>/<slug>; a snapshot with no series (i.e.
    // the INITIAL_TAB_SNAPSHOT) → /<surface> (bare).
    // opts.skipNav: deep-link hydration passes this so the incoming URL (which
    // already carries the full combo as query params) is preserved — letting a
    // refresh re-hydrate instead of collapsing to the bare product path.
    if (!opts.skipNav) {
      const surface = surfaceTypeForUrl ?? selectedSurfaceType;
      if (snapshot.selectedProductType?.id) {
        const slug = PRODUCT_ID_TO_URL_SLUG[snapshot.selectedProductType.id] || snapshot.selectedProductType.id;
        navigate(`/${surface}/${slug}`);
      } else {
        navigate(`/${surface}`);
      }
    }
  };

  // ── Deep-link generation ────────────────────────────────────────────────
  // The inverse of buildDeepLinkSnapshot() below: turns the CURRENT selection
  // into a link that reopens it.  Attached to download_clicked so a follow-up
  // email can send the user straight back to the panel they downloaded.
  //
  // This must mirror the reader branch-for-branch — each product family reads
  // its own params, so a writer that only emitted the generic cat/size/print
  // set would produce links that silently drop the user on a half-configured
  // panel for VicStrip, Ombre, Color Core and Designer Textile.  If you add a
  // param to the reader, add it here in the same branch.
  const buildConfigUrl = () => {
    const product = selectedProductType;
    if (!product) return null; // nothing chosen yet — no link worth sending

    const slug = PRODUCT_ID_TO_URL_SLUG[product.id] || product.id;
    const params = new URLSearchParams();
    params.set("dl", "1");

    // URLSearchParams percent-encodes on toString(), which matters: thickness
    // values look like "25mm (PET Panel)" — raw spaces and parens would break
    // the link in most email clients.
    const put = (k, v) => { if (v !== null && v !== undefined && v !== "") params.set(k, String(v)); };

    const catId = selectedCategory?.id || null;
    put("cat", catId);
    put("size", selectedSize);
    put("thick", selectedThickness);
    if (showTpatti) params.set("tprofile", "1");

    if (product.id === "vicstrip") {
      // Pattern-driven: no category, colours hang off the pattern.
      params.delete("cat");
      put("pattern", selectedPattern?.id);
      put("color", selectedColor?.id);
    } else if (product.id === "ombre") {
      if (catId === "signature-ombre") {
        put("sooverlay", soOverlayColor);
        put("sopattern", soSelectedPattern?.id);
        put("soblend", soBlend);
      } else {
        put("obase", selectedOmbreBaseColor?.id);
        put("overlay", selectedOmbreOverlay?.hex);
        // The reader treats groove and emboss as mutually exclusive and checks
        // groove first, so emit only the one the current finish type means.
        if (ombreFinishType === "groove") put("ogroove", selectedOmbreGroovePattern?.id);
        else if (ombreFinishType === "emboss") put("oemboss", selectedOmbreEmbossPattern?.id);
      }
    } else if (product.id === "fabrics") {
      if (catId === "fabrics-color-core") {
        put("cccolor", selectedColorCoreColor?.id);
        put("ccstruct", selectedFabricStructure?.id);
        put("emboss", selectedColorCoreEmboss?.id);
      } else if (catId === "fabrics-designer-textile") {
        put("dtshade", selectedDTShade?.id);
        put("dtfabric", selectedDTFabric?.id);
        put("emboss", selectedDTEmboss?.id);
        // Designer Textile keeps its own size; the reader maps it from `size`.
        if (selectedDTSize) params.set("size", String(selectedDTSize));
      } else {
        put("print", selectedDesign?.id);
      }
    } else if (catId === "wood-perforations") {
      put("print", selectedDesign?.id);
      put("perf", selectedPerforation?.id);
      if (selectedWoodPerfSize) params.set("size", String(selectedWoodPerfSize));
    } else {
      // Bespoke Graphics + Wood (the default design-driven flow)
      put("print", selectedDesign?.id);
      put("emboss", selectedEmbossPattern?.id);
    }

    const path = `/${selectedSurfaceType}/${slug}`;
    // Absolute, so it survives being pasted into an email template.
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `${origin}${path}?${params.toString()}`;
  };

  // ── Deep-link hydration ─────────────────────────────────────────────────
  // Marketing links from other sites carry a full configuration as query
  // params (marker `dl=1`) on top of the /<surface>/<product> path, e.g.
  //   /flat/bespoke-graphics?dl=1&cat=vmd-leather&size=1200x2400&thick=...&print=vmd-design-lh-005&tprofile=1
  // On load we resolve those params into a state snapshot and apply it through
  // the SAME applyTabState() path the Save/Load + tab-switch flows use (with
  // skipNav so the URL — and thus refresh-ability — is preserved). The tour is
  // suppressed for deep-link loads (see AuthScreen.maybeStartTour + the boot
  // guard in public/univicoustic-tour.js) so it can't overwrite the combo.
  const deepLinkAppliedRef = useRef(false);

  const buildDeepLinkSnapshot = (params) => {
    const productId = productTypeParam
      ? (URL_SLUG_TO_PRODUCT_ID[productTypeParam] || productTypeParam)
      : null;
    const product = productId ? products.find((p) => p.id === productId) : null;
    if (!product) return null;

    const size = params.get("size") || null;
    const thick = params.get("thick") || null;
    const catId = params.get("cat") || null;
    const category = catId ? (product.categories || []).find((c) => c.id === catId) : null;
    const findDesign = (val) =>
      val && category ? (category.designs || []).find((d) => d.id === val || d.design_code === val) || null : null;

    const snap = {
      ...INITIAL_TAB_SNAPSHOT,
      selectedProductType: product,
      selectedCategory: category,
      selectedSize: size,
      selectedThickness: thick,
      showTpatti: params.get("tprofile") === "1",
    };

    // VicStrip — pattern-driven (patterns/colors come from VICSTRIP_PRODUCT,
    // not the fetched category tree).
    if (product.id === "vicstrip") {
      const pattern = VICSTRIP_PRODUCT.patterns.find((p) => p.id === params.get("pattern")) || null;
      const color = pattern ? (pattern.colors || []).find((c) => c.id === params.get("color")) || null : null;
      snap.selectedPattern = pattern;
      snap.selectedColor = color;
      snap.selectedDesign = pattern && color ? { pattern, color } : null;
      snap.selectedCategory = null;
      return { snapshot: snap, surface: surfaceTypeParam };
    }

    if (product.id === "ombre") {
      if (catId === "signature-ombre") {
        const hex = params.get("sooverlay") || null;
        snap.soOverlayColor = hex;
        snap.soSelectedPattern = SO_PATTERNS.find((p) => p.id === params.get("sopattern")) || null;
        snap.soBlend = Number(params.get("soblend")) || 30;
        const grp = SO_COLORS_BY_GROUP.find((g) => g.colors.some((c) => c.hex.toLowerCase() === (hex || "").toLowerCase()));
        if (grp) snap.soColorGroup = grp.group;
      } else {
        const obase = params.get("obase");
        snap.selectedOmbreBaseColor = OMBRE_COLOR_CORE_BASE_COLORS.find((b) => b.id === obase) || null;
        const overlayHex = (params.get("overlay") || "").toLowerCase();
        snap.selectedOmbreOverlay = (OMBRE_COLOR_CORE_OVERLAYS[obase] || []).find((o) => o.hex.toLowerCase() === overlayHex) || null;
        const groove = params.get("ogroove");
        const emboss = params.get("oemboss");
        if (groove) {
          snap.selectedOmbreGroovePattern = OMBRE_COLOR_CORE_GROOVE_PATTERNS.find((p) => p.id === groove) || null;
          snap.ombreFinishType = "groove";
        } else if (emboss) {
          snap.selectedOmbreEmbossPattern = OMBRE_COLOR_CORE_EMBOSS_PATTERNS.find((p) => p.id === emboss) || null;
          snap.ombreFinishType = "emboss";
        }
      }
      return { snapshot: snap, surface: surfaceTypeParam };
    }

    if (product.id === "fabrics") {
      if (catId === "fabrics-color-core") {
        snap.selectedColorCoreColor = COLOR_CORE_COLORS.find((c) => c.id === params.get("cccolor")) || null;
        snap.selectedFabricStructure = COLOR_CORE_FABRIC_STRUCTURES.find((s) => s.id === params.get("ccstruct")) || null;
        snap.selectedColorCoreEmboss = COLOR_CORE_EMBOSS_PATTERNS.find((e) => e.id === params.get("emboss")) || null;
      } else if (catId === "fabrics-designer-textile") {
        const shadeId = params.get("dtshade");
        const group = DESIGNER_TEXTILE_COLOR_GROUPS.find((g) => g.shades.some((s) => s.id === shadeId)) || null;
        snap.selectedDTColorGroup = group;
        snap.selectedDTShade = group ? group.shades.find((s) => s.id === shadeId) || null : null;
        snap.selectedDTFabric = DESIGNER_TEXTILE_FABRICS.find((f) => f.id === params.get("dtfabric")) || null;
        snap.selectedDTEmboss = DESIGNER_TEXTILE_EMBOSS_PATTERNS.find((e) => e.id === params.get("emboss")) || null;
        snap.selectedDTSize = size;
      } else {
        // Modern Corporate — design-based
        snap.selectedDesign = findDesign(params.get("print"));
      }
      return { snapshot: snap, surface: surfaceTypeParam };
    }

    // Bespoke Graphics (flat-embossed-vmd) + Wood
    if (catId === "wood-perforations") {
      snap.selectedDesign = findDesign(params.get("print"));
      snap.selectedWoodPerfSize = size;
      snap.selectedPerforation = WOOD_PERFORATION_PATTERNS.find((p) => p.id === params.get("perf")) || null;
    } else {
      snap.selectedDesign = findDesign(params.get("print"));
      const emb = params.get("emboss");
      if (emb) snap.selectedEmbossPattern = FLAT_EMBOSSED_EMBOSS_PATTERNS.find((e) => e.id === emb) || null;
    }
    return { snapshot: snap, surface: surfaceTypeParam };
  };

  useEffect(() => {
    if (loading || deepLinkAppliedRef.current || !products?.length) return;
    const params = new URLSearchParams(location.search);
    if (params.get("dl") !== "1") return;
    deepLinkAppliedRef.current = true;
    const result = buildDeepLinkSnapshot(params);
    if (!result?.snapshot) return;
    setSelectedSurfaceType(result.surface);
    applyTabState(result.snapshot, result.surface, { skipNav: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, products, location.search]);

  const handleSurfaceTypeChange = (surfaceType) => {
    if (surfaceType === selectedSurfaceType) return;
    track("product_type_selected", { from: selectedSurfaceType, to: surfaceType });

    // 1. Save the outgoing tab's state so a later visit can restore it.
    tabStatesRef.current[selectedSurfaceType] = captureTabState();

    // 2. Switch the active tab marker.
    setSelectedSurfaceType(surfaceType);

    // 3. Restore the incoming tab's saved state if we have one, otherwise
    //    fall through to the fresh INITIAL_TAB_SNAPSHOT so the new tab
    //    shows with no series selected and the URL becomes /<surface>.
    const snapshot = tabStatesRef.current[surfaceType] ?? INITIAL_TAB_SNAPSHOT;
    applyTabState(snapshot, surfaceType);
  };

  // Technical Specs Panel — defined outside Configurator (see below)
  // Using the module-level TechSpecsPanel component with specs passed as a prop.

  // ── placeholder so JSX below still works ──────────────────────────────────
  const techSpecsData = techSpecs || DEFAULT_SPECS[selectedProductType?.id] || {};

  if (!ENABLE_BOOT_WHITE_OVERLAY && loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <img src="/UV-loader.png" alt="Loading..." className="uv-loader" />
      </div>
    );
  }

  // Flat config summary { label, value, color? } used by BOTH the floating
  // mini cards on the canvas AND the "Request a Sample" modal — keeping the
  // two in sync as the configurator schema evolves.
  const configSummary = (() => {
    if (!selectedProductType) return [];
    const id = selectedProductType.id;
    const entries = [];
    entries.push({ label: 'Series', value: selectedProductType.name });

    if (id === 'vicstrip') {
      if (selectedPattern) {
        // The 600×600 "square" / "double-square" patterns are renamed in the
        // sidebar dropdown to "Single Groove" / "Double Groove".  In the info
        // cards we want the fully-qualified label so users can tell them apart
        // from the long-form Single/Double Groove patterns (which live on the
        // 600×2400 size).
        let patternLabel = selectedPattern.name;
        if (selectedPattern.id === 'square') patternLabel = 'Square Single Groove';
        else if (selectedPattern.id === 'double-square') patternLabel = 'Square Double Groove';
        entries.push({ label: 'Pattern', value: patternLabel });
      }
      if (selectedDesign?.color) entries.push({ label: 'Color', value: selectedDesign.color.name, color: selectedDesign.color.hex });
      if (selectedSize) entries.push({ label: 'Size', value: selectedSize });
      if (selectedThickness) entries.push({ label: 'Thickness', value: selectedThickness });
    } else if (id === 'ombre') {
      if (selectedCategory) entries.push({ label: 'Category', value: selectedCategory.name });
      if (selectedCategory?.id === 'signature-ombre') {
        if (selectedSize) entries.push({ label: 'Size', value: selectedSize });
        if (selectedThickness) entries.push({ label: 'Thickness', value: selectedThickness });
        entries.push({ label: 'Base', value: soBaseColor.toLowerCase() === '#ffffff' ? 'white' : soBaseColor, color: soBaseColor });
        if (soOverlayColor) entries.push({ label: 'Overlay', value: soCodeForHex(soOverlayColor), color: soOverlayColor });
        if (soSelectedPattern) entries.push({ label: 'Pattern', value: SO_PATTERNS.find(p => p.id === soSelectedPattern)?.name ?? soSelectedPattern });
        // Blend always has a value (default 30 = "30/70") — show the preset
        // label if known, else fall back to the raw "<n>% dark" string.
        {
          const blendLabel = SO_BLEND_PRESETS.find(p => p.value === soBlend)?.label ?? `${soBlend}% dark`;
          entries.push({ label: 'Blend', value: blendLabel });
        }
      } else {
        if (selectedOmbreBaseColor) entries.push({ label: 'Base Color', value: selectedOmbreBaseColor.name, color: selectedOmbreBaseColor.hex });
        if (selectedOmbreOverlay) entries.push({ label: 'Overlay', value: selectedOmbreOverlay.hex, color: selectedOmbreOverlay.hex });
        if (selectedOmbreEmbossPattern) entries.push({ label: 'Emboss', value: selectedOmbreEmbossPattern.name });
        if (selectedOmbreGroovePattern) entries.push({ label: 'Groove', value: selectedOmbreGroovePattern.name });
        if (selectedSize) entries.push({ label: 'Size', value: selectedSize });
        if (selectedThickness) entries.push({ label: 'Thickness', value: selectedThickness });
      }
    } else if (id === 'fabrics') {
      if (selectedCategory) entries.push({ label: 'Category', value: selectedCategory.name });
      if (selectedCategory?.id === 'fabrics-color-core') {
        if (selectedColorCoreColor) entries.push({ label: 'Color', value: selectedColorCoreColor.name, color: selectedColorCoreColor.hex });
        if (selectedFabricStructure) entries.push({ label: 'Texture', value: selectedFabricStructure.name });
        if (selectedColorCoreEmboss) entries.push({ label: 'Emboss', value: selectedColorCoreEmboss.name });
        if (selectedSize) entries.push({ label: 'Size', value: selectedSize });
      } else if (selectedCategory?.id === 'fabrics-designer-textile') {
        if (selectedDTShade) entries.push({ label: 'Shade', value: selectedDTShade.id.replace('_', ' '), color: selectedDTShade.hex });
        if (selectedDTFabric) entries.push({ label: 'Fabric', value: selectedDTFabric.name });
        if (selectedDTEmboss) entries.push({ label: 'Emboss', value: selectedDTEmboss.name });
        if (selectedDTSize) entries.push({ label: 'Size', value: selectedDTSize });
        if (selectedThickness) entries.push({ label: 'Thickness', value: selectedThickness });
      } else {
        if (selectedDesign) entries.push({ label: 'Design', value: selectedDesign.design_name || selectedDesign.design_code });
        if (selectedSize) entries.push({ label: 'Size', value: selectedSize });
        if (selectedThickness) entries.push({ label: 'Thickness', value: selectedThickness });
        if (selectedEmbossPattern) entries.push({ label: 'Emboss', value: selectedEmbossPattern.name });
      }
    } else {
      if (selectedCategory) entries.push({ label: 'Category', value: selectedCategory.name });
      if (selectedCategory?.id === 'wood-perforations') {
        if (selectedWoodPerfSize) entries.push({ label: 'Size', value: selectedWoodPerfSize });
        if (selectedDesign) entries.push({ label: 'Print', value: selectedDesign.design_name || selectedDesign.design_code });
        if (selectedPerforation) entries.push({ label: 'Perforation', value: selectedPerforation.name });
      } else {
        if (selectedDesign) entries.push({ label: 'Design', value: selectedDesign.design_name || selectedDesign.design_code });
        if (selectedSize) entries.push({ label: 'Size', value: selectedSize });
        if (selectedThickness) entries.push({ label: 'Thickness', value: selectedThickness });
        if (selectedEmbossPattern) entries.push({ label: 'Emboss', value: selectedEmbossPattern.name });
      }
    }

    if (selectedCategory?.id &&
        FLAT_EMBOSSED_VMT_CONFIG[selectedCategory.id]?.tpatti &&
        selectedSurfaceType !== 'embossed') {
      entries.push({ label: 'T-Profile', value: showTpatti ? 'On' : 'Off' });
    }

    return entries;
  })();

  return (
    <div className="configurator-root" data-testid="configurator-page">
      {/* Mobile block screen — temporarily disabled. Re-enable by uncommenting the block below. */}
      {/*
      <div className="md:hidden fixed inset-0 z-[999] bg-white flex flex-col items-center justify-center gap-4 p-8 text-center">
        <img src="/univicoustic-logo.png" alt="UniVicoustic" className="h-12 w-auto object-contain mb-2" />
        <p className="text-[hsl(215,25%,27%)] font-semibold text-lg leading-snug">
          Please open on a larger screen
        </p>
        <p className="text-[hsl(215,16%,50%)] text-sm leading-relaxed max-w-xs">
          The UniVicoustic configurator is designed for desktop use. For the best experience, open this on a laptop or desktop browser.
        </p>
      </div>
      */}

      {/* Full-page loading overlay — blocks all interaction while preview image is changing */}
      {(isImageLoading || dtPanelLoading || ccPanelLoading || ombrePanelLoading || fvpSingleLoading || fvpContinuousLoading || vicstripLoading) && (
        <div
          className="fixed inset-0 z-[200] cursor-not-allowed"
          aria-hidden="true"
        />
      )}

      {/* Mobile-only: jump-to-canvas FAB. Hidden on md+ via CSS,
          and auto-hidden on mobile once the canvas is in view. */}
      {!canvasInView && (
        <button
          type="button"
          className="view-preview-fab"
          onClick={() => {
            const el = document.querySelector('[data-testid="canvas-area"]');
            if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }}
          data-testid="view-preview-fab"
          aria-label="Scroll to preview"
        >
          <ArrowDown className="h-4 w-4" />
          View Preview
        </button>
      )}

      {/* ── TOP HEADER BAR ───────────────────────────────────────────────── */}
      <header className="app-header" data-testid="app-header">
        <div className="flex items-center gap-3 flex-shrink-0">
          <img
            src="/univicoustic-logo.png"
            alt="UniVicoustic"
            className="h-7 md:h-10 w-auto object-contain flex-shrink-0"
            data-testid="brand-logo"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={saveToFavorites}
            className="hidden md:inline-flex text-[hsl(215,25%,27%)] border-[hsl(var(--border))]"
            data-testid="save-favorite-btn"
          >
            <Heart className="h-4 w-4 mr-1.5" />
            Save
          </Button>
          <Button
            size="sm"
            onClick={() => setDownloadChoiceOpen(true)}
            disabled={downloading}
            className="hidden md:inline-flex bg-accent hover:bg-accent-hover text-white disabled:opacity-70 disabled:cursor-wait"
            data-testid="download-btn"
            title={downloading ? "Preparing your download…" : undefined}
          >
            {downloading ? (
              <>
                <span className="btn-spinner mr-1.5" aria-hidden="true" />
                Preparing…
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-1.5" />
                Download
              </>
            )}
          </Button>
          {/* Download scope chooser.  Radix renders nothing inline when closed
              (DialogContent portals to <body>), so sitting inside this flex
              header costs no layout.  Shared by the desktop + mobile buttons. */}
          <Dialog open={downloadChoiceOpen} onOpenChange={setDownloadChoiceOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>What would you like to download?</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-gray-600 -mt-2">
                Both options include the UniVicoustic header with your full configuration details.
              </p>
              <div className="grid gap-3 mt-2">
                <button
                  type="button"
                  onClick={() => runDownload('full')}
                  className="w-full text-left rounded-lg border border-gray-200 p-4 hover:border-accent hover:bg-accent/5 transition-colors"
                  data-testid="download-scope-full"
                >
                  <span className="block font-semibold text-gray-900">Full scene</span>
                  <span className="block text-sm text-gray-600 mt-0.5">
                    The complete room view with furniture, exactly as shown in the preview.
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => runDownload('wall')}
                  className="w-full text-left rounded-lg border border-gray-200 p-4 hover:border-accent hover:bg-accent/5 transition-colors"
                  data-testid="download-scope-wall"
                >
                  <span className="block font-semibold text-gray-900">Wall only</span>
                  <span className="block text-sm text-gray-600 mt-0.5">
                    Just the panel wall — no room or furniture. Ideal for renders and presentations.
                  </span>
                </button>
              </div>
            </DialogContent>
          </Dialog>
          {/* Request a Sample — hidden again. Modal + handler stay wired so
              re-enabling is a one-line change: swap `hidden` for `hidden md:inline-flex`. */}
          <Button
            variant="default"
            size="sm"
            onClick={() => setRequestSampleOpen(true)}
            disabled={!isConfigComplete}
            className="hidden bg-accent hover:bg-accent-hover text-white shadow-sm disabled:opacity-50"
            data-testid="request-sample-btn"
            title={isConfigComplete ? "Request a physical sample of this configuration" : "Complete all selections to request a sample"}
          >
            <Package className="h-4 w-4 mr-1.5" />
            Request a Sample
          </Button>
          <Button
            variant={compareMode ? 'default' : 'outline'}
            size="sm"
            onClick={toggleCompareMode}
            disabled={!selectedProductType}
            className={`hidden md:inline-flex ${compareMode
              ? "bg-accent hover:bg-accent-hover text-white"
              : "text-[hsl(215,25%,27%)] border-[hsl(var(--border))]"}`}
            data-testid="compare-btn"
            title={selectedProductType ? "Compare two configurations side-by-side" : "Pick a series first"}
          >
            <SplitSquareHorizontal className="h-4 w-4 mr-1.5" />
            {compareMode ? 'Close Compare' : 'Compare'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleViewTechSpecs}
            className="hidden md:inline-flex text-[hsl(215,25%,27%)]"
            data-testid="tech-spec-btn"
            title="View Tech Specs"
          >
            <FileText className="h-4 w-4 mr-1.5" />
            View Tech Specs
          </Button>
          {/* Replay tour button moved out of the top bar — now lives above the
              HDRI Studio Lighting widget over the canvas (search "Replay tour"
              near the HDRI lighting control). */}
          {/* Auth control. Logged out → "Sign in" button (routes to /login).
              Logged in → dropdown showing the user's email + a Logout item. */}
          {authUser ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="hidden md:inline-flex text-[hsl(215,25%,27%)] border-[hsl(var(--border))] px-2"
                  data-testid="user-menu-btn"
                  title={authUser.email}
                  aria-label={`Account menu for ${authUser.email}`}
                >
                  <User className="h-4 w-4 flex-shrink-0" />
                  <ChevronDown className="h-3.5 w-3.5 ml-1 flex-shrink-0 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] uppercase tracking-wider text-[hsl(215,16%,55%)]">Signed in as</span>
                    <span className="text-sm text-[hsl(215,25%,27%)] truncate">{authUser.email}</span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleLogout}
                  className="text-[hsl(215,25%,27%)] cursor-pointer"
                  data-testid="logout-btn"
                >
                  <LogOut className="h-4 w-4 mr-2" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigate("/login")}
              className="hidden md:inline-flex text-[hsl(215,25%,27%)] border-[hsl(var(--border))]"
              data-testid="sign-in-btn"
              title="Sign in or create an account"
            >
              <User className="h-4 w-4 mr-1.5" />
              Sign in
            </Button>
          )}
        </div>
      </header>

      {/* ── CONTENT ROW (sidebar + preview) ─────────────────────────────── */}
      <div className="configurator-content">
      {/* Sidebar */}
      <aside className="config-sidebar" data-testid="config-sidebar">
        <ScrollArea className="flex-1 min-h-0">
          <div className="flex flex-col" data-testid="config-options">
            {/* Product Type — Flat | Embossed | Grooving */}
            <div className="config-section space-y-2">
              <Label className="section-header">Product Type</Label>
              <div className="flex rounded-md overflow-hidden border border-[hsl(var(--border))]">
                {[
                  { id: 'flat', label: 'Flat' },
                  { id: 'embossed', label: 'Embossed' },
                  { id: 'grooving', label: 'Grooving' },
                ].map((st, idx, arr) => (
                  <button
                    key={st.id}
                    onClick={() => handleSurfaceTypeChange(st.id)}
                    className={`flex-1 py-2 text-sm font-medium transition-colors ${idx < arr.length - 1 ? 'border-r border-[hsl(var(--border))]' : ''} ${
                      selectedSurfaceType === st.id
                        ? 'bg-accent text-white'
                        : 'bg-[hsl(var(--background))] text-[hsl(var(--foreground))] hover:bg-[hsl(var(--secondary))]'
                    }`}
                    data-testid={`surface-type-${st.id}`}
                  >
                    {st.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Series — filtered by surface type */}
            {filteredSeries.length > 0 && (
              <div className="config-section space-y-2">
                <Label className="section-header">Series</Label>
                <Select value={selectedProductType?.id ?? ''} onValueChange={handleProductTypeChange}>
                  <SelectTrigger className="w-full" data-testid="series-trigger">
                    <SelectValue placeholder="Select series" />
                  </SelectTrigger>
                  <SelectContent>
                    {filteredSeries.map((product) => (
                      <SelectItem key={product.id} value={product.id} data-testid={`series-${product.id}`}>
                        {product.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* VicStrip Options */}
            {selectedProductType?.id === "vicstrip" && (
              <div className="flex flex-col">
                {/* Pattern Selection */}
                <div className="config-section space-y-2">
                  <Label className="section-header">Pattern</Label>
                  <Select value={selectedPattern?.id} onValueChange={handlePatternChange}>
                    <SelectTrigger className="w-full" data-testid="pattern-trigger">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {VICSTRIP_PRODUCT.patterns.filter(p => p.sizes.includes(selectedSize || "600x600")).map((pattern) => (
                        <SelectItem key={pattern.id} value={pattern.id} data-testid={`pattern-${pattern.id}`}>
                          {pattern.id === 'square' ? 'Single Groove' : pattern.id === 'double-square' ? 'Double Groove' : pattern.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Options Section (Size, Thickness) */}
                <div className="config-section space-y-2">
                  <Label className="section-header">Options</Label>
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <Label className="text-xs">Size</Label>
                      <Select value={selectedSize || ""} onValueChange={handleVicstripSizeChange}>
                        <SelectTrigger className="w-full" data-testid="size-trigger">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="600x600">600x600</SelectItem>
                          <SelectItem value="600x2400">600x2400</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex-1">
                      <Label className="text-xs">Thickness</Label>
                      <Select value={selectedThickness || ""} onValueChange={setSelectedThickness}>
                        <SelectTrigger className="w-full" data-testid="thickness-trigger">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <ThicknessSelectItem thickness="12mm (PET Panel)" productId={selectedProductType?.id} />
                          <ThicknessSelectItem thickness="25mm (PET Panel)" productId={selectedProductType?.id} />
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                {/* Designs Section (all colors as designs) */}
                <div className="config-section space-y-2">
                  <Label className="section-header">Designs</Label>
                  <div className="thumbnail-grid" data-testid="design-grid">
                      {(() => {
                        // Use the API category order from products.json for this pattern
                        const apiCategory = selectedProductType?.categories?.find(c => c.id === `vicstrip-${selectedPattern?.id}`);
                        const patternColors = selectedPattern?.colors || [];
                        const designs = (apiCategory?.designs?.length > 0)
                          ? apiCategory.designs.map((d) => {
                              // Find the matching COLORS entry by name first
                              // (canonical), falling back to the legacy
                              // design_code-index lookup only if the name
                              // isn't found.
                              const colorIdx = parseInt((d.design_code || '').replace('VCS-', ''), 10) - 1;
                              const color = patternColors.find(c => c.name === d.color_name) || patternColors[colorIdx] || null;
                              return {
                                id: `vicstrip-color-${color?.id || d.id}`,
                                product_type: 'vicstrip',
                                category: selectedPattern?.name,
                                design_code: d.design_code,
                                design_name: d.design_name,
                                texture_color: color?.hex || d.texture_color || d.color,
                                thumbnail_url: d.thumbnail_url || getVicstripThumbnailUrl(selectedPattern?.id, d.design_code),
                                color_name: color?.name || d.color_name,
                                pattern: selectedPattern?.name,
                                color: color,
                              };
                            })
                          : patternColors.map((c, i) => {
                              const code = VICSTRIP_COLOR_TO_CODE[c.id] || `VCS-${(i+1).toString().padStart(4,'0')}`;
                              return {
                                id: `vicstrip-color-${c.id || i}`,
                                product_type: 'vicstrip',
                                category: selectedPattern?.name,
                                design_code: code,
                                design_name: `${selectedPattern?.name} - ${c.name}`,
                                texture_color: c.hex,
                                thumbnail_url: getVicstripThumbnailUrl(selectedPattern?.id || selectedPattern?.name, code),
                                color_name: c.name,
                                pattern: selectedPattern?.name,
                                color: c,
                              };
                            });

                        return designs.map((design) => (
                          <DesignThumbnail
                            key={design.id}
                            design={design}
                            isSelected={selectedDesign?.id === design.id || selectedDesign?.color?.hex === design.texture_color}
                            onSelect={handleDesignSelect}
                          />
                        ));
                      })()}
                    </div>
                  {selectedDesign && (
                    <div className="p-3 bg-[hsl(var(--secondary))] rounded-lg mt-2">
                      <p className="font-medium text-sm">{selectedDesign.color.name}</p>
                      {/* <p className="text-xs text-[hsl(215,16%,47%)]">{selectedDesign.color.hex}</p> */}
                    </div>
                  )}
                </div>
              </div>
            )}
            
            {/* Flat Embossed VMT Options */}
            {(selectedProductType?.id === "flat-embossed-vmd" || selectedProductType?.id === "wood" || selectedProductType?.id === "fabrics") && (
              <div className="flex flex-col">
                {/* 1. Category — filtered by surface type; shown first so size/thickness can be category-aware */}
                {filteredCategories.length > 0 && (
                  <div className="config-section space-y-2">
                    <Label className="section-header">Category</Label>
                    <Select value={selectedCategory?.id} onValueChange={handleCategoryChange} data-testid="category-select">
                      <SelectTrigger className="w-full" data-testid="category-trigger">
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        {filteredCategories.map((category) => (
                          <SelectItem key={category.id} value={category.id} data-testid={`category-${category.id}`}>
                            {category.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {/* T-Patti toggle — hidden on the Embossed surface
                        across all series (the embossed pattern is itself
                        the visual interest; an extra T-Profile overlay
                        isn't a finishing option for any embossed series). */}
                    {selectedCategory?.id &&
                      FLAT_EMBOSSED_VMT_CONFIG[selectedCategory.id]?.tpatti &&
                      selectedSurfaceType !== 'embossed' && (
                      <div className="flex items-center justify-between mt-3 p-3 bg-[hsl(var(--secondary))] rounded-lg">
                        <Label htmlFor="tpatti-toggle" className="text-sm font-medium">T-Profile Overlay</Label>
                        <Switch id="tpatti-toggle" checked={showTpatti} onCheckedChange={setShowTpatti} data-testid="tpatti-toggle" />
                      </div>
                    )}
                  </div>
                )}

                {/* 2. Size — only shown after a category is selected */}
                {selectedCategory && selectedProductType?.sizes?.length > 0 && selectedCategory?.id !== "wood-perforations" && selectedCategory?.id !== "fabrics-color-core" && selectedCategory?.id !== "fabrics-designer-textile" && (
                  <div className="config-section space-y-2">
                    <Label className="section-header">Size</Label>
                    <Select value={selectedSize || ""} onValueChange={setSelectedSize} data-testid="size-select">
                      <SelectTrigger className="w-full" data-testid="size-trigger">
                        <SelectValue placeholder="Select size" />
                      </SelectTrigger>
                      <SelectContent>
                        {(() => {
                          // Embossed Leather gets the 600-series sizes appended to whatever
                          // the product declares — other categories under flat-embossed-vmd
                          // (Marble, Nature Reimagined, etc.) keep the default set.
                          const baseSizes = selectedProductType.sizes;
                          const extraSizes = (selectedCategory?.id === 'vmd-leather' && selectedSurfaceType === 'embossed')
                            ? ['600x600', '600x1200']
                            : [];
                          const sizes = [...baseSizes, ...extraSizes];
                          return sizes.filter(isSizeAllowedForSurface).map((size) => (
                            <SelectItem key={size} value={size} data-testid={`size-${size}`}>{size}</SelectItem>
                          ));
                        })()}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* 3. Thickness — only shown after a category is selected */}
                {selectedCategory && selectedProductType?.thicknesses?.length > 0 && selectedCategory?.id !== "fabrics-designer-textile" && (
                  <div className="config-section space-y-2">
                    <Label className="section-header">Thickness</Label>
                    <Select value={selectedThickness || ""} onValueChange={setSelectedThickness} data-testid="thickness-select">
                      <SelectTrigger className="w-full" data-testid="thickness-trigger">
                        <SelectValue placeholder="Select thickness" />
                      </SelectTrigger>
                      <SelectContent>
                        {selectedProductType.thicknesses
                          .filter((t) => !(selectedCategory?.id === "fabrics-color-core" && t.includes("PET Wool")))
                          .map((thickness) => (
                            <ThicknessSelectItem key={thickness} thickness={thickness} productId={selectedProductType?.id} />
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* 4. Size — only for Wood Perforations (category-level, gates the print grid) */}
                {selectedCategory?.id === "wood-perforations" && (
                  <div className="config-section space-y-2">
                    <Label className="section-header">Size</Label>
                    <Select value={selectedWoodPerfSize || ""} onValueChange={(v) => { setSelectedWoodPerfSize(v); setSelectedPerforation(null); }} data-testid="wood-perf-size-select">
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select size" />
                      </SelectTrigger>
                      <SelectContent>
                        {WOOD_PERFORATION_SIZES.map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Emboss (moved above the Print/colour ladder so users pre-select emboss).
                   Color Core / Designer Textile have their OWN emboss sections inside their
                   own branches — the guard below excludes them so we don't render two.
                   Tiles are gated to the patterns the *category* supports (the union of
                   available_emboss across all its designs) — Wood Classics for example
                   only supports 4 of the 9 master patterns, so we show 4. Once a design
                   is picked, narrow further to that design's own supported patterns. */}
                {selectedCategory?.emboss_available && selectedSurfaceType !== 'flat' && selectedCategory?.id !== "fabrics-color-core" && selectedCategory?.id !== "fabrics-designer-textile" && (() => {
                  const availableEmbossIds = selectedDesign?.available_emboss ?? [];
                  // Hide entirely if a design is picked and it has no emboss options.
                  if (selectedDesign && availableEmbossIds.length === 0) return null;
                  // No design yet → use the union across the category's designs.
                  // Design picked → use that design's own list.
                  const categoryEmbossIds = selectedDesign
                    ? availableEmbossIds
                    : Array.from(new Set((selectedCategory?.designs ?? []).flatMap(d => d.available_emboss ?? [])));
                  // Leather has its own size-driven emboss matrix (LEATHER_EMBOSS_BY_SIZE)
                  // that overrides per-design available_emboss.  Other Bespoke Graphics
                  // categories (Marble, Nature Reimagined) still use available_emboss.
                  let patternsToShow;
                  if (selectedCategory?.id === 'vmd-leather') {
                    const allowedIds = (selectedSize && LEATHER_EMBOSS_BY_SIZE[selectedSize]) || [];
                    patternsToShow = allowedIds
                      .map(id => FLAT_EMBOSSED_EMBOSS_PATTERNS.find(p => p.id === id))
                      .filter(Boolean);
                  } else {
                    patternsToShow = FLAT_EMBOSSED_EMBOSS_PATTERNS.filter(p => categoryEmbossIds.includes(p.id));
                  }
                  // Category has zero embossable designs → hide section entirely.
                  if (patternsToShow.length === 0) return null;
                  return (
                    <div className="config-section space-y-2">
                      <Label className="section-header">Emboss</Label>
                      <div className="thumbnail-grid" data-testid="emboss-grid">
                        {patternsToShow.map(pattern => (
                          <EmbossThumbnail
                            key={pattern.id}
                            pattern={pattern}
                            isSelected={selectedEmbossPattern?.id === pattern.id}
                            onSelect={handleEmbossPatternSelect}
                          />
                        ))}
                      </div>
                      {selectedEmbossPattern && (
                        <div className="mt-2 p-3 bg-[hsl(var(--secondary))] rounded-lg">
                          <p className="font-medium text-sm">{selectedEmbossPattern.name}</p>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* 3. Print / Designer Textile Sections */}
                {selectedCategory?.id === "fabrics-color-core" ? (
                  <>

                    {/* Color Core: Size */}
                    <div className="config-section space-y-2">
                      <Label className="section-header">Size</Label>
                      <Select value={selectedSize || ""} onValueChange={(v) => { setSelectedSize(v); setSelectedColorCoreEmboss(null); }} data-testid="color-core-size-select">
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select size" />
                        </SelectTrigger>
                        <SelectContent>
                          {COLOR_CORE_SIZES.filter(isSizeAllowedForSurface).map((s) => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Color Core: Emboss (moved above colours so users pre-select emboss; selection survives across colour changes) */}
                    {selectedSurfaceType !== 'flat' && (
                      <div className="config-section space-y-2">
                        <Label className="section-header">Emboss</Label>
                        <div className="thumbnail-grid" data-testid="color-core-emboss-grid">
                          {COLOR_CORE_EMBOSS_PATTERNS
                            .filter(pattern => !selectedSize || pattern.availableSizes.includes(selectedSize))
                            .filter(pattern => isEmbossAvailableForThickness(pattern, selectedThickness))
                            .map(pattern => (
                              <EmbossThumbnail
                                key={pattern.id}
                                pattern={pattern}
                                isSelected={selectedColorCoreEmboss?.id === pattern.id}
                                onSelect={(p) => {
                                  const next = selectedColorCoreEmboss?.id === p.id ? null : p;
                                  setSelectedColorCoreEmboss(next);
                                  // Alter Flute can't coexist with PET Wool — pattern wins.
                                  // PET Wool is hidden from Color Core's thickness dropdown today, so this
                                  // is defensive against snapshot/favorite restores.
                                  if (next?.id === "alter_flute" && selectedThickness?.includes("PET Wool")) {
                                    setSelectedThickness(null);
                                    toast.info("PET Wool isn't available with Alter Flute — thickness cleared");
                                  }
                                }}
                              />
                            ))
                          }
                        </div>
                        {selectedColorCoreEmboss && (
                          <div className="mt-2 p-3 bg-[hsl(var(--secondary))] rounded-lg flex items-center justify-between">
                            <p className="font-medium text-sm">{selectedColorCoreEmboss.name}</p>
                            <button onClick={() => setSelectedColorCoreEmboss(null)} className="text-xs text-[hsl(215,16%,47%)] hover:text-red-500 ml-4">Clear</button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Color Core: Base Color swatches */}
                    <div className="config-section space-y-2">
                      <Label className="section-header">Base Color</Label>
                      <div className="grid grid-cols-5 gap-2">
                        {COLOR_CORE_COLORS.map((color) => (
                          <HoverCard key={color.id} openDelay={200} closeDelay={100}>
                            <HoverCardTrigger asChild>
                              <button
                                title={color.name}
                                onClick={() => setSelectedColorCoreColor(color)}
                                className={`relative aspect-square rounded border-2 transition-colors ${
                                  selectedColorCoreColor?.id === color.id
                                    ? "border-accent"
                                    : "border-transparent hover:border-[hsl(215,16%,47%)]"
                                }`}
                                style={{ backgroundColor: color.hex }}
                                data-testid={`color-core-color-${color.id}`}
                                data-uv-selected={selectedColorCoreColor?.id === color.id}
                              />
                            </HoverCardTrigger>
                            <HoverCardContent side="right" align="start" className="w-48 p-0 overflow-hidden">
                              <div className="h-24 w-full" style={{ backgroundColor: color.hex }} />
                              <div className="p-3 space-y-1">
                                <p className="font-manrope font-bold text-sm">{color.name}</p>
                              </div>
                            </HoverCardContent>
                          </HoverCard>
                        ))}
                      </div>
                    </div>

                    {/* Color Core: Fabric Structure grid */}
                    <Accordion type="single" collapsible defaultValue="fabric-structure" className="config-accordion-wrapper">
                      <AccordionItem value="fabric-structure" className="border-0 px-4">
                        <AccordionTrigger className="section-header py-3">Fabric Texture</AccordionTrigger>
                        <AccordionContent className="pb-4">
                          <div className="thumbnail-grid" data-testid="fabric-structure-grid">
                            {COLOR_CORE_FABRIC_STRUCTURES.map((structure) => {
                              const thumbUrl = getColorCoreThumbnailUrl(structure.id, selectedColorCoreColor?.id ?? COLOR_CORE_COLORS[0].id);
                              const panelUrl = getColorCorePanelUrl(structure.id, selectedColorCoreColor?.id ?? COLOR_CORE_COLORS[0].id);
                              const isSelected = selectedFabricStructure?.id === structure.id;
                              const colorName = selectedColorCoreColor?.name ?? COLOR_CORE_COLORS[0].name;
                              const handleDownloadPanel = async (e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                if (!panelUrl) return;
                                try {
                                  const res = await fetch(panelUrl, { cache: 'no-store' });
                                  if (!res.ok) throw new Error(`HTTP ${res.status}`);
                                  const blob = await res.blob();
                                  const blobUrl = URL.createObjectURL(blob);
                                  const link = document.createElement('a');
                                  link.download = `UniVicoustic - Color Core - ${structure.name} - ${colorName}.jpg`;
                                  link.href = blobUrl;
                                  link.click();
                                  setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
                                } catch (err) {
                                  console.error('[ColorCore panel download] failed:', err);
                                  toast.error('Could not download this panel. Please try again.');
                                }
                              };
                              return (
                                <HoverCard key={structure.id} openDelay={200} closeDelay={100}>
                                  <HoverCardTrigger asChild>
                                    <button
                                      onClick={() => setSelectedFabricStructure(structure)}
                                      className={`relative aspect-square rounded overflow-hidden border-2 transition-colors ${isSelected ? "border-accent" : "border-transparent hover:border-[hsl(215,16%,47%)]"}`}
                                      data-testid={`fabric-structure-${structure.id}`}
                                      data-uv-selected={isSelected}
                                    >
                                      <img
                                        src={thumbUrl}
                                        alt={structure.name}
                                        className="absolute inset-0 w-full h-full object-cover"
                                      />
                                    </button>
                                  </HoverCardTrigger>
                                  <HoverCardContent side="right" align="start" className="w-56 p-0 overflow-hidden">
                                    <div className="relative w-full h-40 overflow-hidden">
                                      <img
                                        src={thumbUrl}
                                        alt={structure.name}
                                        className="absolute inset-0 w-full h-full object-cover"
                                      />
                                    </div>
                                    <div className="px-4 py-3 space-y-2">
                                      <div>
                                        <p className="font-manrope font-bold text-sm">{structure.name}</p>
                                        <p className="text-xs text-[hsl(215,16%,47%)] mt-0.5">Fabric Texture</p>
                                      </div>
                                      <div className="flex items-center gap-2 pt-2 border-t">
                                        <Button
                                          variant="outline"
                                          size="sm"
                                          className="mt-2"
                                          onClick={handleDownloadPanel}
                                          data-testid={`fabric-structure-download-${structure.id}`}
                                        >
                                          <Download className="h-4 w-4 mr-1" />
                                          Download Panel
                                        </Button>
                                      </div>
                                    </div>
                                  </HoverCardContent>
                                </HoverCard>
                              );
                            })}
                          </div>
                          {selectedFabricStructure && (
                            <div className="mt-3 p-3 bg-[hsl(var(--secondary))] rounded-lg">
                              <p className="font-medium text-sm">{selectedFabricStructure.name}</p>
                            </div>
                          )}
                        </AccordionContent>
                      </AccordionItem>
                    </Accordion>

                  </>
                ) : selectedCategory?.id === "fabrics-designer-textile" ? (
                  <>
                    {/* Designer Textile: 1. Size */}
                    <div className="config-section space-y-2">
                      <Label className="section-header">Size</Label>
                      <Select value={selectedDTSize || ""} onValueChange={(v) => { setSelectedDTSize(v); setSelectedDTEmboss(prev => prev && !prev.availableSizes.includes(v) ? null : prev); }} data-testid="dt-size-select">
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select size" />
                        </SelectTrigger>
                        <SelectContent>
                          {DESIGNER_TEXTILE_SIZES.filter(s => isSizeAllowedForSurface(s.id)).map((s) => (
                            <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Designer Textile: 2. Thickness */}
                    <div className="config-section space-y-2">
                      <Label className="section-header">Thickness</Label>
                      <Select value={selectedThickness || ""} onValueChange={setSelectedThickness} data-testid="dt-thickness-select">
                        <SelectTrigger className="w-full">
                          <SelectValue placeholder="Select thickness" />
                        </SelectTrigger>
                        <SelectContent>
                          {DESIGNER_TEXTILE_THICKNESSES.map((t) => (
                            <ThicknessSelectItem
                              key={t}
                              thickness={t}
                              testIdPrefix="dt-thickness"
                              productId={selectedProductType?.id}
                              disabled={t === "PET Wool" && selectedDTEmboss?.id === "alterflute"}
                              disabledReason="Not available with Alter Flute emboss"
                            />
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Designer Textile: Emboss (moved above colour so users pre-select emboss; selection survives across colour/fabric changes) */}
                    {selectedSurfaceType !== 'flat' && (
                      <div className="config-section space-y-2">
                        <Label className="section-header">Emboss</Label>
                        <div className="thumbnail-grid" data-testid="dt-emboss-grid">
                          {DESIGNER_TEXTILE_EMBOSS_PATTERNS
                            .filter(pattern => !selectedDTSize || pattern.availableSizes.includes(selectedDTSize))
                            .filter(pattern => isEmbossAvailableForThickness(pattern, selectedThickness))
                            .map(pattern => (
                              <EmbossThumbnail
                                key={pattern.id}
                                pattern={pattern}
                                isSelected={selectedDTEmboss?.id === pattern.id}
                                onSelect={(p) => {
                                  const next = selectedDTEmboss?.id === p.id ? null : p;
                                  setSelectedDTEmboss(next);
                                  // Alter Flute can't coexist with PET Wool — pattern wins.
                                  if (next?.id === "alterflute" && selectedThickness?.includes("PET Wool")) {
                                    setSelectedThickness(null);
                                    toast.info("PET Wool isn't available with Alter Flute — thickness cleared");
                                  }
                                }}
                              />
                            ))
                          }
                        </div>
                        {selectedDTEmboss && (
                          <div className="mt-2 p-3 bg-[hsl(var(--secondary))] rounded-lg flex items-center justify-between">
                            <p className="font-medium text-sm">{selectedDTEmboss.name}</p>
                            <button onClick={() => setSelectedDTEmboss(null)} className="text-xs text-[hsl(215,16%,47%)] hover:text-red-500 ml-4">Clear</button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Designer Textile: 3. Color — all groups + shades in one compact card */}
                    <div className="config-section space-y-3">
                      <Label className="section-header">Color</Label>
                      {DESIGNER_TEXTILE_COLOR_GROUPS.map((group) => (
                        <div key={group.id}>
                          <p className="text-[10px] font-semibold text-[hsl(215,16%,47%)] uppercase tracking-wider mb-1.5">{group.name}</p>
                          <div className="grid grid-cols-5 gap-2">
                            {group.shades.map((shade) => (
                              <HoverCard key={shade.id} openDelay={200} closeDelay={100}>
                                <HoverCardTrigger asChild>
                                  <button
                                    title={shade.id.replace('_', ' ')}
                                    onClick={() => {
                                      setSelectedDTColorGroup(group);
                                      setSelectedDTShade(shade);
                                      // Reset fabric to first one that supports this color group
                                      const firstAvailable = DESIGNER_TEXTILE_FABRICS.find(f => f.supportedColorGroups.includes(group.id));
                                      setSelectedDTFabric(firstAvailable ?? DESIGNER_TEXTILE_FABRICS[0]);
                                    }}
                                    className={`aspect-square rounded border-2 transition-colors ${
                                      selectedDTShade?.id === shade.id
                                        ? "border-accent scale-110"
                                        : "border-transparent hover:border-[hsl(215,16%,47%)]"
                                    }`}
                                    style={{ backgroundColor: shade.hex }}
                                    data-testid={`dt-shade-${shade.id}`}
                                    data-uv-selected={selectedDTShade?.id === shade.id}
                                  />
                                </HoverCardTrigger>
                                <HoverCardContent side="right" align="start" className="w-44 p-0 overflow-hidden">
                                  <div className="h-20 w-full" style={{ backgroundColor: shade.hex }} />
                                  <div className="p-3 space-y-1">
                                    <p className="font-manrope font-bold text-sm">{group.name}</p>
                                    <p className="text-xs text-[hsl(215,16%,47%)]">{shade.id.replace('_', ' ')}</p>
                                  </div>
                                </HoverCardContent>
                              </HoverCard>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Designer Textile: 4. Fabric Texture — live thumbnails, cannot unselect */}
                    <div className="config-section space-y-2">
                      <Label className="section-header">Fabric Texture</Label>
                      {!selectedDTShade ? (
                        <p className="text-sm text-[hsl(215,16%,47%)]">Select a shade above to view fabric textures.</p>
                      ) : (
                        <>
                          <div className="grid grid-cols-3 gap-2" data-testid="dt-fabric-grid">
                            {DESIGNER_TEXTILE_FABRICS
                              .filter(f => !selectedDTColorGroup || f.supportedColorGroups.includes(selectedDTColorGroup.id))
                              .map((fabric) => {
                                const isSelected = selectedDTFabric?.id === fabric.id;
                                const thumbUrl = getDesignerTextileThumbnailUrl(fabric.id, selectedDTShade?.id);
                                // Use the high-res panel image for the grid tile and crop with
                                // object-fit: none so we display source pixels at 1:1 (a true
                                // crop, not an upscale of the low-res thumbnail).
                                const panelUrl = getDesignerTextilePanelUrl(fabric.id, selectedDTShade?.id);
                                const handleDownloadPanel = async (e) => {
                                  e.stopPropagation();  // don't trigger fabric selection
                                  e.preventDefault();
                                  if (!panelUrl) return;
                                  try {
                                    const res = await fetch(panelUrl, { cache: 'no-store' });
                                    if (!res.ok) throw new Error(`HTTP ${res.status}`);
                                    const blob = await res.blob();
                                    const blobUrl = URL.createObjectURL(blob);
                                    const link = document.createElement('a');
                                    link.download = `UniVicoustic - Designer Textile - ${fabric.name} - ${selectedDTShade?.id.replace('_', ' ') || ''}.jpg`;
                                    link.href = blobUrl;
                                    link.click();
                                    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
                                  } catch (err) {
                                    console.error('[DT panel download] failed:', err);
                                    toast.error('Could not download this panel. Please try again.');
                                  }
                                };
                                return (
                                  <HoverCard key={fabric.id} openDelay={200} closeDelay={100}>
                                    <HoverCardTrigger asChild>
                                      <button
                                        title={fabric.name}
                                        onClick={() => setSelectedDTFabric(fabric)}
                                        className={`relative aspect-square rounded overflow-hidden border-2 transition-colors ${
                                          isSelected ? "border-accent" : "border-transparent hover:border-[hsl(215,16%,47%)]"
                                        }`}
                                        data-testid={`dt-fabric-${fabric.id}`}
                                        data-uv-selected={isSelected}
                                      >
                                        <img
                                          src={panelUrl}
                                          alt={fabric.name}
                                          className="absolute inset-0 w-full h-full object-cover"
                                          style={{ transform: 'scale(12)', transformOrigin: 'center' }}
                                        />
                                        <span className="absolute bottom-0 left-0 right-0 text-[10px] text-center font-semibold text-white bg-black/40 py-0.5">
                                          {fabric.name}
                                        </span>
                                      </button>
                                    </HoverCardTrigger>
                                    <HoverCardContent side="right" align="start" className="w-56 p-0 overflow-hidden">
                                      <div className="relative w-full h-40 overflow-hidden">
                                        <img
                                          src={panelUrl}
                                          alt={fabric.name}
                                          className="absolute inset-0 w-full h-full object-cover"
                                          style={{ transform: 'scale(12)', transformOrigin: 'center' }}
                                        />
                                      </div>
                                      <div className="px-4 py-3 space-y-2">
                                        <div>
                                          <p className="font-manrope font-bold text-sm">{fabric.name}</p>
                                          <p className="text-xs text-[hsl(215,16%,47%)] mt-0.5">Fabric Texture</p>
                                        </div>
                                        <div className="flex items-center gap-2 pt-2 border-t">
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            className="mt-2"
                                            onClick={handleDownloadPanel}
                                            data-testid={`dt-fabric-download-${fabric.id}`}
                                          >
                                            <Download className="h-4 w-4 mr-1" />
                                            Download Panel
                                          </Button>
                                        </div>
                                      </div>
                                    </HoverCardContent>
                                  </HoverCard>
                                );
                              })
                            }
                          </div>
                          {selectedDTFabric && (
                            <p className="text-xs text-[hsl(215,16%,47%)] pt-0.5">{selectedDTFabric.name} selected</p>
                          )}
                        </>
                      )}
                    </div>

                  </>
                ) : selectedCategory?.id === "wood-perforations" && !selectedWoodPerfSize ? (
                    <div className="config-section">
                      <p className="section-header mb-1">Print</p>
                      <p className="text-sm text-[hsl(215,16%,47%)]">Select a size above to view available prints.</p>
                    </div>
                ) : filteredDesigns.length > 0 ? (
                  <Accordion type="single" collapsible defaultValue="print" className="config-accordion-wrapper">
                    <AccordionItem value="print" className="border-0 px-4">
                      <AccordionTrigger className="section-header py-3">Print</AccordionTrigger>
                      <AccordionContent className="pb-4">
                        <div className="thumbnail-grid" data-testid="design-grid">
                          {filteredDesigns.map((design) => (
                            <DesignThumbnail
                              key={design.id}
                              design={design}
                              isSelected={selectedDesign?.id === design.id}
                              onSelect={handleDesignSelect}
                            />
                          ))}
                        </div>
                        {selectedDesign && (
                          <div className="mt-3 p-3 bg-[hsl(var(--secondary))] rounded-lg">
                            <p className="font-medium text-sm">{selectedDesign.design_name}</p>
                            <p className="text-xs text-[hsl(215,16%,47%)]">{selectedDesign.design_code}</p>
                          </div>
                        )}
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                ) : (selectedSurfaceType === 'embossed' && !selectedEmbossPattern?.id) ? (
                  /* Emboss-first flow on the Embossed surface: panel grid is
                     gated on an emboss pick.  Show a hint instead of an
                     empty grid so the user knows what to do next. */
                  <div className="config-section">
                    <p className="section-header mb-1">Print</p>
                    <p className="text-sm text-[hsl(215,16%,47%)]">
                      Pick an emboss pattern above to see compatible prints.
                    </p>
                  </div>
                ) : null}

                {/* 3b. Perforation Pattern — wood-perforations only, shown after size selected */}
                {selectedCategory?.id === "wood-perforations" && selectedWoodPerfSize && (
                  <Accordion type="single" collapsible defaultValue="perforation" className="config-accordion-wrapper">
                    <AccordionItem value="perforation" className="border-0 px-4">
                      <AccordionTrigger className="section-header py-3">Perforation Pattern</AccordionTrigger>
                      <AccordionContent className="pb-4">
                        <div className="thumbnail-grid" data-testid="perforation-grid">
                          {WOOD_PERFORATION_PATTERNS
                            .filter(p => !(WOOD_PERFORATION_EXCLUSIONS[selectedWoodPerfSize] ?? []).includes(p.id))
                            .map(p => (
                              <HoverCard key={p.id} openDelay={200} closeDelay={100}>
                                <HoverCardTrigger asChild>
                                  <button
                                    onClick={() => setSelectedPerforation(prev => prev?.id === p.id ? null : p)}
                                    className={`relative aspect-square rounded overflow-hidden border-2 transition-colors ${selectedPerforation?.id === p.id ? "border-accent" : "border-transparent hover:border-[hsl(215,16%,47%)]"}`}
                                    data-testid={`perforation-${p.id}`}
                                    data-uv-selected={selectedPerforation?.id === p.id}
                                  >
                                      {/* White background so transparent PNG holes are clearly visible */}
                                    <div className="absolute inset-0 bg-white" />
                                    <img
                                      src={p.thumbnailUrl}
                                      alt={p.name}
                                      className="absolute inset-0 w-full h-full object-cover"
                                      style={{ transform: "scale(3)", transformOrigin: "center" }}
                                    />
                                  </button>
                                </HoverCardTrigger>
                                <HoverCardContent side="right" align="start" className="w-56 p-0 overflow-hidden">
                                  {/* Zoomed-in view in hover: white bg + scale so holes are clearly visible */}
                                  <div className="relative w-full h-40 bg-white overflow-hidden">
                                    <img
                                      src={p.thumbnailUrl}
                                      alt={p.name}
                                      className="absolute inset-0 w-full h-full object-contain"
                                      style={{ transform: "scale(3)", transformOrigin: "center" }}
                                    />
                                  </div>
                                  <div className="px-3 py-2">
                                    <p className="font-manrope font-bold text-sm">{p.name}</p>
                                    <p className="text-xs text-[hsl(215,16%,47%)] mt-0.5">Perforation Pattern</p>
                                  </div>
                                </HoverCardContent>
                              </HoverCard>
                            ))
                          }
                        </div>
                        {selectedPerforation && (
                          <div className="mt-2 p-3 bg-[hsl(var(--secondary))] rounded-lg flex items-center justify-between">
                            <p className="font-medium text-sm">{selectedPerforation.name}</p>
                            <button onClick={() => setSelectedPerforation(null)} className="text-xs text-[hsl(215,16%,47%)] hover:text-red-500 ml-4">Clear</button>
                          </div>
                        )}
                      </AccordionContent>
                    </AccordionItem>
                  </Accordion>
                )}

              </div>
            )}

            {/* ── Ombre Options ─────────────────────────────────────────────── */}
            {selectedProductType?.id === "ombre" && (
              <div className="flex flex-col">
                {/* 0. Category — filtered by surface type */}
                {filteredCategories.length > 0 && (
                  <div className="config-section space-y-2">
                    <Label className="section-header">Category</Label>
                    <Select value={selectedCategory?.id ?? ""} onValueChange={handleCategoryChange} data-testid="ombre-category-select">
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        {filteredCategories.map((cat) => (
                          <SelectItem key={cat.id} value={cat.id}>{cat.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* ── Signature Ombre: real-time 3D configurator ── */}
                {selectedCategory?.id === "signature-ombre" ? (
                  <>
                    {/* Size — same list as Color Core Ombre (filtered by surface). */}
                    {selectedProductType?.sizes?.length > 0 && (
                      <div className="config-section space-y-2">
                        <Label className="section-header">Size</Label>
                        <Select value={selectedSize || ""} onValueChange={setSelectedSize} data-testid="so-size-select">
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select size" />
                          </SelectTrigger>
                          <SelectContent>
                            {selectedProductType.sizes.filter(isSizeAllowedForSurface).map((s) => (
                              <SelectItem key={s} value={s}>{s}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {/* Thickness — placed below Size so the basic dimensions are set
                        before pattern & colour. */}
                    {selectedProductType?.thicknesses?.length > 0 && (
                      <div className="config-section space-y-2">
                        <Label className="section-header">Thickness</Label>
                        <Select value={selectedThickness || ""} onValueChange={setSelectedThickness} data-testid="so-thickness-select">
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select thickness" />
                          </SelectTrigger>
                          <SelectContent>
                            {selectedProductType.thicknesses.map((t) => (
                              <ThicknessSelectItem key={t} thickness={t} testIdPrefix="so-thickness" productId={selectedProductType?.id} />
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {/* Emboss Pattern — hidden under Flat surface (Ombre under Flat
                        is a color-gradient-only product); the colour-gate that used
                        to be here was removed so tiles render immediately and the
                        user's selection survives across colour changes. The preview
                        just stays empty until both colour + emboss are present. */}
                    {selectedSurfaceType !== 'flat' && (
                    <div className="config-section space-y-2">
                      <Label className="section-header">Emboss Pattern</Label>
                      {soIsLoading ? (
                        <p style={{ fontSize: 11, color: '#8a8480' }}>Loading 3D patterns…</p>
                      ) : (
                        <>
                          <div className="thumbnail-grid" data-testid="so-emboss-grid">
                            {SO_PATTERNS.map((pattern) => (
                              <EmbossThumbnail
                                key={pattern.id}
                                pattern={pattern}
                                isSelected={soSelectedPattern === pattern.id}
                                onSelect={(p) => setSoSelectedPattern(prev => prev === p.id ? null : p.id)}
                              />
                            ))}
                          </div>
                          {soSelectedPattern && (
                            <div className="mt-2 p-3 bg-[hsl(var(--secondary))] rounded-lg flex items-center justify-between">
                              <p className="font-medium text-sm">{SO_PATTERNS.find(p => p.id === soSelectedPattern)?.name}</p>
                              <button onClick={() => setSoSelectedPattern(null)} className="text-xs text-[hsl(215,16%,47%)] hover:text-red-500 ml-4">Clear</button>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    )}

                    {/* Base Color — always white */}
                    <div className="config-section space-y-2">
                      <Label className="section-header">Base Color</Label>
                      <div style={{ height: 40, borderRadius: 8, border: '2px solid #e2ddd7', background: '#ffffff', display: 'flex', alignItems: 'center', paddingLeft: 10 }}>
                        <span style={{ fontSize: 11, color: '#8a8480', fontFamily: 'monospace' }}>WHITE</span>
                      </div>
                    </div>

                    {/* Overlay Color — swatch grid */}
                    <div className="config-section space-y-2">
                      <Label className="section-header">Overlay Color</Label>
                      {/* Group tabs */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
                        {SO_COLORS_BY_GROUP.map(({ group }) => (
                          <button key={group} type="button" onClick={() => setSoColorGroup(group)}
                            style={{
                              fontSize: 10, padding: '3px 8px', borderRadius: 6, cursor: 'pointer', fontFamily: 'inherit',
                              background: soColorGroup === group ? '#c4956a' : '#f0ece8',
                              color: soColorGroup === group ? '#fff' : '#6b6056',
                              border: 'none', fontWeight: soColorGroup === group ? 600 : 400,
                            }}
                          >{group}</button>
                        ))}
                      </div>
                      {/* Swatches for selected group — hover to preview the color
                          at larger size alongside its hex + group name, matching
                          the Color Core swatch hover pattern. */}
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 5 }}>
                        {(SO_COLORS_BY_GROUP.find(g => g.group === soColorGroup)?.colors ?? []).map(({ code, hex }, i) => (
                          <HoverCard key={code + i} openDelay={200} closeDelay={100}>
                            <HoverCardTrigger asChild>
                              <button type="button" title={code} onClick={() => setSoOverlayColor(hex)}
                                data-testid={`so-overlay-swatch-${code}`}
                                data-uv-selected={soOverlayColor === hex}
                                style={{
                                  position: 'relative',  // anchor for the badge ::after pseudo-element
                                  aspectRatio: '1', borderRadius: 6, background: hex, cursor: 'pointer',
                                  border: soOverlayColor === hex ? '2.5px solid #c4956a' : '2px solid transparent',
                                  boxShadow: soOverlayColor === hex ? '0 0 0 1px #c4956a' : '0 0 0 1px #d6d0ca',
                                  outline: 'none',
                                }}
                              />
                            </HoverCardTrigger>
                            <HoverCardContent side="right" align="start" className="w-48 p-0 overflow-hidden">
                              <div className="h-24 w-full" style={{ backgroundColor: hex }} />
                              <div className="p-3 space-y-1">
                                <p className="font-manrope font-bold text-sm">{soColorGroup}</p>
                                <p className="text-xs text-[hsl(215,16%,47%)] font-mono">{code}</p>
                              </div>
                            </HoverCardContent>
                          </HoverCard>
                        ))}
                      </div>
                      <div style={{ fontSize: 9, fontFamily: 'monospace', color: '#8a8480', marginTop: 2, textTransform: 'uppercase', minHeight: 12 }}>
                        {soOverlayColor ? soCodeForHex(soOverlayColor) : 'Pick a color'}
                      </div>
                    </div>

                    {/* Gradient preview bar: overlay at bottom → white at top.
                        Hidden until a color is picked — otherwise the gradient
                        would render as pure white with nothing to preview. */}
                    {soOverlayColor && (
                      <div style={{ height: 32, borderRadius: 8, border: '1px solid #e2ddd7',
                        background: `linear-gradient(to top, ${soOverlayColor} 0%, ${soOverlayColor} ${soBlend}%, #ffffff 100%)` }} />
                    )}

                    {/* Blend Presets */}
                    <div className="config-section space-y-2">
                      <Label className="section-header">Blend</Label>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                        {SO_BLEND_PRESETS.map(({ label, value }) => {
                          const isSel = soBlend === value;
                          return (
                            <button key={value} type="button" onClick={() => setSoBlend(value)}
                              style={{
                                padding: '8px 4px', borderRadius: 8, cursor: 'pointer', fontFamily: 'inherit',
                                background: isSel ? 'rgba(196,149,106,0.08)' : '#f5f2ee',
                                border: `2px solid ${isSel ? '#c4956a' : '#e2ddd7'}`,
                                boxShadow: isSel ? '0 0 0 1px #c4956a' : 'none',
                                color: isSel ? '#c4956a' : '#6b6056', textAlign: 'center',
                              }}
                            >
                              <div style={{ fontSize: 11, fontWeight: 600 }}>{label}</div>
                              <div style={{ fontSize: 9, color: isSel ? '#c4956a' : '#8a8480', marginTop: 2 }}>{value}% dark</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* HDRI Lighting dial removed — rotation is fixed to the default set in soLightRotation state. */}

                    {/* Thickness — removed from here, now shown above Ombre Colors */}
                  </>
                ) : selectedCategory?.id === "ombre-color-core-ombre" ? (
                  <>
                    {/* ── Color Core Ombre controls ────────────────────────────────
                        Order: Size → Thickness → Emboss Pattern → Base Color → Overlay.
                        Size/Thickness sit right under Category so users set the basic
                        dimensions before drilling into pattern/colour choices. */}

                    {/* 1. Size */}
                    {selectedProductType?.sizes?.length > 0 && (
                      <div className="config-section space-y-2">
                        <Label className="section-header">Size</Label>
                        <Select value={selectedSize || ""} onValueChange={handleOmbreSizeChange} data-testid="ombre-size-select">
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select size" />
                          </SelectTrigger>
                          <SelectContent>
                            {selectedProductType.sizes.filter(isSizeAllowedForSurface).map((s) => (
                              <SelectItem key={s} value={s}>{s}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {/* 2. Thickness */}
                    {selectedProductType?.thicknesses?.length > 0 && (
                      <div className="config-section space-y-2">
                        <Label className="section-header">Thickness</Label>
                        <Select value={selectedThickness || ""} onValueChange={setSelectedThickness} data-testid="ombre-thickness-select">
                          <SelectTrigger className="w-full">
                            <SelectValue placeholder="Select thickness" />
                          </SelectTrigger>
                          <SelectContent>
                            {/* Color Core Ombre does not offer PET Wool — Signature
                                Ombre does.  The Ombre product's `thicknesses` lists
                                all three; filter here so only Signature sees all. */}
                            {selectedProductType.thicknesses
                              .filter(t => t !== "PET Wool")
                              .map((t) => (
                                <ThicknessSelectItem key={t} thickness={t} testIdPrefix="ombre-thickness" productId={selectedProductType?.id} />
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {/* 3. Emboss Pattern — only in embossed surface.  The colour-gate
                        that used to be here was removed so tiles render immediately
                        and the user's selection survives across colour changes. */}
                    {selectedSurfaceType === 'embossed' && (
                    <div className="config-section space-y-3">
                      <Label className="section-header">Emboss Pattern</Label>
                      <div className="thumbnail-grid" data-testid="ombre-emboss-grid">
                        {OMBRE_COLOR_CORE_EMBOSS_PATTERNS.map((pattern) => (
                          <EmbossThumbnail
                            key={pattern.id}
                            pattern={pattern}
                            isSelected={selectedOmbreEmbossPattern?.id === pattern.id}
                            onSelect={(p) => setSelectedOmbreEmbossPattern(prev => prev?.id === p.id ? null : p)}
                            panelUrl={selectedOmbreOverlay ? getOmbreEmbossPanelUrl(pattern, selectedOmbreOverlay.filename) : null}
                            downloadFilename={`UniVicoustic - Color Core Ombre - ${pattern.name} - ${selectedOmbreBaseColor?.name ?? ''} - ${selectedOmbreOverlay?.hex ?? ''}.png`}
                          />
                        ))}
                      </div>
                      {selectedOmbreEmbossPattern && (
                        <div className="mt-2 p-3 bg-[hsl(var(--secondary))] rounded-lg flex items-center justify-between">
                          <p className="font-medium text-sm">{selectedOmbreEmbossPattern.name}</p>
                          <button onClick={() => setSelectedOmbreEmbossPattern(null)} className="text-xs text-[hsl(215,16%,47%)] hover:text-red-500 ml-4">Clear</button>
                        </div>
                      )}
                    </div>
                    )}

                {/* 2. Base Colors */}
                <div className="config-section space-y-2">
                  <Label className="section-header">Base Color</Label>
                  <div className="grid grid-cols-5 gap-2">
                    {OMBRE_COLOR_CORE_BASE_COLORS.map((color) => (
                      <HoverCard key={color.id} openDelay={200} closeDelay={100}>
                        <HoverCardTrigger asChild>
                          <button
                            title={color.name}
                            onClick={() => {
                              setSelectedOmbreBaseColor(color);
                              // Auto-select first overlay so the preview updates immediately
                              setSelectedOmbreOverlay(OMBRE_COLOR_CORE_OVERLAYS[color.id]?.[0] ?? null);
                              // Emboss pattern is intentionally NOT cleared on base-color
                              // change — under the new emboss-first sidebar order users
                              // pre-select an emboss before colour, and that selection
                              // should survive switching colours.
                              // Groove still clears (only the embossed flow is in-scope
                              // for this rule).
                              setSelectedOmbreGroovePattern(null);
                            }}
                            className={`relative aspect-square rounded transition-all ${
                              selectedOmbreBaseColor?.id === color.id
                                ? "border-2 border-[hsl(var(--accent))] ring-2 ring-[hsl(var(--accent)/0.35)] ring-offset-1 ring-offset-white"
                                : "border-2 border-transparent hover:border-[hsl(215,16%,47%)]"
                            }`}
                            style={{ backgroundColor: color.hex }}
                            data-testid={`ombre-base-color-${color.id}`}
                            data-uv-selected={selectedOmbreBaseColor?.id === color.id}
                          />
                        </HoverCardTrigger>
                        <HoverCardContent side="right" align="start" className="w-48 p-0 overflow-hidden">
                          <div className="h-24 w-full" style={{ backgroundColor: color.hex }} />
                          <div className="p-3 space-y-1">
                            <p className="font-manrope font-bold text-sm">{color.name}</p>
                          </div>
                        </HoverCardContent>
                      </HoverCard>
                    ))}
                  </div>
                  {selectedOmbreBaseColor && (
                    <p className="text-xs text-[hsl(215,16%,47%)] pt-1">
                      {selectedOmbreBaseColor.name}
                    </p>
                  )}
                </div>

                {/* 3. Ombre Overlay Colors */}
                <div className="config-section space-y-2">
                  <Label className="section-header">Ombre Overlay</Label>
                  {!selectedOmbreBaseColor ? (
                    <p className="text-sm text-[hsl(215,16%,47%)]">Select a base color above.</p>
                  ) : (
                    <div className="grid grid-cols-5 gap-2">
                      {(OMBRE_COLOR_CORE_OVERLAYS[selectedOmbreBaseColor.id] ?? []).map((overlay) => (
                        <HoverCard key={overlay.filename} openDelay={200} closeDelay={100}>
                          <HoverCardTrigger asChild>
                            <button
                              title={overlay.hex}
                              onClick={() => {
                                setSelectedOmbreOverlay(prev =>
                                  prev?.filename === overlay.filename ? null : overlay
                                );
                                // Emboss pattern is intentionally NOT cleared on overlay
                                // change — the new emboss-first sidebar order means the
                                // emboss selection should survive across colour/overlay
                                // changes. Groove still clears (only the embossed flow
                                // is in scope for this rule).
                                setSelectedOmbreGroovePattern(null);
                              }}
                              className={`relative aspect-square rounded transition-all ${
                                selectedOmbreOverlay?.filename === overlay.filename
                                  ? "border-2 border-[hsl(var(--accent))] ring-2 ring-[hsl(var(--accent)/0.35)] ring-offset-1 ring-offset-white"
                                  : "border-2 border-transparent hover:border-[hsl(215,16%,47%)]"
                              }`}
                              style={{ backgroundColor: overlay.hex }}
                              data-testid={`ombre-overlay-${overlay.hex}`}
                              data-uv-selected={selectedOmbreOverlay?.filename === overlay.filename}
                            />
                          </HoverCardTrigger>
                          <HoverCardContent side="right" align="start" className="w-48 p-0 overflow-hidden">
                            <div
                              className="h-24 w-full"
                              style={{ background: `linear-gradient(to bottom, ${selectedOmbreBaseColor?.hex ?? '#ccc'} 0%, ${overlay.hex} 100%)` }}
                            />
                            <div className="p-3 space-y-1">
                              <p className="font-manrope font-bold text-sm">Ombre Overlay</p>
                              {/* Flat surface has no emboss/groove pattern grid, so the
                                  downloadable panel is the plain base+overlay gradient.
                                  Under Embossed/Grooving the download lives on the
                                  pattern thumbnails instead, so it's gated to Flat here. */}
                              {selectedSurfaceType === 'flat' && (
                                <div className="flex items-center gap-2 pt-2 mt-2 border-t">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="mt-2"
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      e.preventDefault();
                                      const panelUrl = getOmbreColorCorePanelUrl(selectedOmbreBaseColor.id, overlay.filename);
                                      try {
                                        const res = await fetch(panelUrl, { cache: 'no-store' });
                                        if (!res.ok) throw new Error(`HTTP ${res.status}`);
                                        const blob = await res.blob();
                                        const blobUrl = URL.createObjectURL(blob);
                                        const link = document.createElement('a');
                                        link.download = `UniVicoustic - Color Core Ombre - ${selectedOmbreBaseColor?.name ?? ''} - ${overlay.hex}.jpg`;
                                        link.href = blobUrl;
                                        link.click();
                                        setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
                                      } catch (err) {
                                        console.error('[Ombre flat panel download] failed:', err);
                                        toast.error('Could not download this panel. Please try again.');
                                      }
                                    }}
                                    data-testid={`ombre-overlay-download-${overlay.hex}`}
                                  >
                                    <Download className="h-4 w-4 mr-1" />
                                    Download Panel
                                  </Button>
                                </div>
                              )}
                            </div>
                          </HoverCardContent>
                        </HoverCard>
                      ))}
                    </div>
                  )}
                  {selectedOmbreOverlay && (
                    <p className="text-xs text-[hsl(215,16%,47%)] pt-1">
                      Overlay {selectedOmbreOverlay.hex}
                    </p>
                  )}
                  {/* T-Patti toggle — hidden on the Embossed surface
                      across all series (see note on the other tpatti
                      toggle render site for why). */}
                  {selectedCategory?.id &&
                    FLAT_EMBOSSED_VMT_CONFIG[selectedCategory.id]?.tpatti &&
                    selectedSurfaceType !== 'embossed' && (
                    <div className="flex items-center justify-between mt-3 p-3 bg-[hsl(var(--secondary))] rounded-lg">
                      <Label htmlFor="ombre-tpatti-toggle" className="text-sm font-medium">T-Profile Overlay</Label>
                      <Switch id="ombre-tpatti-toggle" checked={showTpatti} onCheckedChange={setShowTpatti} data-testid="ombre-tpatti-toggle" />
                    </div>
                  )}
                </div>

                {/* 4. Pattern — surface-tied.
                    - Flat: entire section hidden (Color Core Ombre under Flat
                      renders as the base colour + overlay gradient alone).
                    - Embossed: only emboss thumbnails.  User cannot switch to
                      Groove — that belongs to the Grooving tab.
                    - Grooving: only groove thumbnails.
                    The previous Emboss|Groove toggle is gone — the surface
                    tab fully dictates which pattern type is relevant. */}
                {/* Color Core Ombre emboss + groove grids now route through
                    the shared EmbossThumbnail component so they pick up the
                    same hover-name overlay and HoverCard enlarged-preview
                    behaviour that Wood Classics, Color Core Fabrics,
                    Designer Textile, Signature Ombre and FVP use.  Keeps the
                    emboss UI consistent across every category in the app.
                    Also hidden until BOTH a base colour AND an overlay are
                    picked — picking a pattern without colours first would
                    produce a broken panel URL. */}
                {/* (Embossed Emboss Pattern grid moved up — rendered above Base Color now.) */}

                {selectedSurfaceType === 'grooving' && selectedOmbreBaseColor && selectedOmbreOverlay && (
                <div className="config-section space-y-3">
                  <Label className="section-header">Groove Pattern</Label>
                  <div className="thumbnail-grid" data-testid="ombre-groove-grid">
                    {OMBRE_COLOR_CORE_GROOVE_PATTERNS.map((pattern) => (
                      <EmbossThumbnail
                        key={pattern.id}
                        pattern={pattern}
                        isSelected={selectedOmbreGroovePattern?.id === pattern.id}
                        onSelect={(p) => setSelectedOmbreGroovePattern(prev => prev?.id === p.id ? null : p)}
                        panelUrl={getOmbreGroovePanelUrl(pattern, selectedOmbreOverlay.filename)}
                        downloadFilename={`UniVicoustic - Color Core Ombre - ${pattern.name} - ${selectedOmbreBaseColor?.name ?? ''} - ${selectedOmbreOverlay?.hex ?? ''}.png`}
                      />
                    ))}
                  </div>
                  {selectedOmbreGroovePattern && (
                    <div className="mt-2 p-3 bg-[hsl(var(--secondary))] rounded-lg flex items-center justify-between">
                      <p className="font-medium text-sm">{selectedOmbreGroovePattern.name}</p>
                      <button onClick={() => setSelectedOmbreGroovePattern(null)} className="text-xs text-[hsl(215,16%,47%)] hover:text-red-500 ml-4">Clear</button>
                    </div>
                  )}
                </div>
                )}

                {/* 5. Thickness — removed, now shown above Base Color */}
                  </>
                ) : null}
              </div>
            )}

            {/* Generic Product Options (non-VicStrip, non-flat-embossed-vmd, non-wood, non-fabrics, non-ombre) */}
            {selectedProductType?.id !== "vicstrip" && selectedProductType?.id !== "flat-embossed-vmd" && selectedProductType?.id !== "wood" && selectedProductType?.id !== "fabrics" && selectedProductType?.id !== "ombre" && (
              <Accordion type="multiple" defaultValue={["category", "options", "designs"]} className="flex flex-col">
                {/* Category Selector */}
                {selectedProductType?.categories?.length > 0 && (
                  <AccordionItem value="category" className="config-accordion">
                    <AccordionTrigger className="section-header py-3">
                      Category
                    </AccordionTrigger>
                    <AccordionContent className="pb-4">
                      <Select 
                        value={selectedCategory?.id} 
                        onValueChange={handleCategoryChange}
                        data-testid="category-select"
                      >
                        <SelectTrigger className="w-full" data-testid="category-trigger">
                          <SelectValue placeholder="Select category" />
                        </SelectTrigger>
                        <SelectContent>
                          {selectedProductType.categories.map((category) => (
                            <SelectItem 
                              key={category.id} 
                              value={category.id}
                              data-testid={`category-${category.id}`}
                            >
                              {category.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {/* Emboss Toggle (only for emboss-available categories) */}
                      {selectedCategory?.emboss_available && (
                        <div className="flex items-center justify-between mt-4 p-3 bg-[hsl(var(--secondary))] rounded-lg">
                          <Label htmlFor="emboss-toggle" className="text-sm font-medium">
                            Embossed Finish
                          </Label>
                          <Switch
                            id="emboss-toggle"
                            checked={isEmbossed}
                            onCheckedChange={setIsEmbossed}
                            data-testid="emboss-toggle"
                          />
                        </div>
                      )}

                      {/* T-Patti Toggle (only for flat-embossed-vmd categories
                          that have a tpatti defined, AND not on the Embossed
                          surface — see notes on other tpatti toggle render
                          sites for the rationale). */}
                      {selectedProductType?.id === "flat-embossed-vmd" &&
                        selectedCategory?.id &&
                        FLAT_EMBOSSED_VMT_CONFIG[selectedCategory.id]?.tpatti &&
                        selectedSurfaceType !== 'embossed' && (
                        <div className="flex items-center justify-between mt-4 p-3 bg-[hsl(var(--secondary))] rounded-lg">
                          <Label htmlFor="tpatti-toggle" className="text-sm font-medium">
                            T-Profile Overlay
                          </Label>
                          <Switch
                            id="tpatti-toggle"
                            checked={showTpatti}
                            onCheckedChange={setShowTpatti}
                            data-testid="tpatti-toggle"
                          />
                        </div>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                )}

                {/* Size, Density, Pattern, Thickness Options */}
                <AccordionItem value="options" className="config-accordion">
                  <AccordionTrigger className="section-header py-3">Options</AccordionTrigger>
                  <AccordionContent className="pb-4 space-y-4">
                    {/* Size */}
                    {selectedProductType?.sizes?.length > 0 && (
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">Size (mm)</Label>
                        <Select 
                          value={selectedSize || ""} 
                          onValueChange={setSelectedSize}
                          data-testid="size-select"
                        >
                          <SelectTrigger className="w-full" data-testid="size-trigger">
                            <SelectValue placeholder="Select size" />
                          </SelectTrigger>
                          <SelectContent>
                            {selectedProductType.sizes.filter(isSizeAllowedForSurface).map((size) => (
                              <SelectItem key={size} value={size} data-testid={`size-${size}`}>
                                {size}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {/* Density */}
                    {selectedProductType?.densities?.length > 0 && (
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">Density</Label>
                        <Select 
                          value={selectedDensity || ""} 
                          onValueChange={setSelectedDensity}
                          data-testid="density-select"
                        >
                          <SelectTrigger className="w-full" data-testid="density-trigger">
                            <SelectValue placeholder="Select density" />
                          </SelectTrigger>
                          <SelectContent>
                            {selectedProductType.densities.map((density) => (
                              <SelectItem key={density} value={density} data-testid={`density-${density}`}>
                                {density}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}

                    {/* Thickness */}
                    {selectedProductType?.thicknesses?.length > 0 && (
                      <div className="space-y-2">
                        <Label className="text-sm font-medium">Thickness</Label>
                        <Select 
                          value={selectedThickness || ""} 
                          onValueChange={setSelectedThickness}
                          data-testid="thickness-select"
                        >
                          <SelectTrigger className="w-full" data-testid="thickness-trigger">
                            <SelectValue placeholder="Select thickness" />
                          </SelectTrigger>
                          <SelectContent>
                            {selectedProductType.thicknesses.map((thickness) => (
                              <ThicknessSelectItem key={thickness} thickness={thickness} productId={selectedProductType?.id} />
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </AccordionContent>
                </AccordionItem>

                {/* Color Swatches */}
                {selectedProductType?.colors?.length > 0 && (
                  <AccordionItem value="colors" className="config-accordion">
                    <AccordionTrigger className="section-header py-3">Colors</AccordionTrigger>
                    <AccordionContent className="pb-4">
                      <div className="color-grid" data-testid="color-grid">
                        {selectedProductType.colors.map((color, index) => (
                          <button
                            key={index}
                            className={`color-swatch ${selectedColor === color ? 'selected' : ''}`}
                            style={{ backgroundColor: color }}
                            onClick={() => setSelectedColor(color)}
                            data-testid={`color-swatch-${index}`}
                            aria-label={`Select color ${color}`}
                          />
                        ))}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                )}

                {/* Design Thumbnails */}
                {selectedCategory?.designs?.length > 0 && (
                  <AccordionItem value="designs" className="config-accordion">
                    <AccordionTrigger className="section-header py-3">Designs</AccordionTrigger>
                    <AccordionContent className="pb-4">
                      <div className="thumbnail-grid" data-testid="design-grid">
                        {selectedCategory.designs.map((design) => (
                          <DesignThumbnail
                            key={design.id}
                            design={design}
                            isSelected={selectedDesign?.id === design.id}
                            onSelect={handleDesignSelect}
                          />
                        ))}
                      </div>
                      {selectedDesign && (
                        <div className="mt-3 p-3 bg-[hsl(var(--secondary))] rounded-lg">
                          <p className="font-medium text-sm">{selectedDesign.design_name}</p>
                          <p className="text-xs text-[hsl(215,16%,47%)]">{selectedDesign.design_code}</p>
                        </div>
                      )}
                    </AccordionContent>
                  </AccordionItem>
                )}
              </Accordion>
            )}
          </div>
        </ScrollArea>

        {/* Action Bar */}
        <div className="action-bar" data-testid="action-bar">
          <Button
            variant="outline"
            size="sm"
            onClick={resetConfig}
            className="flex-1"
            data-testid="reset-btn"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Reset
          </Button>
          
          <Dialog
            open={favoritesOpen}
            onOpenChange={(open) => { if (open) track("saved_list_opened", { count: favorites.length }); setFavoritesOpen(open); }}
          >
            <DialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="flex-1 relative"
                data-testid="favorites-btn"
              >
                <Heart className="h-4 w-4 mr-2" />
                Saved
                {favorites.length > 0 && (
                  <span className="absolute -top-1 -right-1 h-5 w-5 bg-accent text-white text-xs rounded-full flex items-center justify-center">
                    {favorites.length}
                  </span>
                )}
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md" data-testid="favorites-modal">
              <DialogHeader>
                <DialogTitle className="font-manrope">Saved Configurations</DialogTitle>
              </DialogHeader>
              {favorites.length === 0 ? (
                <div className="py-12 text-center text-[hsl(215,16%,47%)]">
                  <Heart className="h-12 w-12 mx-auto mb-4 opacity-30" />
                  <p>No saved configurations yet</p>
                </div>
              ) : (
                <ScrollArea className="max-h-[60vh]">
                  {/* Slim list rows — one full-width row per saved config. */}
                  <div className="p-1 space-y-1.5">
                    {favorites.map((favorite) => {
                      const isRenaming = renamingId === favorite.id;
                      // Prefer custom name → snapshot display field → legacy
                      // flat fields (so pre-migration saves still render).
                      const title = favorite.name
                        ?? favorite.displayTitle
                        ?? (favorite.productTypeId === "vicstrip"
                          ? favorite.pattern?.name
                          : favorite.design?.design_name || favorite.productType);
                      const subtitle = favorite.displaySubtitle
                        ?? (favorite.productTypeId === "vicstrip"
                          ? favorite.color?.name
                          : favorite.category || favorite.productType);
                      const swatch = favorite.displaySwatch
                        ?? (favorite.productTypeId === "vicstrip"
                          ? favorite.color?.hex
                          : (favorite.design?.texture_color || "#CCCCCC"));
                      return (
                        <div
                          key={favorite.id}
                          className="group flex items-center gap-3 px-3 py-2 border rounded-lg cursor-pointer hover:bg-[hsl(var(--secondary))] transition-colors"
                          onClick={() => { if (!isRenaming) loadFavorite(favorite); }}
                          data-testid={`favorite-card-${favorite.id}`}
                        >
                          {/* Swatch — small square */}
                          <div
                            className="w-9 h-9 rounded border flex-shrink-0"
                            style={{ backgroundColor: swatch }}
                          />
                          {/* Name + meta */}
                          <div className="flex-1 min-w-0">
                            {isRenaming ? (
                              <input
                                autoFocus
                                value={renameDraft}
                                maxLength={60}
                                onChange={(e) => setRenameDraft(e.target.value)}
                                onClick={(e) => e.stopPropagation()}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') { e.preventDefault(); commitRename(favorite.id); }
                                  else if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
                                }}
                                onBlur={() => commitRename(favorite.id)}
                                className="w-full text-sm font-medium bg-white border border-accent rounded px-1.5 py-0.5 outline-none"
                                data-testid={`rename-input-${favorite.id}`}
                              />
                            ) : (
                              <p className="font-medium text-sm truncate">{title}</p>
                            )}
                            <p className="text-xs text-[hsl(215,16%,47%)] truncate">
                              {subtitle}
                              <span className="text-[hsl(215,16%,60%)]"> · {new Date(favorite.timestamp).toLocaleDateString()}</span>
                            </p>
                          </div>
                          {/* Actions */}
                          <div className="flex items-center gap-1 flex-shrink-0">
                            {isRenaming ? (
                              <button
                                onClick={(e) => { e.stopPropagation(); commitRename(favorite.id); }}
                                className="p-1.5 hover:bg-green-100 rounded text-green-600"
                                data-testid={`rename-confirm-${favorite.id}`}
                                title="Save name"
                              >
                                <Check className="h-4 w-4" />
                              </button>
                            ) : (
                              <button
                                onClick={(e) => beginRename(favorite, e)}
                                className="p-1.5 hover:bg-white rounded text-[hsl(215,16%,47%)] md:opacity-0 md:group-hover:opacity-100 transition-opacity"
                                data-testid={`rename-favorite-${favorite.id}`}
                                title="Rename"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                            )}
                            <button
                              onClick={(e) => deleteFavorite(favorite.id, e)}
                              className="p-1.5 hover:bg-red-100 rounded text-red-500"
                              data-testid={`delete-favorite-${favorite.id}`}
                              title="Delete"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </DialogContent>
          </Dialog>
        </div>
        {/* Mobile-only: Studio Lighting in the sidebar (the floating widget
            on the canvas is hidden on mobile). */}
        <div className="md:hidden px-4 py-3 border-t border-[hsl(var(--border))]" data-testid="hdri-lighting-control-mobile">
          <p className="section-header pb-2">Studio Lighting</p>
          <div className="flex gap-1.5">
            {[
              { id: 'none', label: 'Off',  dot: '#CBD5E1' },
              { id: 'warm', label: 'Warm', dot: '#F59E0B' },
              { id: 'soft', label: 'Soft', dot: '#93C5FD' },
            ].map(({ id, label, dot }) => (
              <button
                key={id}
                onClick={() => { track("studio_lighting_toggled", { mode: id }); setHdriLighting(id); }}
                className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  hdriLighting === id
                    ? 'bg-accent text-white border-accent'
                    : 'text-[hsl(215,16%,47%)] border-[hsl(var(--border))] hover:bg-[hsl(var(--secondary))]'
                }`}
                data-testid={`lighting-mobile-${id}`}
                aria-pressed={hdriLighting === id}
              >
                <span
                  className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: hdriLighting === id ? 'rgba(255,255,255,0.85)' : dot }}
                />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Caveat */}
        <p className="px-4 py-2 text-[0.62rem] text-[hsl(215,16%,60%)] leading-tight border-t border-[hsl(var(--border))]">
          *This configurator provides an indicative visualization only. Actual product appearance may vary due to lighting conditions, surface textures, material finishes, and installation environment.
        </p>

        {/* Mobile-only: Save / Download / Tech Specs row.  Mirrors the
            desktop header buttons which are hidden on mobile. */}
        <div className="md:hidden px-4 py-3 flex gap-2 border-t border-[hsl(var(--border))]" data-testid="mobile-action-row">
          <Button
            variant="outline"
            size="sm"
            onClick={saveToFavorites}
            className="flex-1 text-[hsl(215,25%,27%)] border-[hsl(var(--border))]"
            data-testid="save-favorite-btn-mobile"
          >
            <Heart className="h-4 w-4 mr-1.5" />
            Save
          </Button>
          <Button
            size="sm"
            onClick={() => setDownloadChoiceOpen(true)}
            disabled={downloading}
            className="flex-1 bg-accent hover:bg-accent-hover text-white disabled:opacity-70 disabled:cursor-wait"
            data-testid="download-btn-mobile"
            title={downloading ? "Preparing your download…" : undefined}
          >
            {downloading ? (
              <>
                <span className="btn-spinner mr-1.5" aria-hidden="true" />
                Preparing…
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-1.5" />
                Download
              </>
            )}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleViewTechSpecs}
            className="flex-1 text-[hsl(215,25%,27%)]"
            data-testid="tech-spec-btn-mobile"
            title="View Tech Specs"
          >
            <FileText className="h-4 w-4" />
          </Button>
        </div>
      </aside>

      {/* Canvas Preview Area */}
      <main className="canvas-area" data-testid="canvas-area">

        {/* Replay tour button — desktop only. Lives below the zoom controls
            at top-right of the canvas. Previously sat above the HDRI lighting
            widget but overlapped it when the angle dial expanded — clicks
            were leaking through to the Warm/Soft buttons underneath. Moved
            here so it has zero overlap with any other floating widget. */}
        <button
          type="button"
          onClick={() => {
            if (typeof window.startUnivicousticTour === "function") {
              window.startUnivicousticTour();
            }
          }}
          className="absolute right-4 top-56 z-10 hidden md:flex items-center gap-1.5 bg-white/90 backdrop-blur-sm rounded-2xl shadow-lg border border-[hsl(var(--border))] px-3 py-1.5 text-xs font-medium text-[hsl(215,25%,27%)] hover:bg-white transition-colors"
          data-testid="replay-tour-btn"
          title="Replay the walkthrough tour"
        >
          <HelpCircle className="h-4 w-4 flex-shrink-0" />
          Replay tour
        </button>

        {/* HDRI Studio Lighting Control — desktop only.
            Mobile equivalent of lighting lives inside the sidebar (above the disclaimer). */}
        <div className="absolute bottom-32 right-4 z-10 select-none hidden md:block" data-testid="hdri-lighting-control">
          <div className="bg-white/90 backdrop-blur-sm rounded-2xl shadow-lg border border-[hsl(var(--border))] p-2 flex flex-col items-stretch gap-1">
            <p className="text-[9px] font-bold text-[hsl(215,16%,55%)] uppercase tracking-widest text-center pb-0.5">Studio Lighting</p>
            {[
              { id: 'none', label: 'Off',  dot: '#CBD5E1' },
              { id: 'warm', label: 'Warm', dot: '#F59E0B' },
              { id: 'soft', label: 'Soft', dot: '#93C5FD' },
            ].map(({ id, label, dot }) => (
              <button
                key={id}
                onClick={() => { track("studio_lighting_toggled", { mode: id }); setHdriLighting(id); }}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition-colors ${
                  hdriLighting === id
                    ? 'bg-accent text-white'
                    : 'text-[hsl(215,16%,47%)] hover:bg-[hsl(var(--secondary))]'
                }`}
                data-testid={`lighting-${id}`}
                aria-pressed={hdriLighting === id}
              >
                <span
                  className="inline-block w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: hdriLighting === id ? 'rgba(255,255,255,0.75)' : dot }}
                />
                {label}
              </button>
            ))}
            {/* Angle dial — visible only when a lighting mode is active */}
            {hdriLighting !== 'none' && (
              <div className="pt-1.5 mt-0.5 border-t border-[hsl(var(--border))]">
                <p className="text-[9px] font-bold text-[hsl(215,16%,55%)] uppercase tracking-widest text-center mb-1">Angle</p>
                <LightingAngleDial
                  angle={lightAngle}
                  onChange={setLightAngle}
                  accentColor={hdriLighting === 'warm' ? '#F59E0B' : '#93C5FD'}
                />
              </div>
            )}
          </div>
        </div>

        {/* Zoom Controls — desktop only (touch users pinch-zoom natively or use browser zoom). */}
        <div className="absolute top-4 right-4 hidden md:flex items-start gap-2 z-10" data-testid="zoom-controls">
          {/* Vertical zoom slider — finer-grained than the +/- step buttons */}
          <input
            type="range"
            orient="vertical"
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            step={0.1}
            value={zoomLevel}
            onChange={(e) => {
              const next = parseFloat(parseFloat(e.target.value).toFixed(2));
              setZoomLevel(next);
            }}
            style={{
              WebkitAppearance: 'slider-vertical',
              appearance: 'slider-vertical',
              writingMode: 'vertical-lr',
              direction: 'rtl',
              height: '120px',
              width: '24px',
            }}
            className="cursor-pointer accent-accent bg-white/90 backdrop-blur-sm rounded shadow-lg"
            aria-label="Zoom level"
            data-testid="zoom-slider"
          />
          <div className="flex flex-col gap-1">
          {/* Magnifier toggle — on/off switch for the hover-loupe lens.
              When OFF, hovering the preview does nothing.  Persisted to
              localStorage (see `magnifierEnabled` state above). */}
          <Button
            variant="outline"
            size="icon"
            onClick={() => setMagnifierEnabled((v) => !v)}
            className={`backdrop-blur-sm shadow-lg h-8 w-8 ${
              magnifierEnabled
                ? "bg-accent text-white hover:bg-accent-hover border-accent"
                // Explicit text colors on the OFF state — without them, the
                // outline variant's `hover:text-accent-foreground` (white)
                // would make the icon vanish against the white hover bg.
                : "bg-white/90 hover:bg-white text-[hsl(215,16%,47%)] hover:text-[hsl(215,16%,30%)]"
            }`}
            data-testid="magnifier-toggle-btn"
            aria-pressed={magnifierEnabled}
            aria-label={magnifierEnabled ? "Turn magnifier off" : "Turn magnifier on"}
            title={magnifierEnabled ? "Magnifier: ON (click to disable)" : "Magnifier: OFF (click to enable)"}
          >
            <Search className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={zoomIn}
            disabled={zoomLevel >= ZOOM_MAX}
            // Explicit text colors override the outline variant's
            // `hover:text-accent-foreground` (white) — without them the
            // ZoomIn icon vanishes against the white hover bg.
            className="bg-white/90 backdrop-blur-sm shadow-lg hover:bg-white text-[hsl(215,16%,47%)] hover:text-[hsl(215,16%,30%)] h-8 w-8"
            data-testid="zoom-in-btn"
            aria-label="Zoom in"
          >
            <ZoomIn className="h-4 w-4" />
          </Button>
          {isEditingZoom ? (
            <div className="bg-white/90 backdrop-blur-sm rounded shadow flex items-center justify-center px-1 py-0.5 h-6 w-12">
              <input
                ref={zoomInputRef}
                type="number"
                inputMode="numeric"
                min={Math.round(ZOOM_MIN * 100)}
                max={Math.round(ZOOM_MAX * 100)}
                value={zoomInputValue}
                onChange={(e) => setZoomInputValue(e.target.value)}
                onBlur={commitZoomInput}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commitZoomInput(); }
                  else if (e.key === 'Escape') { e.preventDefault(); cancelZoomInput(); }
                }}
                className="w-full text-xs text-center text-[hsl(215,16%,47%)] bg-transparent outline-none font-medium [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                data-testid="zoom-percent-input"
                aria-label="Zoom percentage"
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={beginEditZoom}
              title="Click to enter a custom zoom %"
              className="text-xs text-center text-[hsl(215,16%,47%)] bg-white/90 backdrop-blur-sm rounded px-1 py-0.5 shadow font-medium h-6 w-12 hover:bg-white cursor-text"
              data-testid="zoom-percent-display"
            >
              {Math.round(zoomLevel * 100)}%
            </button>
          )}
          <Button
            variant="outline"
            size="icon"
            onClick={zoomOut}
            disabled={zoomLevel <= ZOOM_MIN}
            // Same explicit text-color override as zoom-in above — keeps the
            // ZoomOut icon visible on hover (outline variant's default is
            // `hover:text-accent-foreground` = white).
            className="bg-white/90 backdrop-blur-sm shadow-lg hover:bg-white text-[hsl(215,16%,47%)] hover:text-[hsl(215,16%,30%)] h-8 w-8"
            data-testid="zoom-out-btn"
            aria-label="Zoom out"
          >
            <ZoomOut className="h-4 w-4" />
          </Button>
          </div>
        </div>

        {/* Preview Component — routes by product type */}
        <div
          ref={magnifierRef}
          className="relative rounded-3xl overflow-hidden shadow-lg inset-shadow-lg inset-shadow-indigo-500/100"
          style={{
            cursor: zoomLevel > 1 ? (isDragging ? 'grabbing' : 'grab') : undefined,
          }}
          onMouseDown={handlePanStart}
          onMouseMove={(e) => {
            handlePanMove(e);
            if (isDraggingRef.current || !magnifierDivRef.current || !magnifierRef.current) return;
            // Capture coords on the synthetic event NOW; we'll read them in
            // the rAF callback, by which time the React event is pooled.
            lensMouseRef.current = { clientX: e.clientX, clientY: e.clientY };
            if (lensRafRef.current != null) return; // one update per frame
            lensRafRef.current = requestAnimationFrame(() => {
              lensRafRef.current = null;
              const m = lensMouseRef.current;
              const rect = lensRectRef.current;
              if (!m || !rect || !magnifierDivRef.current) return;
              const x = m.clientX - rect.left;
              const y = m.clientY - rect.top;
              // Use top/left for the lens (its CSS already includes a
              // transform: translate(-50%, -50%) for centering, which we
              // mustn't clobber). Use transform for the CLONE inside — that's
              // the heavy element being scaled N×, and translate3d keeps it
              // on the GPU layer hinted by will-change.
              magnifierDivRef.current.style.top = `${y}px`;
              magnifierDivRef.current.style.left = `${x}px`;
              if (lensCloneRef.current) {
                const tx = MAGNIFIER_SIZE / 2 - x * MAGNIFIER_ZOOM;
                const ty = MAGNIFIER_SIZE / 2 - y * MAGNIFIER_ZOOM;
                lensCloneRef.current.style.transform =
                  `translate3d(${tx}px, ${ty}px, 0) scale(${MAGNIFIER_ZOOM})`;
              }
            });
          }}
          onMouseUp={handlePanEnd}
          onMouseEnter={handleMagnifierEnter}
          onMouseLeave={() => {
            handlePanEnd();
            setMagnifierActive(false);
            // Cancel any pending rAF so it can't fire after the lens is gone
            if (lensRafRef.current != null) {
              cancelAnimationFrame(lensRafRef.current);
              lensRafRef.current = null;
            }
            lensMouseRef.current = null;
            lensRectRef.current = null;
            // Clear clone to free memory
            const lens = magnifierDivRef.current;
            if (lens) while (lens.firstChild) lens.removeChild(lens.firstChild);
            lensCloneRef.current = null;
          }}
        >
        {/* ── Compare: Slot tiles (shown while picking) ───────────────── */}
        {compareMode && !compareApplied && (
          <div
            className="absolute top-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 bg-white/95 backdrop-blur-sm rounded-xl shadow-lg px-3 py-2 border border-[hsl(var(--border))]"
            data-testid="compare-slots"
          >
            {[0, 1].map((i) => {
              const slot = compareSlots[i];
              return (
                <div key={i} className="flex flex-col items-center gap-1">
                  <div
                    onClick={() => captureSlot(i)}
                    className={`relative w-20 h-20 rounded-lg border-2 cursor-pointer transition-all ${
                      slot
                        ? 'border-accent hover:border-accent-hover'
                        : 'border-dashed border-[hsl(215,16%,60%)] hover:border-accent bg-[hsl(var(--secondary))]'
                    }`}
                    data-testid={`compare-slot-${i}`}
                    title={slot ? 'Click to recapture with current view' : 'Click to capture current view'}
                  >
                    {slot ? (
                      <>
                        <img src={slot.imageUrl} alt={slot.label} className="w-full h-full object-cover rounded-md" />
                        <button
                          onClick={(e) => { e.stopPropagation(); clearSlot(i); }}
                          className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-white border border-[hsl(var(--border))] shadow flex items-center justify-center hover:bg-red-50"
                          data-testid={`compare-slot-${i}-clear`}
                          aria-label="Clear slot"
                        >
                          <X className="h-3 w-3 text-[hsl(215,16%,47%)]" />
                        </button>
                      </>
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-[10px] font-semibold text-[hsl(215,16%,47%)]">
                        {i === 0 ? 'A' : 'B'}<br />
                        <span className="text-[8px] font-normal block">Click</span>
                      </div>
                    )}
                  </div>
                  <div className="text-[9px] text-[hsl(215,16%,47%)] max-w-[80px] truncate text-center" title={slot?.label}>
                    {slot?.label ?? (i === 0 ? 'Slot A' : 'Slot B')}
                  </div>
                </div>
              );
            })}
            <Button
              size="sm"
              disabled={!compareSlots[0] || !compareSlots[1]}
              onClick={applyCompare}
              className="bg-accent hover:bg-accent-hover text-white disabled:opacity-40"
              data-testid="compare-apply-btn"
            >
              Apply
            </Button>
          </div>
        )}

        {/* ── Compare: Slider overlay (shown after Apply) ───────────────
            Initial divider position is 50% (set via the element's inline
            `left` / `clipPath` style on mount).  During a drag, pointermove
            mutates those DOM nodes directly via refs — no React re-render,
            no jank.  The close button opts out of drag via
            data-compare-nodrag so clicking × reliably fires onClick. */}
        {compareMode && compareApplied && compareSlots[0] && compareSlots[1] && (
          <div
            ref={sliderContainerRef}
            className="absolute inset-0 z-30 overflow-hidden select-none"
            onPointerDown={handleSliderContainerPointerDown}
            data-testid="compare-slider"
          >
            {/* Slot A fills the whole preview area */}
            <img
              src={compareSlots[0].imageUrl}
              alt={compareSlots[0].label}
              className="absolute inset-0 w-full h-full object-cover pointer-events-none"
              draggable={false}
            />
            {/* Slot B clipped so only the portion right of the slider is visible */}
            <img
              ref={sliderImgBRef}
              src={compareSlots[1].imageUrl}
              alt={compareSlots[1].label}
              className="absolute inset-0 w-full h-full object-cover pointer-events-none"
              draggable={false}
              style={{ clipPath: 'inset(0 0 0 50%)' }}
            />
            {/* Vertical divider line + draggable handle */}
            <div
              ref={sliderDividerRef}
              className="absolute top-0 bottom-0 w-[2px] bg-white shadow-[0_0_6px_rgba(0,0,0,0.45)] pointer-events-none"
              style={{ left: 'calc(50% - 1px)' }}
            />
            <div
              ref={sliderHandleRef}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-10 h-10 rounded-full bg-white border-2 border-accent shadow-lg flex items-center justify-center cursor-ew-resize"
              style={{ left: '50%' }}
              data-testid="compare-slider-handle"
            >
              <SplitSquareHorizontal className="h-4 w-4 text-accent pointer-events-none" />
            </div>
            {/* Labels pinned to each side — now clickable tabs.  Click a
                pill to re-capture the current live preview into that slot,
                letting the user iterate on one side while keeping the other
                fixed.  The refresh icon makes the clickability discoverable;
                data-compare-nodrag keeps the pill out of slider-drag hit-
                testing so clicks fire reliably.  Disabled (inert) style when
                no series is selected — capturing a blank placeholder into a
                slot would just produce an empty image. */}
            {[0, 1].map((i) => {
              const slot = compareSlots[i];
              const isDisabled = !selectedProductType;
              const sideClass = i === 0 ? 'left-3' : 'right-3';
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => { if (!isDisabled) captureSlot(i); }}
                  disabled={isDisabled}
                  data-compare-nodrag
                  className={`absolute top-3 ${sideClass} flex items-center gap-1.5 bg-white/90 backdrop-blur-sm rounded px-2 py-1 text-[11px] font-medium text-[hsl(215,25%,27%)] shadow max-w-[45%] border transition-colors z-10 ${
                    isDisabled
                      ? 'opacity-50 cursor-not-allowed border-transparent'
                      : 'border-transparent hover:border-accent hover:bg-white cursor-pointer'
                  }`}
                  title={isDisabled ? 'Pick a series first' : 'Replace this side with the current configuration'}
                  data-testid={`compare-tab-${i === 0 ? 'a' : 'b'}`}
                >
                  <RefreshCw className="h-3 w-3 text-accent flex-shrink-0" />
                  <span className="truncate">{i === 0 ? 'A' : 'B'} — {slot.label}</span>
                </button>
              );
            })}
            {/* Close button — opts out of drag so clicks fire reliably. */}
            <button
              onClick={exitCompare}
              data-compare-nodrag
              className="absolute top-3 left-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-white border border-[hsl(var(--border))] shadow flex items-center justify-center hover:bg-red-50 z-10"
              data-testid="compare-exit-btn"
              aria-label="Exit compare"
            >
              <X className="h-4 w-4 text-[hsl(215,16%,47%)] pointer-events-none" />
            </button>
          </div>
        )}

        <div
          ref={previewContentRef}
          style={{
            transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoomLevel})`,
            transformOrigin: "center",
            transition: isDragging ? "none" : "transform 0.2s ease",
            filter: hdriLighting === 'warm'
              ? 'brightness(1.04) contrast(1.06) saturate(1.10) sepia(0.08)'
              : hdriLighting === 'soft'
                ? 'brightness(1.12) contrast(0.89) saturate(0.80)'
                : undefined,
            width: '100%',
            height: '100%',
          }}
          data-testid="preview-zoom-wrapper"
        >
        {!selectedProductType ? (
          /* No series picked → surface-only URL (e.g. /flat).  Show the
             muted "Select a series to see a preview" placeholder that
             matches the app's quietly-guide-the-user tone. */
          <div
            className="w-full h-full flex items-center justify-center"
            data-testid="preview-empty-state"
          >
            <p className="text-sm text-[hsl(215,16%,47%)] p-4">
              Select a series to see a preview
            </p>
          </div>
        ) : !isConfigComplete ? (
          /* Series picked but not every field is filled — under the
             "all fields mandatory" rule we render the preview empty
             with a centred message so the user immediately understands
             why nothing is rendering. Matches the muted style of the
             "Select a series to see a preview" placeholder above. */
          <div
            className="w-full h-full flex flex-col items-center justify-center gap-2 px-6 text-center py-4 border-2 border-gray-300 border-dashed rounded-lg"
            data-testid="preview-incomplete-state"
          >
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-[hsl(215,16%,60%)]" aria-hidden="true">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <p className="text-sm font-medium text-[hsl(215,16%,40%)]">
              Select all fields to see the preview
            </p>
            <p className="text-xs text-[hsl(215,16%,55%)] max-w-xs">
              Pick every option in the sidebar — size, thickness, colour, emboss, and more — to render your panel.
            </p>
          </div>
        ) : selectedProductType?.id === "ombre" && selectedCategory?.id === "signature-ombre" ? (
          <SignatureOmbreRoomPreview
            // No preview until every required field is filled.
            panelImage={isConfigComplete ? soPanelImage : null}
            panelCount={3}
            // `so-room` class is what the Signature Ombre download path
            // (see downloadImage) uses to find the wall canvas and overlay
            // img via document.querySelector.  Without it, the download
            // returns early at `if (!wallCanvas) return;` and silently fails.
            className="so-room"
            // NOTE: no `style` prop — the component doesn't accept one (it
            // uses a fixed PREVIEW_SIZE), and an inline object here would
            // defeat the memo() wrapper by changing identity every render.
          />
        ) : (selectedProductType?.id === "flat-embossed-vmd" || selectedProductType?.id === "wood" || selectedProductType?.id === "fabrics" || selectedProductType?.id === "ombre") ? (
          <FlatEmbossedPreview
            ref={canvasRef}
            onLoadingChange={handleLoadingChange}
            categoryId={selectedCategory?.id}
            // T-Profile is unavailable on the Embossed surface (decision:
            // an embossed pattern is itself the visual interest, no extra
            // overlay), so force it off here regardless of the toggle's
            // last value on Flat / Grooving tabs.
            showTpatti={selectedSurfaceType === 'embossed' ? false : showTpatti}
            panelRows={selectedCategory?.id === "fabrics-designer-textile" ? (selectedDTEmboss?.panelRows ?? null) : selectedProductType?.id === "ombre" ? (FLAT_EMBOSSED_VMT_CONFIG[selectedCategory?.id]?.panelRows ?? null) : (selectedColorCoreEmboss?.panelRows ?? null)}
            panelFallbackColor={selectedProductType?.id === "ombre" ? (selectedOmbreBaseColor?.hex ?? null) : null}
            embossUrl={
              // Gate the entire preview on isConfigComplete — under the new
              // "every field is mandatory" rule the preview must stay blank
              // until every visible field is filled.
              !isConfigComplete
                ? null
                : selectedProductType?.id === "ombre"
                  ? ombreEmbossBlobUrl
                  : selectedCategory?.id === "wood-perforations"
                    ? woodPerfEmbossBlobUrl
                    : selectedCategory?.id === "fabrics-color-core"
                      ? (selectedColorCoreEmboss ? ccPanelBlobUrl : null)
                      : selectedCategory?.id === "fabrics-designer-textile"
                        ? (selectedDTEmboss ? dtPanelBlobUrl : null)
                        : fvpEmbossBlobUrl
            }
            // flipCenter: allow per-design override (`selectedDesign.mirror_center`) or
            // fall back to category-level `mirrorCenter` from FLAT_EMBOSSED_VMT_CONFIG.
            // Special case: Ellis groove pattern in Ombre Color Core always mirrors center.
            flipCenter={
              (selectedProductType?.id === "ombre" && selectedOmbreGroovePattern?.id === "ellis")
                ? true
                : selectedDesign?.mirror_center ??
                  (selectedCategory?.id ? FLAT_EMBOSSED_VMT_CONFIG[selectedCategory.id]?.mirrorCenter : false)
            }
            textureUrls={
              !isConfigComplete
                ? null
                // Ombre: never uses multi-column slices
                : selectedProductType?.id === "ombre"
                  ? null
                  // Continuous-pattern: blob URLs managed by useMultiBlobPanels
                  : selectedDesign?.panel_variant === "continuous" && fvpContinuousBlobUrls?.length
                    ? fvpContinuousBlobUrls
                    : null
            }
            textureUrl={
              !isConfigComplete
                ? null
                // Ombre Color Core: Blob URL — only 1 decoded panel in memory at a time
                : selectedProductType?.id === "ombre"
                  ? (ombrePanelBlobUrl ?? null)
                  // Color Core: Blob URL — only 1 decoded panel in memory at a time
                  : selectedCategory?.id === "fabrics-color-core"
                    ? (ccPanelBlobUrl ?? null)
                    // Designer Textile: Blob URL — only 1 decoded panel in memory at a time
                    : selectedCategory?.id === "fabrics-designer-textile"
                      ? (dtPanelBlobUrl ?? null)
                      // Single-texture: blob URL managed by useBlobPanel
                      : selectedDesign?.panel_variant !== "continuous"
                        ? fvpSingleBlobUrl
                        : null
            }
          />
        ) : selectedProductType?.id === "vicstrip" ? (
          <VicStripPreview
            ref={canvasRef}
            onLoadingChange={handleLoadingChange}
            // Gate on isConfigComplete — every field must be filled.
            textureUrl={isConfigComplete ? vicstripBlobUrl : null}
            fallbackColor={isConfigComplete ? (selectedDesign?.color?.hex || "#CCCCCC") : null}
            designLabel={`${selectedPattern?.id || "vicstrip"}-${selectedDesign?.color?.id || "design"}`}
          />
        ) : (
          <CanvasPreview
            ref={canvasRef}
            onLoadingChange={handleLoadingChange}
            textureColor={isConfigComplete ? selectedDesign?.texture_color : null}
            textureUrl={isConfigComplete ? canvasBlobUrl : null}
            selectedColor={selectedColor}
            size={selectedSize}
            isEmbossed={isEmbossed}
            productType={selectedProductType?.id}
          />
        )}
        {/* HDRI Lighting overlay — angle-driven gradient layers, pointer-events-none */}
        {hdriLighting !== 'none' && (() => {
          const _rad = (lightAngle * Math.PI) / 180;
          const lx = `${(50 + Math.sin(_rad) * 65).toFixed(1)}%`;
          const ly = `${(50 - Math.cos(_rad) * 65).toFixed(1)}%`;
          const fillAngle = (lightAngle + 180) % 360;
          const shadowAngle = lightAngle;
          if (hdriLighting === 'warm') return (
            <>
              {/* Key light: warm amber from the light direction */}
              <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 100,
                background: `radial-gradient(ellipse 100% 70% at ${lx} ${ly}, rgba(255,190,55,0.26) 0%, transparent 60%)`,
                mixBlendMode: 'overlay' }} />
              {/* Fill sweep from light direction */}
              <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 100,
                background: `linear-gradient(${fillAngle}deg, rgba(255,155,30,0.10), transparent)`,
                mixBlendMode: 'soft-light' }} />
              {/* Shadow on opposite side */}
              <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 100,
                background: `linear-gradient(${shadowAngle}deg, rgba(45,18,0,0.22), transparent 50%)`,
                mixBlendMode: 'multiply' }} />
            </>
          );
          if (hdriLighting === 'soft') return (
            <>
              {/* Soft diffuse from light direction */}
              <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 100,
                background: `radial-gradient(ellipse 150% 120% at ${lx} ${ly}, rgba(220,228,255,0.20) 0%, rgba(190,205,240,0.12) 55%, transparent 100%)`,
                mixBlendMode: 'screen' }} />
              {/* Soft fill from light direction */}
              <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 100,
                background: `linear-gradient(${fillAngle}deg, rgba(230,240,255,0.08), transparent)`,
                mixBlendMode: 'screen' }} />
            </>
          );
          return null;
        })()}
        </div>

        {/* ── Magnifier loupe ─────────────────────────────────────────── */}
        {/* Always in DOM so magnifierDivRef is available on mouseenter */}
        <div
          ref={magnifierDivRef}
          aria-hidden="true"
          style={{
            display: magnifierActive && !isDragging ? 'block' : 'none',
            position: 'absolute',
            width: MAGNIFIER_SIZE,
            height: MAGNIFIER_SIZE,
            borderRadius: '50%',
            overflow: 'hidden',
            border: '2.5px solid rgba(255,255,255,0.85)',
            boxShadow: '0 4px 24px rgba(0,0,0,0.35), inset 0 0 0 1px rgba(0,0,0,0.1)',
            pointerEvents: 'none',
            zIndex: 50,
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
          }}
        />
        </div>

        {/* Incomplete-selections note removed — the preview area now shows
            a centred "Select all fields to see the preview" placeholder when
            isConfigComplete is false, so this floating banner is redundant. */}

        {/* ── Selection mini cards — stacked at bottom-left of canvas area ── */}
        {configSummary.length > 0 && (
            <div
              className="absolute bottom-4 left-4 z-20 flex flex-col-reverse gap-1.5 items-start pointer-events-none"
              data-testid="selection-mini-cards"
            >
              {configSummary.map(({ label, value, color }) => (
                <div
                  key={label}
                  className="flex items-center gap-2 bg-white rounded-lg px-2.5 py-1 shadow-md border border-[hsl(var(--border))]"
                >
                  {color && (
                    <span
                      className="inline-block w-3 h-3 rounded-full flex-shrink-0 border border-black/10"
                      style={{ backgroundColor: color }}
                    />
                  )}
                  <span className="text-[10px] font-semibold text-[hsl(215,16%,50%)] uppercase tracking-wide leading-none">
                    {label}
                  </span>
                  <span className="text-[11px] font-medium text-[hsl(215,25%,27%)] leading-none max-w-[120px] truncate">
                    {value}
                  </span>
                </div>
              ))}
            </div>
          )}
      </main>

      </div>{/* end configurator-content */}

      {/* ── Request a Sample modal ─────────────────────────────────────── */}
      <Dialog open={requestSampleOpen} onOpenChange={setRequestSampleOpen}>
        <DialogContent
          className="max-w-lg p-0 overflow-hidden flex flex-col max-h-[90vh]"
          data-testid="request-sample-modal"
        >
          {/* Header strip with accent edge */}
          <div className="px-6 pt-6 pb-4 border-b border-[hsl(var(--border))] flex-shrink-0">
            <DialogHeader className="space-y-1">
              <DialogTitle className="font-manrope text-xl flex items-center gap-2 text-[hsl(215,25%,27%)]">
                <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-accent/10 text-accent">
                  <Package className="h-4 w-4" />
                </span>
                Request a Sample
              </DialogTitle>
              <p className="text-sm text-[hsl(215,16%,47%)] pl-9">
                We'll send a physical sample of this configuration to your address.
              </p>
            </DialogHeader>
          </div>

          <div className="px-6 py-5 space-y-5 overflow-y-auto flex-1 min-h-0">
            {/* Read-only configuration summary — mirrors the live preview. */}
            <div
              className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--secondary))]/40 overflow-hidden"
              data-testid="request-sample-summary"
            >
              <div className="px-4 py-2.5 bg-white/60 border-b border-[hsl(var(--border))]">
                <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-[hsl(215,25%,27%)]">
                  Your configuration
                </p>
              </div>
              <div className="px-4 py-3 space-y-2">
                {configSummary.length === 0 ? (
                  <p className="text-xs text-[hsl(215,16%,47%)]">No selection yet.</p>
                ) : (
                  configSummary.map(({ label, value, color }) => (
                    <div key={label} className="flex justify-between items-center gap-3 text-sm">
                      <span className="text-[hsl(215,16%,47%)] text-[11px] uppercase tracking-wider font-semibold">{label}</span>
                      <span className="font-semibold text-[hsl(215,25%,27%)] flex items-center gap-1.5 text-right truncate">
                        {color && (
                          <span
                            className="inline-block w-3.5 h-3.5 rounded-full flex-shrink-0 border border-black/10 shadow-inner"
                            style={{ backgroundColor: color }}
                          />
                        )}
                        <span className="truncate">{value}</span>
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* User-info form. Submission is a stub — wire to backend later. */}
            <form id="request-sample-form" onSubmit={handleRequestSampleSubmit} className="space-y-4" data-testid="request-sample-form">
              <div className="space-y-1.5">
                <Label htmlFor="req-name" className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(215,25%,27%)]">Name</Label>
                <Input
                  id="req-name"
                  type="text"
                  value={reqSampleForm.name}
                  onChange={(e) => setReqSampleForm((f) => ({ ...f, name: e.target.value }))}
                  required
                  placeholder="Full name"
                  className="h-10"
                  data-testid="req-name"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="req-email" className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(215,25%,27%)]">Email</Label>
                <Input
                  id="req-email"
                  type="email"
                  value={reqSampleForm.email}
                  onChange={(e) => setReqSampleForm((f) => ({ ...f, email: e.target.value }))}
                  required
                  placeholder="you@example.com"
                  className="h-10"
                  data-testid="req-email"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="req-region" className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(215,25%,27%)]">Region</Label>
                <Select
                  value={reqSampleForm.region}
                  onValueChange={(v) => setReqSampleForm((f) => ({ ...f, region: v }))}
                >
                  <SelectTrigger id="req-region" className="h-10" data-testid="req-region"><SelectValue placeholder="Select region" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="East">East</SelectItem>
                    <SelectItem value="North">North</SelectItem>
                    <SelectItem value="South">South</SelectItem>
                    <SelectItem value="West">West</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="req-qty" className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(215,25%,27%)]">Quantity</Label>
                  <Input
                    id="req-qty"
                    type="number"
                    min="1"
                    value={reqSampleForm.quantity}
                    onChange={(e) => setReqSampleForm((f) => ({ ...f, quantity: Math.max(1, parseInt(e.target.value) || 1) }))}
                    required
                    className="h-10"
                    data-testid="req-qty"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="req-size" className="text-[11px] font-semibold uppercase tracking-wider text-[hsl(215,25%,27%)]">Sample size</Label>
                  <Select
                    value={reqSampleForm.sampleSize}
                    onValueChange={(v) => setReqSampleForm((f) => ({ ...f, sampleSize: v }))}
                  >
                    <SelectTrigger id="req-size" className="h-10" data-testid="req-size"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="A3">A3</SelectItem>
                      <SelectItem value="A4">A4</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </form>
          </div>

          {/* Footer with submit action */}
          <div className="px-6 py-4 border-t border-[hsl(var(--border))] bg-[hsl(var(--secondary))]/30 flex-shrink-0">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] text-[hsl(215,16%,55%)]">
                We typically respond within 2 business days.
              </p>
              <Button
                type="submit"
                form="request-sample-form"
                disabled={
                  reqSampleSubmitting ||
                  !reqSampleForm.name.trim() ||
                  !reqSampleForm.email.trim() ||
                  !reqSampleForm.region
                }
                className="h-10 px-6 bg-accent hover:bg-accent-hover text-white font-medium shadow-sm disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
                data-testid="req-submit"
              >
                {reqSampleSubmitting ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                    Submitting…
                  </>
                ) : (
                  <>
                    Submit Request
                    <ArrowRight className="h-4 w-4 ml-1.5" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Floating chat button */}
      <button
        onClick={() => {
          // Computed outside the state updater: React may invoke an updater
          // twice under StrictMode, which would double-count the event.
          const next = !chatOpen;
          if (next) track("chat_opened"); // opens only — a close isn't interesting
          setChatOpen(next);
        }}
        className="fixed border-[0.4px] border-black bottom-6 right-6 z-[300] w-14 h-14 rounded-full shadow-xl flex items-center justify-center transition-transform hover:scale-110 active:scale-95"
        style={{ background: 'hsl(0, 0%, 91%)' }}
        aria-label="Chat with us"
        data-testid="chat-fab"
      >
        <img src="/chat-icon.png" alt="Chat" className="w-11 h-11 object-contain" />
        {/* <MessageCircle className="h-6 w-6 text-white" /> */}
      </button>

      <ChatWidget open={chatOpen} onClose={() => setChatOpen(false)} />

      {showBootOverlay && (
        <div className="fixed inset-0 z-[100] bg-white flex items-center justify-center" data-testid="boot-overlay" aria-hidden="true">
          <img src="/UV-loader.png" alt="Loading..." className="uv-loader" />
        </div>
      )}
    </div>
  );
};

export default Configurator;
