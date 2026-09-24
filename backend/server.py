from fastapi import FastAPI, APIRouter, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse, Response
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import sys
import logging
import time
from collections import defaultdict
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional
import json
import hashlib
from datetime import datetime, timezone, timedelta
from html import escape as _h  # HTML-attribute / body escaping for admin dashboard
from chat_knowledge import SYSTEM_PROMPT

# Python 3.14 introduced a strict assertion in _SelectorSocketTransport._write_send()
# that fires when the write callback is invoked after the buffer has already been
# drained (e.g. client disconnect mid-response). The assertion is benign — an empty
# buffer means there is nothing to send — but it floods the error log. Patch it out
# so that _write_send simply returns early when there is no data pending.
if sys.version_info >= (3, 14):
    try:
        import asyncio.selector_events as _sel
        _orig_write_send = _sel._SelectorSocketTransport._write_send

        def _guarded_write_send(self):
            if not self._buffer:
                return
            _orig_write_send(self)

        _sel._SelectorSocketTransport._write_send = _guarded_write_send
    except Exception:
        pass

try:
    from PIL import Image, ImageOps
    PIL_AVAILABLE = True
except ImportError:
    PIL_AVAILABLE = False
    logging.warning("Pillow not installed — /thumb/ endpoint will serve originals. Run: pip install Pillow")


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

CHAT_LOGS_DIR = ROOT_DIR / "chatbot_logs"
CHAT_LOGS_DIR.mkdir(exist_ok=True)

# Create the main app without a prefix
app = FastAPI()

# Serve static assets (images) from backend/static/ (only if the directory exists)
_static_dir = ROOT_DIR / "static"
if _static_dir.exists():
    app.mount("/static", StaticFiles(directory=_static_dir), name="static")

# Serve pre-generated catalog JSON from backend/data/
# This mirrors the S3 layout so the frontend works unchanged locally.
# Run scripts/dump_catalog.py first if backend/data/ doesn't exist yet.
_data_dir = ROOT_DIR / "data"
if _data_dir.exists():
    app.mount("/data", StaticFiles(directory=_data_dir), name="data")

@app.get("/health")
def health():
    return {"status": "ok"}

THUMB_CACHE_DIR = ROOT_DIR / "static" / "_thumbcache"
THUMB_SIZE = (200, 200)

@app.get("/thumb/{path:path}")
def serve_thumbnail(path: str):
    """
    Serves a resized thumbnail for any image under /static/images/.
    First call resizes + caches to static/_thumbcache/; subsequent calls
    return the cached file immediately.
    """
    source = ROOT_DIR / "static" / "images" / path
    if not source.exists():
        raise HTTPException(status_code=404, detail=f"Image not found: {path}")

    cached = THUMB_CACHE_DIR / path

    if not cached.exists():
        if not PIL_AVAILABLE:
            # Pillow missing — fall back to serving the original
            return FileResponse(source)
        cached.parent.mkdir(parents=True, exist_ok=True)
        with Image.open(source) as img:
            # Composite transparent images onto a white background before JPEG
            # save. Without this, RGBA/palette PNGs render with black where
            # transparent — common for line-drawing emboss thumbnails.
            if img.mode in ("RGBA", "LA", "P"):
                converted = img.convert("RGBA")
                background = Image.new("RGBA", converted.size, (255, 255, 255, 255))
                background.paste(converted, mask=converted.split()[3])
                img = background.convert("RGB")
            else:
                img = img.convert("RGB")
            # Center-crop + resize to exact square — mirrors CSS background-size:cover
            thumb = ImageOps.fit(img, THUMB_SIZE, Image.LANCZOS)
            thumb.save(cached, format="JPEG", quality=82, optimize=True)

    return FileResponse(cached, media_type="image/jpeg")

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

@app.get("/tech-specs/{filename}")
def serve_tech_spec_pdf(filename: str):
    """
    Directly streams the requested technical spec PDF so browsers open it
    inline regardless of spaces or parentheses in the filename.
    """
    # Prevent path traversal: filename must be a plain name with no separators
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")
    pdf_path = (ROOT_DIR / "static" / "technical_specification_pdfs" / filename).resolve()
    allowed_dir = (ROOT_DIR / "static" / "technical_specification_pdfs").resolve()
    if not str(pdf_path).startswith(str(allowed_dir)):
        raise HTTPException(status_code=400, detail="Invalid filename")
    if not pdf_path.exists() or pdf_path.suffix.lower() != ".pdf":
        raise HTTPException(status_code=404, detail="Technical specification not found")
    return FileResponse(
        pdf_path,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )

# Define Models
class ProductDesign(BaseModel):
    id: str
    product_type: str
    category: str
    design_code: str
    design_name: str
    texture_url: str
    thumbnail_url: str
    size: Optional[str] = None
    density: Optional[str] = None
    pattern: Optional[str] = None
    color: Optional[str] = None
    thickness: Optional[str] = None
    emboss: Optional[bool] = None
    # "single" → one texture repeated across all columns (default)
    # "continuous" → each column gets its own texture slice ({code}-1.jpg, -2.jpg, -3.jpg)
    panel_variant: str = "single"
    # Populated only when panel_variant == "continuous"
    texture_urls: Optional[List[str]] = None
    # Emboss pattern IDs available for this design (empty = emboss not supported)
    available_emboss: List[str] = []

class ProductCategory(BaseModel):
    id: str
    name: str
    product_type: str
    emboss_available: bool = False
    designs: List[ProductDesign] = []

class ProductType(BaseModel):
    id: str
    name: str
    active: bool
    sizes: List[str] = []
    densities: List[str] = []
    patterns: List[str] = []
    colors: List[str] = []
    thicknesses: List[str] = []
    categories: List[ProductCategory] = []


# Technical specifications for panels
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
    "colored-hd-ombre": {
        "fire_rating": "Class A (ASTM E84)",
        "nrc_rating": "0.80 - 0.90",
        "sustainability": ["Recycled Content 60%", "GREENGUARD Gold", "Red List Free"],
        "material": "HD Acoustic Felt",
        "thickness_mm": "9-12mm",
        "weight_kg_m2": "1.8 - 2.2",
        "installation": "Adhesive Mount",
        "warranty": "8 Years",
        "certifications": ["ISO 14001", "Declare Label", "HPD"]
    },
    "ombre": {
        "fire_rating": "Class A (ASTM E84)",
        "nrc_rating": "0.80 - 0.90",
        "sustainability": ["Recycled Content 60%", "GREENGUARD Gold", "Red List Free"],
        "material": "HD Acoustic Felt",
        "thickness_mm": "9-12mm",
        "weight_kg_m2": "1.8 - 2.2",
        "installation": "Adhesive Mount",
        "warranty": "8 Years",
        "certifications": ["ISO 14001", "Declare Label", "HPD"]
    },
    "wood": {
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
    "fabrics": {
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
    "vicstrip": {
        "fire_rating": "Class B (ASTM E84)",
        "nrc_rating": "0.70 - 0.85",
        "sustainability": ["FSC Certified Wood", "Low VOC", "Red List Free"],
        "material": "MDF Core + Acoustic Backing",
        "thickness_mm": "12-25mm",
        "weight_kg_m2": "3.2 - 5.5",
        "installation": "Rail System / Direct Fix",
        "warranty": "15 Years",
        "certifications": ["ISO 14001", "PEFC", "EPD Verified"]
    }
}

# Mock Product Data
def generate_mock_products():
    """Generate mock product data for all product types"""
    
    # Solid color placeholders for textures
    solid_colors = [
        "#D4A574",  # Warm tan
        "#8B7355",  # Brown
        "#A0522D",  # Sienna
        "#CD853F",  # Peru
        "#DEB887",  # Burlywood
        "#BC8F8F",  # Rosy brown
        "#F5DEB3",  # Wheat
        "#D2B48C",  # Tan
        "#C4A484",  # Light brown
        "#9E8B6E",  # Khaki brown
    ]
    
    products = []
    
    # 1. Flat / Embossed VMD Panels
    vmd_categories_non_emboss = [
        "Nature Reimagined", "Marble"
    ]
    vmd_categories_emboss = ["Leather"]
    
    vmd_panel = {
        "id": "flat-embossed-vmd",
        "name": "Bespoke Graphics",
        "active": True,
        "sizes": ["1200x2400", "1200x2800"],
        "densities": [],
        "patterns": [],
        "colors": [],
        "thicknesses": ["12mm (PET Panel)", "25mm (PET Panel)", "PET Wool"],
        "categories": []
    }
    
    # ── Explicit designs for categories that have real assets ────────────────
    # To add a design: copy one block, increment the id/code, update the name,
    # set texture_color as a hex fallback, and point texture_url / thumbnail_url
    # at the file under backend/static/images/flat-embossed-vmt/panels/{cat-id}/
    EXPLICIT_CATEGORY_DESIGNS = {
        "Line & Texture": [
            {
                "id": "vmd-design-lt-001",
                "product_type": "flat-embossed-vmd",
                "category": "Line & Texture",
                "design_code": "AB-BL-02",
                "design_name": "AB-BL-02",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-line-and-texture/AB-BL-02.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-line-and-texture/AB-BL-02.jpg",
                "color_name": "AB-BL-02",
            },
            {
                "id": "vmd-design-lt-002",
                "product_type": "flat-embossed-vmd",
                "category": "Line & Texture",
                "design_code": "AB-NC-04",
                "design_name": "AB-NC-04",
                "texture_color": "#FFFFFF",
                "panel_variant": "continuous",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-line-and-texture/AB-NC-04-PANEL-A.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-line-and-texture/AB-NC-04-PANEL-A.jpg",
                "texture_urls": [
                    "/static/images/flat-embossed-vmt/panels/vmd-line-and-texture/AB-NC-04-PANEL-A.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-line-and-texture/AB-NC-04-PANEL-B.jpg",
                ],
                "color_name": "AB-NC-04",
            },
            {
                "id": "vmd-design-lt-003",
                "product_type": "flat-embossed-vmd",
                "category": "Line & Texture",
                "design_code": "AB-NC-07",
                "design_name": "AB-NC-07",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-line-and-texture/AB-NC-07.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-line-and-texture/AB-NC-07.jpg",
                "color_name": "AB-NC-07",
            },
            {
                "id": "vmd-design-lt-004",
                "product_type": "flat-embossed-vmd",
                "category": "Line & Texture",
                "design_code": "AB-NC-09",
                "design_name": "AB-NC-09",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-line-and-texture/AB-NC-09.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-line-and-texture/AB-NC-09.jpg",
                "color_name": "AB-NC-09",
            },
            {
                "id": "vmd-design-lt-005",
                "product_type": "flat-embossed-vmd",
                "category": "Line & Texture",
                "design_code": "AB-NC-11",
                "design_name": "AB-NC-11",
                "texture_color": "#FFFFFF",
                "panel_variant": "continuous",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-line-and-texture/AB-NC-11-PanelA.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-line-and-texture/AB-NC-11-PanelA.jpg",
                "texture_urls": [
                    "/static/images/flat-embossed-vmt/panels/vmd-line-and-texture/AB-NC-11-PanelA.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-line-and-texture/AB-NC-11-PanelB.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-line-and-texture/AB-NC-11-PanelC.jpg",
                ],
                "color_name": "AB-NC-11",
            },
            {
                "id": "vmd-design-lt-006",
                "product_type": "flat-embossed-vmd",
                "category": "Line & Texture",
                "design_code": "AB-NE-03",
                "design_name": "AB-NE-03",
                "texture_color": "#FFFFFF",
                "panel_variant": "continuous",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-line-and-texture/AB-NE-03_PanelA.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-line-and-texture/AB-NE-03_PanelA.jpg",
                "texture_urls": [
                    "/static/images/flat-embossed-vmt/panels/vmd-line-and-texture/AB-NE-03_PanelA.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-line-and-texture/AB-NE-03_PanelB.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-line-and-texture/AB-NE-03_PanelC.jpg",
                ],
                "color_name": "AB-NE-03",
            },
            {
                "id": "vmd-design-lt-007",
                "product_type": "flat-embossed-vmd",
                "category": "Line & Texture",
                "design_code": "FB-PT-34",
                "design_name": "FB-PT-34",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-line-and-texture/FB-PT-34.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-line-and-texture/FB-PT-34.jpg",
                "color_name": "FB-PT-34",
            },
            {
                "id": "vmd-design-lt-008",
                "product_type": "flat-embossed-vmd",
                "category": "Line & Texture",
                "design_code": "FB-PT-37",
                "design_name": "FB-PT-37",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-line-and-texture/FB-PT-37.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-line-and-texture/FB-PT-37.jpg",
                "color_name": "FB-PT-37",
            },
            {
                "id": "vmd-design-lt-009",
                "product_type": "flat-embossed-vmd",
                "category": "Line & Texture",
                "design_code": "FB-PT-66",
                "design_name": "FB-PT-66",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-line-and-texture/FB-PT-66.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-line-and-texture/FB-PT-66.jpg",
                "color_name": "FB-PT-66",
            },
            {
                "id": "vmd-design-lt-010",
                "product_type": "flat-embossed-vmd",
                "category": "Line & Texture",
                "design_code": "SR-NC-01",
                "design_name": "SR-NC-01",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-line-and-texture/SR-NC-01.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-line-and-texture/SR-NC-01.jpg",
                "color_name": "SR-NC-01",
            },
            {
                "id": "vmd-design-lt-011",
                "product_type": "flat-embossed-vmd",
                "category": "Line & Texture",
                "design_code": "SR-NC-05",
                "design_name": "SR-NC-05",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-line-and-texture/SR-NC-05.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-line-and-texture/SR-NC-05.jpg",
                "color_name": "SR-NC-05",
            },
            {
                "id": "vmd-design-lt-012",
                "product_type": "flat-embossed-vmd",
                "category": "Line & Texture",
                "design_code": "SR-NC-08",
                "design_name": "SR-NC-08",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-line-and-texture/SR-NC-08.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-line-and-texture/SR-NC-08.jpg",
                "color_name": "SR-NC-08",
            },
            {
                "id": "vmd-design-lt-013",
                "product_type": "flat-embossed-vmd",
                "category": "Line & Texture",
                "design_code": "SR-NC-09",
                "design_name": "SR-NC-09",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-line-and-texture/SR-NC-09.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-line-and-texture/SR-NC-09.jpg",
                "color_name": "SR-NC-09",
            },
            {
                "id": "vmd-design-lt-014",
                "product_type": "flat-embossed-vmd",
                "category": "Line & Texture",
                "design_code": "SR-NC-10",
                "design_name": "SR-NC-10",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-line-and-texture/SR-NC-10.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-line-and-texture/SR-NC-10.jpg",
                "color_name": "SR-NC-10",
            },
            {
                "id": "vmd-design-lt-015",
                "product_type": "flat-embossed-vmd",
                "category": "Line & Texture",
                "design_code": "SR-NC-11",
                "design_name": "SR-NC-11",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-line-and-texture/SR-NC-11.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-line-and-texture/SR-NC-11.jpg",
                "color_name": "SR-NC-11",
            },
            {
                "id": "vmd-design-lt-016",
                "product_type": "flat-embossed-vmd",
                "category": "Line & Texture",
                "design_code": "SR-NC-12",
                "design_name": "SR-NC-12",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-line-and-texture/SR-NC-12.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-line-and-texture/SR-NC-12.jpg",
                "color_name": "SR-NC-12",
            },
            {
                "id": "vmd-design-lt-017",
                "product_type": "flat-embossed-vmd",
                "category": "Line & Texture",
                "design_code": "SR-NC-14",
                "design_name": "SR-NC-14",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-line-and-texture/SR-NC-14.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-line-and-texture/SR-NC-14.jpg",
                "color_name": "SR-NC-14",
            },
            {
                "id": "vmd-design-lt-018",
                "product_type": "flat-embossed-vmd",
                "category": "Line & Texture",
                "design_code": "SR-NC-15",
                "design_name": "SR-NC-15",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-line-and-texture/SR-NC-15.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-line-and-texture/SR-NC-15.jpg",
                "color_name": "SR-NC-15",
            },
            {
                "id": "vmd-design-lt-019",
                "product_type": "flat-embossed-vmd",
                "category": "Line & Texture",
                "design_code": "SR-NC-16",
                "design_name": "SR-NC-16",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-line-and-texture/SR-NC-16.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-line-and-texture/SR-NC-16.jpg",
                "color_name": "SR-NC-16",
            },
            {
                "id": "vmd-design-lt-020",
                "product_type": "flat-embossed-vmd",
                "category": "Line & Texture",
                "design_code": "WP-NC-08",
                "design_name": "WP-NC-08",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-line-and-texture/WP-NC-08.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-line-and-texture/WP-NC-08.jpg",
                "color_name": "WP-NC-08",
            },
            {
                "id": "vmd-design-lt-021",
                "product_type": "flat-embossed-vmd",
                "category": "Line & Texture",
                "design_code": "WP-NC-11",
                "design_name": "WP-NC-11",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-line-and-texture/WP-NC-11.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-line-and-texture/WP-NC-11.jpg",
                "color_name": "WP-NC-11",
            },
            # ── Add more Line & Texture designs here ──────────────────────
        ],
        "Rhythm & Repeat": [
            {
                "id": "vmd-design-rr-001",
                "product_type": "flat-embossed-vmd",
                "category": "Rhythm & Repeat",
                "design_code": "AB-BL-03",
                "design_name": "AB-BL-03",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/AB-BL-03.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/AB-BL-03.jpg",
                "color_name": "AB-BL-03",
            },
            {
                "id": "vmd-design-rr-002",
                "product_type": "flat-embossed-vmd",
                "category": "Rhythm & Repeat",
                "design_code": "AB-GR-01",
                "design_name": "AB-GR-01",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/AB-GR-01.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/AB-GR-01.jpg",
                "color_name": "AB-GR-01",
            },
            {
                "id": "vmd-design-rr-003",
                "product_type": "flat-embossed-vmd",
                "category": "Rhythm & Repeat",
                "design_code": "AB-GR-02",
                "design_name": "AB-GR-02",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/AB-GR-02.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/AB-GR-02.jpg",
                "color_name": "AB-GR-02",
            },
            {
                "id": "vmd-design-rr-004",
                "product_type": "flat-embossed-vmd",
                "category": "Rhythm & Repeat",
                "design_code": "AB-GR-03",
                "design_name": "AB-GR-03",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/AB-GR-03.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/AB-GR-03.jpg",
                "color_name": "AB-GR-03",
            },
            {
                "id": "vmd-design-rr-005",
                "product_type": "flat-embossed-vmd",
                "category": "Rhythm & Repeat",
                "design_code": "AB-GR-04",
                "design_name": "AB-GR-04",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/AB-GR-04.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/AB-GR-04.jpg",
                "color_name": "AB-GR-04",
            },
            {
                "id": "vmd-design-rr-006",
                "product_type": "flat-embossed-vmd",
                "category": "Rhythm & Repeat",
                "design_code": "AB-GY-01",
                "design_name": "AB-GY-01",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/AB-GY-01.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/AB-GY-01.jpg",
                "color_name": "AB-GY-01",
            },
            {
                "id": "vmd-design-rr-007",
                "product_type": "flat-embossed-vmd",
                "category": "Rhythm & Repeat",
                "design_code": "AB-GY-02",
                "design_name": "AB-GY-02",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/AB-GY-02.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/AB-GY-02.jpg",
                "color_name": "AB-GY-02",
            },
            {
                "id": "vmd-design-rr-008",
                "product_type": "flat-embossed-vmd",
                "category": "Rhythm & Repeat",
                "design_code": "AB-GY-03",
                "design_name": "AB-GY-03",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/AB-GY-03.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/AB-GY-03.jpg",
                "color_name": "AB-GY-03",
            },
            {
                "id": "vmd-design-rr-009",
                "product_type": "flat-embossed-vmd",
                "category": "Rhythm & Repeat",
                "design_code": "AB-NC-06",
                "design_name": "AB-NC-06",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/AB-NC-06.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/AB-NC-06.jpg",
                "color_name": "AB-NC-06",
            },
            {
                "id": "vmd-design-rr-010",
                "product_type": "flat-embossed-vmd",
                "category": "Rhythm & Repeat",
                "design_code": "AB-NC-08",
                "design_name": "AB-NC-08",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/AB-NC-08.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/AB-NC-08.jpg",
                "color_name": "AB-NC-08",
            },
            {
                "id": "vmd-design-rr-011",
                "product_type": "flat-embossed-vmd",
                "category": "Rhythm & Repeat",
                "design_code": "AB-NC-16",
                "design_name": "AB-NC-16",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/AB-NC-16.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/AB-NC-16.jpg",
                "color_name": "AB-NC-16",
            },
            {
                "id": "vmd-design-rr-012",
                "product_type": "flat-embossed-vmd",
                "category": "Rhythm & Repeat",
                "design_code": "AB-NC-18",
                "design_name": "AB-NC-18",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/AB-NC-18.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/AB-NC-18.jpg",
                "color_name": "AB-NC-18",
            },
            {
                "id": "vmd-design-rr-013",
                "product_type": "flat-embossed-vmd",
                "category": "Rhythm & Repeat",
                "design_code": "AB-NE-01",
                "design_name": "AB-NE-01",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/AB-NE-01.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/AB-NE-01.jpg",
                "color_name": "AB-NE-01",
            },
            {
                "id": "vmd-design-rr-014",
                "product_type": "flat-embossed-vmd",
                "category": "Rhythm & Repeat",
                "design_code": "AB-OR-02",
                "design_name": "AB-OR-02",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/AB-OR-02.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/AB-OR-02.jpg",
                "color_name": "AB-OR-02",
            },
            {
                "id": "vmd-design-rr-015",
                "product_type": "flat-embossed-vmd",
                "category": "Rhythm & Repeat",
                "design_code": "AB-OR-03",
                "design_name": "AB-OR-03",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/AB-OR-03.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/AB-OR-03.jpg",
                "color_name": "AB-OR-03",
            },
            {
                "id": "vmd-design-rr-016",
                "product_type": "flat-embossed-vmd",
                "category": "Rhythm & Repeat",
                "design_code": "AB-OR-04",
                "design_name": "AB-OR-04",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/AB-OR-04.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/AB-OR-04.jpg",
                "color_name": "AB-OR-04",
            },
            {
                "id": "vmd-design-rr-017",
                "product_type": "flat-embossed-vmd",
                "category": "Rhythm & Repeat",
                "design_code": "AB-PU-01",
                "design_name": "AB-PU-01",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/AB-PU-01.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/AB-PU-01.jpg",
                "color_name": "AB-PU-01",
            },
            {
                "id": "vmd-design-rr-018",
                "product_type": "flat-embossed-vmd",
                "category": "Rhythm & Repeat",
                "design_code": "WP-BL-05",
                "design_name": "WP-BL-05",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/WP-BL-05.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/WP-BL-05.jpg",
                "color_name": "WP-BL-05",
            },
            {
                "id": "vmd-design-rr-019",
                "product_type": "flat-embossed-vmd",
                "category": "Rhythm & Repeat",
                "design_code": "WP-GR-01",
                "design_name": "WP-GR-01",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/WP-GR-01.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/WP-GR-01.jpg",
                "color_name": "WP-GR-01",
            },
            {
                "id": "vmd-design-rr-020",
                "product_type": "flat-embossed-vmd",
                "category": "Rhythm & Repeat",
                "design_code": "WP-NC-09",
                "design_name": "WP-NC-09",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/WP-NC-09.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/WP-NC-09.jpg",
                "color_name": "WP-NC-09",
            },
            {
                "id": "vmd-design-rr-021",
                "product_type": "flat-embossed-vmd",
                "category": "Rhythm & Repeat",
                "design_code": "WP-OR-01",
                "design_name": "WP-OR-01",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/WP-OR-01.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/WP-OR-01.jpg",
                "color_name": "WP-OR-01",
            },
            {
                "id": "vmd-design-rr-022",
                "product_type": "flat-embossed-vmd",
                "category": "Rhythm & Repeat",
                "design_code": "WP-PK-01",
                "design_name": "WP-PK-01",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/WP-PK-01.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/WP-PK-01.jpg",
                "color_name": "WP-PK-01",
            },
            {
                "id": "vmd-design-rr-023",
                "product_type": "flat-embossed-vmd",
                "category": "Rhythm & Repeat",
                "design_code": "WP-RD-01",
                "design_name": "WP-RD-01",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/WP-RD-01.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/WP-RD-01.jpg",
                "color_name": "WP-RD-01",
            },
            {
                "id": "vmd-design-rr-024",
                "product_type": "flat-embossed-vmd",
                "category": "Rhythm & Repeat",
                "design_code": "WP-RD-02",
                "design_name": "WP-RD-02",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/WP-RD-02.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/WP-RD-02.jpg",
                "color_name": "WP-RD-02",
            },
            {
                "id": "vmd-design-rr-025",
                "product_type": "flat-embossed-vmd",
                "category": "Rhythm & Repeat",
                "design_code": "WP-YL-01",
                "design_name": "WP-YL-01",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/WP-YL-01.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-rhythm-and-repeat/WP-YL-01.jpg",
                "color_name": "WP-YL-01",
            },
            # ── Add more Rhythm & Repeat designs here ─────────────────────
        ],
        "Quiet Bloom": [
            {
                "id": "vmd-design-qb-001",
                "product_type": "flat-embossed-vmd",
                "category": "Quiet Bloom",
                "design_code": "NA-NC-01",
                "design_name": "NA-NC-01",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-quiet-bloom/NA-NC-01.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-quiet-bloom/NA-NC-01.jpg",
                "color_name": "NA-NC-01",
            },
            {
                "id": "vmd-design-qb-002",
                "product_type": "flat-embossed-vmd",
                "category": "Quiet Bloom",
                "design_code": "NA-NC-02",
                "design_name": "NA-NC-02",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-quiet-bloom/NA-NC-02.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-quiet-bloom/NA-NC-02.jpg",
                "color_name": "NA-NC-02",
            },
            {
                "id": "vmd-design-qb-003",
                "product_type": "flat-embossed-vmd",
                "category": "Quiet Bloom",
                "design_code": "NA-NC-05",
                "design_name": "NA-NC-05",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-quiet-bloom/NA-NC-05.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-quiet-bloom/NA-NC-05.jpg",
                "color_name": "NA-NC-05",
            },
            {
                "id": "vmd-design-qb-004",
                "product_type": "flat-embossed-vmd",
                "category": "Quiet Bloom",
                "design_code": "NA-NC-06",
                "design_name": "NA-NC-06",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-quiet-bloom/NA-NC-06.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-quiet-bloom/NA-NC-06.jpg",
                "color_name": "NA-NC-06",
            },
            {
                "id": "vmd-design-qb-005",
                "product_type": "flat-embossed-vmd",
                "category": "Quiet Bloom",
                "design_code": "NA-NC-07",
                "design_name": "NA-NC-07",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-quiet-bloom/NA-NC-07.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-quiet-bloom/NA-NC-07.jpg",
                "color_name": "NA-NC-07",
            },
            {
                "id": "vmd-design-qb-006",
                "product_type": "flat-embossed-vmd",
                "category": "Quiet Bloom",
                "design_code": "NA-NC-10",
                "design_name": "NA-NC-10",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-quiet-bloom/NA-NC-10.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-quiet-bloom/NA-NC-10.jpg",
                "color_name": "NA-NC-10",
            },
            {
                "id": "vmd-design-qb-007",
                "product_type": "flat-embossed-vmd",
                "category": "Quiet Bloom",
                "design_code": "NA-NC-11",
                "design_name": "NA-NC-11",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-quiet-bloom/NA-NC-11.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-quiet-bloom/NA-NC-11.jpg",
                "color_name": "NA-NC-11",
            },
            {
                "id": "vmd-design-qb-008",
                "product_type": "flat-embossed-vmd",
                "category": "Quiet Bloom",
                "design_code": "NA-NC-12",
                "design_name": "NA-NC-12",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-quiet-bloom/NA-NC-12.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-quiet-bloom/NA-NC-12.jpg",
                "color_name": "NA-NC-12",
            },
            {
                "id": "vmd-design-qb-009",
                "product_type": "flat-embossed-vmd",
                "category": "Quiet Bloom",
                "design_code": "NA-NC-15",
                "design_name": "NA-NC-15",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-quiet-bloom/NA-NC-15.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-quiet-bloom/NA-NC-15.jpg",
                "color_name": "NA-NC-15",
            },
            # ── Add more Quiet Bloom designs here ─────────────────────────
        ],
        "Indian Modern": [
            {
                "id": "vmd-design-im-001",
                "product_type": "flat-embossed-vmd",
                "category": "Indian Modern",
                "design_code": "FB-PT-35",
                "design_name": "FB-PT-35",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-indian-modern/FB-PT-35.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-indian-modern/FB-PT-35.jpg",
                "color_name": "FB-PT-35",
            },
            {
                "id": "vmd-design-im-002",
                "product_type": "flat-embossed-vmd",
                "category": "Indian Modern",
                "design_code": "FB-PT-36",
                "design_name": "FB-PT-36",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-indian-modern/FB-PT-36.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-indian-modern/FB-PT-36.jpg",
                "color_name": "FB-PT-36",
            },
            {
                "id": "vmd-design-im-003",
                "product_type": "flat-embossed-vmd",
                "category": "Indian Modern",
                "design_code": "FB-PT-38",
                "design_name": "FB-PT-38",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-indian-modern/FB-PT-38.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-indian-modern/FB-PT-38.jpg",
                "color_name": "FB-PT-38",
            },
            {
                "id": "vmd-design-im-004",
                "product_type": "flat-embossed-vmd",
                "category": "Indian Modern",
                "design_code": "FB-PT-67",
                "design_name": "FB-PT-67",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-indian-modern/FB-PT-67.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-indian-modern/FB-PT-67.jpg",
                "color_name": "FB-PT-67",
            },
            {
                "id": "vmd-design-im-005",
                "product_type": "flat-embossed-vmd",
                "category": "Indian Modern",
                "design_code": "FB-PT-68",
                "design_name": "FB-PT-68",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-indian-modern/FB-PT-68.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-indian-modern/FB-PT-68.jpg",
                "color_name": "FB-PT-68",
            },
            {
                "id": "vmd-design-im-006",
                "product_type": "flat-embossed-vmd",
                "category": "Indian Modern",
                "design_code": "FB-PT-70",
                "design_name": "FB-PT-70",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-indian-modern/FB-PT-70.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-indian-modern/FB-PT-70.jpg",
                "color_name": "FB-PT-70",
            },
            {
                "id": "vmd-design-im-007",
                "product_type": "flat-embossed-vmd",
                "category": "Indian Modern",
                "design_code": "IND-NC-01",
                "design_name": "IND-NC-01",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-indian-modern/IND-NC-01.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-indian-modern/IND-NC-01.jpg",
                "color_name": "IND-NC-01",
            },
            {
                "id": "vmd-design-im-008",
                "product_type": "flat-embossed-vmd",
                "category": "Indian Modern",
                "design_code": "IND-NC-02",
                "design_name": "IND-NC-02",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-indian-modern/IND-NC-02.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-indian-modern/IND-NC-02.jpg",
                "color_name": "IND-NC-02",
            },
            {
                "id": "vmd-design-im-009",
                "product_type": "flat-embossed-vmd",
                "category": "Indian Modern",
                "design_code": "IND-NC-04",
                "design_name": "IND-NC-04",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-indian-modern/IND-NC-04.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-indian-modern/IND-NC-04.jpg",
                "color_name": "IND-NC-04",
            },
            {
                "id": "vmd-design-im-010",
                "product_type": "flat-embossed-vmd",
                "category": "Indian Modern",
                "design_code": "IND-NC-05",
                "design_name": "IND-NC-05",
                "texture_color": "#FFFFFF",
                "panel_variant": "continuous",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-indian-modern/IND-NC-05-Panel1.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-indian-modern/IND-NC-05-Panel1.jpg",
                "texture_urls": [
                    "/static/images/flat-embossed-vmt/panels/vmd-indian-modern/IND-NC-05-Panel1.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-indian-modern/IND-NC-05-Panel2.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-indian-modern/IND-NC-05-Panel1.jpg",
                ],
                "color_name": "IND-NC-05",
            },
            {
                "id": "vmd-design-im-011",
                "product_type": "flat-embossed-vmd",
                "category": "Indian Modern",
                "design_code": "IND-NC-06",
                "design_name": "IND-NC-06",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-indian-modern/IND-NC-06.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-indian-modern/IND-NC-06.jpg",
                "color_name": "IND-NC-06",
            },
            {
                "id": "vmd-design-im-012",
                "product_type": "flat-embossed-vmd",
                "category": "Indian Modern",
                "design_code": "NA-RD-03",
                "design_name": "NA-RD-03",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-indian-modern/NA-RD-03.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-indian-modern/NA-RD-03.jpg",
                "color_name": "NA-RD-03",
            },
            {
                "id": "vmd-design-im-013",
                "product_type": "flat-embossed-vmd",
                "category": "Indian Modern",
                "design_code": "WP-GR-03",
                "design_name": "WP-GR-03",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-indian-modern/WP-GR-03.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-indian-modern/WP-GR-03.jpg",
                "color_name": "WP-GR-03",
            },
            # ── Add more Indian Modern designs here ───────────────────────
        ],
        "Color Block": [
            {
                "id": "vmd-design-cb-001",
                "product_type": "flat-embossed-vmd",
                "category": "Color Block",
                "design_code": "AB-BL-04",
                "design_name": "AB-BL-04",
                "texture_color": "#FFFFFF",
                "panel_variant": "continuous",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-color-block/AB-BL-04_PanelA.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-color-block/AB-BL-04_PanelA.jpg",
                "texture_urls": [
                    "/static/images/flat-embossed-vmt/panels/vmd-color-block/AB-BL-04_PanelA.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-color-block/AB-BL-04_PanelB.jpg",
                ],
                "color_name": "AB-BL-04",
            },
            {
                "id": "vmd-design-cb-002",
                "product_type": "flat-embossed-vmd",
                "category": "Color Block",
                "design_code": "AB-BL-05",
                "design_name": "AB-BL-05",
                "texture_color": "#FFFFFF",
                "panel_variant": "continuous",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-color-block/AB-BL-05_PanelA.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-color-block/AB-BL-05_PanelA.jpg",
                "texture_urls": [
                    "/static/images/flat-embossed-vmt/panels/vmd-color-block/AB-BL-05_PanelA.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-color-block/AB-BL-05_PanelB.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-color-block/AB-BL-05_PanelC.jpg",
                ],
                "color_name": "AB-BL-05",
            },
            {
                "id": "vmd-design-cb-003",
                "product_type": "flat-embossed-vmd",
                "category": "Color Block",
                "design_code": "AB-NC-01",
                "design_name": "AB-NC-01",
                "texture_color": "#FFFFFF",
                "panel_variant": "continuous",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-color-block/AB-NC-01-PanelA.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-color-block/AB-NC-01-PanelA.jpg",
                "texture_urls": [
                    "/static/images/flat-embossed-vmt/panels/vmd-color-block/AB-NC-01-PanelA.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-color-block/AB-NC-01-PanelB.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-color-block/AB-NC-01-PanelC.jpg",
                ],
                "color_name": "AB-NC-01",
            },
            {
                "id": "vmd-design-cb-004",
                "product_type": "flat-embossed-vmd",
                "category": "Color Block",
                "design_code": "AB-NC-02",
                "design_name": "AB-NC-02",
                "texture_color": "#FFFFFF",
                "panel_variant": "continuous",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-color-block/AB-NC-02-PanelA.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-color-block/AB-NC-02-PanelA.jpg",
                "texture_urls": [
                    "/static/images/flat-embossed-vmt/panels/vmd-color-block/AB-NC-02-PanelA.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-color-block/AB-NC-02-PanelB.jpg",
                ],
                "color_name": "AB-NC-02",
            },
            {
                "id": "vmd-design-cb-005",
                "product_type": "flat-embossed-vmd",
                "category": "Color Block",
                "design_code": "AB-NC-10",
                "design_name": "AB-NC-10",
                "texture_color": "#FFFFFF",
                "panel_variant": "continuous",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-color-block/AB-NC-10-PanelA.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-color-block/AB-NC-10-PanelA.jpg",
                "texture_urls": [
                    "/static/images/flat-embossed-vmt/panels/vmd-color-block/AB-NC-10-PanelA.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-color-block/AB-NC-10-PanelB.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-color-block/AB-NC-10-PanelC.jpg",
                ],
                "color_name": "AB-NC-10",
            },
            {
                "id": "vmd-design-cb-006",
                "product_type": "flat-embossed-vmd",
                "category": "Color Block",
                "design_code": "AB-NC-17",
                "design_name": "AB-NC-17",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-color-block/AB-NC-17.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-color-block/AB-NC-17.jpg",
                "color_name": "AB-NC-17",
            },
            {
                "id": "vmd-design-cb-007",
                "product_type": "flat-embossed-vmd",
                "category": "Color Block",
                "design_code": "AB-NC-19",
                "design_name": "AB-NC-19",
                "texture_color": "#FFFFFF",
                "panel_variant": "continuous",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-color-block/AB-NC-19_PanelA.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-color-block/AB-NC-19_PanelA.jpg",
                "texture_urls": [
                    "/static/images/flat-embossed-vmt/panels/vmd-color-block/AB-NC-19_PanelA.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-color-block/AB-NC-19_PanelB.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-color-block/AB-NC-19_PanelC.jpg",
                ],
                "color_name": "AB-NC-19",
            },
            {
                "id": "vmd-design-cb-008",
                "product_type": "flat-embossed-vmd",
                "category": "Color Block",
                "design_code": "AB-NE-02",
                "design_name": "AB-NE-02",
                "texture_color": "#FFFFFF",
                "panel_variant": "continuous",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-color-block/AB-NE-02_PanelA.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-color-block/AB-NE-02_PanelA.jpg",
                "texture_urls": [
                    "/static/images/flat-embossed-vmt/panels/vmd-color-block/AB-NE-02_PanelA.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-color-block/AB-NE-02_PanelB.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-color-block/AB-NE-02_PanelC.jpg",
                ],
                "color_name": "AB-NE-02",
            },
            {
                "id": "vmd-design-cb-009",
                "product_type": "flat-embossed-vmd",
                "category": "Color Block",
                "design_code": "AB-OR-05",
                "design_name": "AB-OR-05",
                "texture_color": "#FFFFFF",
                "panel_variant": "continuous",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-color-block/AB-OR-05_PanelA.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-color-block/AB-OR-05_PanelA.jpg",
                "texture_urls": [
                    "/static/images/flat-embossed-vmt/panels/vmd-color-block/AB-OR-05_PanelA.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-color-block/AB-OR-05_PanelB.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-color-block/AB-OR-05_PanelC.jpg",
                ],
                "color_name": "AB-OR-05",
            },
            # ── Add more Color Block designs here ─────────────────────────
        ],
        "Fun & Fantasy": [
            {
                "id": "vmd-design-ff-001",
                "product_type": "flat-embossed-vmd",
                "category": "Fun & Fantasy",
                "design_code": "WP-NC-01",
                "design_name": "WP-NC-01",
                "texture_color": "#FFFFFF",
                "panel_variant": "continuous",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-fun-and-fantasy/WP-NC-01-PanelA.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-fun-and-fantasy/WP-NC-01-PanelA.jpg",
                "texture_urls": [
                    "/static/images/flat-embossed-vmt/panels/vmd-fun-and-fantasy/WP-NC-01-PanelA.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-fun-and-fantasy/WP-NC-01-PanelB.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-fun-and-fantasy/WP-NC-01-PanelC.jpg",
                ],
                "color_name": "WP-NC-01",
            },
            {
                "id": "vmd-design-ff-002",
                "product_type": "flat-embossed-vmd",
                "category": "Fun & Fantasy",
                "design_code": "WP-NC-02",
                "design_name": "WP-NC-02",
                "texture_color": "#FFFFFF",
                "panel_variant": "continuous",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-fun-and-fantasy/WP-NC-02-PanelA.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-fun-and-fantasy/WP-NC-02-PanelA.jpg",
                "texture_urls": [
                    "/static/images/flat-embossed-vmt/panels/vmd-fun-and-fantasy/WP-NC-02-PanelA.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-fun-and-fantasy/WP-NC-02-PanelB.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-fun-and-fantasy/WP-NC-02-PanelC.jpg",
                ],
                "color_name": "WP-NC-02",
            },
            {
                "id": "vmd-design-ff-003",
                "product_type": "flat-embossed-vmd",
                "category": "Fun & Fantasy",
                "design_code": "WP-NC-03",
                "design_name": "WP-NC-03",
                "texture_color": "#FFFFFF",
                "panel_variant": "continuous",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-fun-and-fantasy/WP-NC-03-PanelA.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-fun-and-fantasy/WP-NC-03-PanelA.jpg",
                "texture_urls": [
                    "/static/images/flat-embossed-vmt/panels/vmd-fun-and-fantasy/WP-NC-03-PanelA.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-fun-and-fantasy/WP-NC-03-PanelB.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-fun-and-fantasy/WP-NC-03-PanelC.jpg",
                ],
                "color_name": "WP-NC-03",
            },
            # ── Add more Fun & Fantasy designs here ───────────────────────
        ],
        "Marble": [
            # {
                # "id": "vmd-design-mb-001",
                # "product_type": "flat-embossed-vmd",
                # "category": "Marble",
                # "design_code": "ST-NC-01",
                # "design_name": "ST-NC-01",
                # "texture_color": "#FFFFFF",
                # "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-marble/ST-NC-01.jpg",
                # "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-marble/ST-NC-01.jpg",
                # "color_name": "ST-NC-01",
                # "available_emboss": [],
            # },
            # {
                # "id": "vmd-design-mb-002",
                # "product_type": "flat-embossed-vmd",
                # "category": "Marble",
                # "design_code": "ST-NC-02",
                # "design_name": "ST-NC-02",
                # "texture_color": "#FFFFFF",
                # "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-marble/ST-NC-02.jpg",
                # "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-marble/ST-NC-02.jpg",
                # "color_name": "ST-NC-02",
                # "available_emboss": [],
            # },
            {
                "id": "vmd-design-mb-003",
                "product_type": "flat-embossed-vmd",
                "category": "Marble",
                "design_code": "ST-NC-03",
                "design_name": "ST-NC-03",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-marble/ST-NC-03.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-marble/ST-NC-03.jpg",
                "color_name": "ST-NC-03",
                "available_emboss": ["flux_ribbed", "ribbed_45mm", "ribbed_60mm", "tappered"],
            },
            {
                "id": "vmd-design-mb-004",
                "product_type": "flat-embossed-vmd",
                "category": "Marble",
                "design_code": "ST-NC-04",
                "design_name": "ST-NC-04",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-marble/ST-NC-04.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-marble/ST-NC-04.jpg",
                "color_name": "ST-NC-04",
                "available_emboss": ["flux_ribbed", "ribbed_45mm", "ribbed_60mm", "tappered"],
            },
            {
                "id": "vmd-design-mb-005",
                "product_type": "flat-embossed-vmd",
                "category": "Marble",
                "design_code": "ST-NC-05",
                "design_name": "ST-NC-05",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-marble/ST-NC-05.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-marble/ST-NC-05.jpg",
                "color_name": "ST-NC-05",
                "available_emboss": ["flux_ribbed", "ribbed_45mm", "ribbed_60mm", "tappered"],
            },
            {
                "id": "vmd-design-mb-006",
                "product_type": "flat-embossed-vmd",
                "category": "Marble",
                "design_code": "ST-NC-06",
                "design_name": "ST-NC-06",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-marble/ST-NC-06.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-marble/ST-NC-06.jpg",
                "color_name": "ST-NC-06",
                "available_emboss": [],
            },
            # {
                # "id": "vmd-design-mb-007",
                # "product_type": "flat-embossed-vmd",
                # "category": "Marble",
                # "design_code": "ST-NC-07",
                # "design_name": "ST-NC-07",
                # "texture_color": "#FFFFFF",
                # "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-marble/ST-NC-07.jpg",
                # "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-marble/ST-NC-07.jpg",
                # "color_name": "ST-NC-07",
                # "available_emboss": [],
            # },
            # {
                # "id": "vmd-design-mb-008",
                # "product_type": "flat-embossed-vmd",
                # "category": "Marble",
                # "design_code": "ST-NC-08",
                # "design_name": "ST-NC-08",
                # "texture_color": "#FFFFFF",
                # "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-marble/ST-NC-08.jpg",
                # "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-marble/ST-NC-08.jpg",
                # "color_name": "ST-NC-08",
                # "available_emboss": [],
            # },
            # {
                # "id": "vmd-design-mb-009",
                # "product_type": "flat-embossed-vmd",
                # "category": "Marble",
                # "design_code": "ST-NC-09",
                # "design_name": "ST-NC-09",
                # "texture_color": "#FFFFFF",
                # "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-marble/ST-NC-09.jpg",
                # "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-marble/ST-NC-09.jpg",
                # "color_name": "ST-NC-09",
                # "available_emboss": [],
            # },
            {
                "id": "vmd-design-mb-010",
                "product_type": "flat-embossed-vmd",
                "category": "Marble",
                "design_code": "ST-NC-10",
                "design_name": "ST-NC-10",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-marble/ST-NC-10.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-marble/ST-NC-10.jpg",
                "color_name": "ST-NC-10",
                "available_emboss": [],
            },
            {
                "id": "vmd-design-mb-011",
                "product_type": "flat-embossed-vmd",
                "category": "Marble",
                "design_code": "ST-NC-11",
                "design_name": "ST-NC-11",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-marble/ST-NC-11.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-marble/ST-NC-11.jpg",
                "color_name": "ST-NC-11",
                "available_emboss": [],
            },
            {
                "id": "vmd-design-mb-012",
                "product_type": "flat-embossed-vmd",
                "category": "Marble",
                "design_code": "ST-NC-12",
                "design_name": "ST-NC-12",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-marble/ST-NC-12.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-marble/ST-NC-12.jpg",
                "color_name": "ST-NC-12",
                "available_emboss": [],
            },
            # {
                # "id": "vmd-design-mb-013",
                # "product_type": "flat-embossed-vmd",
                # "category": "Marble",
                # "design_code": "ST-NC-13",
                # "design_name": "ST-NC-13",
                # "texture_color": "#FFFFFF",
                # "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-marble/ST-NC-13.jpg",
                # "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-marble/ST-NC-13.jpg",
                # "color_name": "ST-NC-13",
                # "available_emboss": [],
            # },
            {
                "id": "vmd-design-mb-014",
                "product_type": "flat-embossed-vmd",
                "category": "Marble",
                "design_code": "ST-NC-14",
                "design_name": "ST-NC-14",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-marble/ST-NC-14.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-marble/ST-NC-14.jpg",
                "color_name": "ST-NC-14",
                "available_emboss": ["flux_ribbed", "ribbed_45mm", "ribbed_60mm", "tappered"],
            },
            {
                "id": "vmd-design-mb-015",
                "product_type": "flat-embossed-vmd",
                "category": "Marble",
                "design_code": "ST-NC-15",
                "design_name": "ST-NC-15",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-marble/ST-NC-15.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-marble/ST-NC-15.jpg",
                "color_name": "ST-NC-15",
                "available_emboss": [],
            },
            {
                "id": "vmd-design-mb-016",
                "product_type": "flat-embossed-vmd",
                "category": "Marble",
                "design_code": "ST-NC-16",
                "design_name": "ST-NC-16",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-marble/ST-NC-16.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-marble/ST-NC-16.jpg",
                "color_name": "ST-NC-16",
                "available_emboss": [],
            },
            # {
                # "id": "vmd-design-mb-017",
                # "product_type": "flat-embossed-vmd",
                # "category": "Marble",
                # "design_code": "ST-NC-17",
                # "design_name": "ST-NC-17",
                # "texture_color": "#FFFFFF",
                # "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-marble/ST-NC-17.jpg",
                # "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-marble/ST-NC-17.jpg",
                # "color_name": "ST-NC-17",
                # "available_emboss": [],
            # },
            {
                "id": "vmd-design-mb-018",
                "product_type": "flat-embossed-vmd",
                "category": "Marble",
                "design_code": "ST-NC-18",
                "design_name": "ST-NC-18",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-marble/ST-NC-18.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-marble/ST-NC-18.jpg",
                "color_name": "ST-NC-18",
                "available_emboss": [],
            },
            {
                "id": "vmd-design-mb-019",
                "product_type": "flat-embossed-vmd",
                "category": "Marble",
                "design_code": "ST-NC-19",
                "design_name": "ST-NC-19",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-marble/ST-NC19.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-marble/ST-NC19.jpg",
                "color_name": "ST-NC-19",
                "available_emboss": ["flux_ribbed", "ribbed_45mm", "ribbed_60mm", "tappered"],
            },
            {
                "id": "vmd-design-mb-020",
                "product_type": "flat-embossed-vmd",
                "category": "Marble",
                "design_code": "ST-NC-20",
                "design_name": "ST-NC-20",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-marble/ST-NC-20.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-marble/ST-NC-20.jpg",
                "color_name": "ST-NC-20",
                "available_emboss": ["flux_ribbed", "ribbed_45mm", "ribbed_60mm", "tappered"],
            },
            {
                "id": "vmd-design-mb-021",
                "product_type": "flat-embossed-vmd",
                "category": "Marble",
                "design_code": "ST-NC-21",
                "design_name": "ST-NC-21",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-marble/ST-NC-21.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-marble/ST-NC-21.jpg",
                "color_name": "ST-NC-21",
                "available_emboss": [],
            },
            # {
                # "id": "vmd-design-mb-022",
                # "product_type": "flat-embossed-vmd",
                # "category": "Marble",
                # "design_code": "ST-NC-22",
                # "design_name": "ST-NC-22",
                # "texture_color": "#FFFFFF",
                # "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-marble/ST-NC-22.jpg",
                # "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-marble/ST-NC-22.jpg",
                # "color_name": "ST-NC-22",
                # "available_emboss": [],
            # },
            # {
                # "id": "vmd-design-mb-023",
                # "product_type": "flat-embossed-vmd",
                # "category": "Marble",
                # "design_code": "ST-NC-23",
                # "design_name": "ST-NC-23",
                # "texture_color": "#FFFFFF",
                # "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-marble/ST-NC-23.jpg",
                # "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-marble/ST-NC-23.jpg",
                # "color_name": "ST-NC-23",
                # "available_emboss": [],
            # },
            # {
                # "id": "vmd-design-mb-024",
                # "product_type": "flat-embossed-vmd",
                # "category": "Marble",
                # "design_code": "ST-NC-24",
                # "design_name": "ST-NC-24",
                # "texture_color": "#FFFFFF",
                # "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-marble/ST-NC-24.jpg",
                # "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-marble/ST-NC-24.jpg",
                # "color_name": "ST-NC-24",
                # "available_emboss": [],
            # },
            {
                "id": "vmd-design-mb-025",
                "product_type": "flat-embossed-vmd",
                "category": "Marble",
                "design_code": "ST-NC-25",
                "design_name": "ST-NC-25",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-marble/ST-NC-25.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-marble/ST-NC-25.jpg",
                "color_name": "ST-NC-25",
                "available_emboss": [],
            },
            {
                "id": "vmd-design-mb-026",
                "product_type": "flat-embossed-vmd",
                "category": "Marble",
                "design_code": "ST-NC-26",
                "design_name": "ST-NC-26",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-marble/ST-NC-26.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-marble/ST-NC-26.jpg",
                "color_name": "ST-NC-26",
                "available_emboss": [],
            },
            {
                "id": "vmd-design-mb-027",
                "product_type": "flat-embossed-vmd",
                "category": "Marble",
                "design_code": "ST-NC-27",
                "design_name": "ST-NC-27",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-marble/ST-NC-27.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-marble/ST-NC-27.jpg",
                "color_name": "ST-NC-27",
                "available_emboss": ["flux_ribbed", "ribbed_45mm", "ribbed_60mm", "tappered"],
            },
            # {
                # "id": "vmd-design-mb-028",
                # "product_type": "flat-embossed-vmd",
                # "category": "Marble",
                # "design_code": "ST-NC-28",
                # "design_name": "ST-NC-28",
                # "texture_color": "#FFFFFF",
                # "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-marble/ST-NC-28.jpg",
                # "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-marble/ST-NC-28.jpg",
                # "color_name": "ST-NC-28",
                # "available_emboss": [],
            # },
            # {
                # "id": "vmd-design-mb-029",
                # "product_type": "flat-embossed-vmd",
                # "category": "Marble",
                # "design_code": "ST-NC-29",
                # "design_name": "ST-NC-29",
                # "texture_color": "#FFFFFF",
                # "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-marble/ST-NC-29.jpg",
                # "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-marble/ST-NC-29.jpg",
                # "color_name": "ST-NC-29",
                # "available_emboss": [],
            # },
            {
                "id": "vmd-design-mb-030",
                "product_type": "flat-embossed-vmd",
                "category": "Marble",
                "design_code": "ST-NC-30",
                "design_name": "ST-NC-30",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-marble/ST-NC-30.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-marble/ST-NC-30.jpg",
                "color_name": "ST-NC-30",
                "available_emboss": [],
            },
            {
                "id": "vmd-design-mb-031",
                "product_type": "flat-embossed-vmd",
                "category": "Marble",
                "design_code": "ST-NC-31",
                "design_name": "ST-NC-31",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-marble/ST-NC-31.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-marble/ST-NC-31.jpg",
                "color_name": "ST-NC-31",
                "available_emboss": ["flux_ribbed", "ribbed_45mm", "ribbed_60mm", "tappered"],
            },
            {
                "id": "vmd-design-mb-032",
                "product_type": "flat-embossed-vmd",
                "category": "Marble",
                "design_code": "ST-NC-32",
                "design_name": "ST-NC-32",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-marble/ST-NC-32.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-marble/ST-NC-32.jpg",
                "color_name": "ST-NC-32",
                "available_emboss": ["flux_ribbed", "ribbed_45mm", "ribbed_60mm", "tappered"],
            },
            # ── Add more Marble designs here ──────────────────────────────
        ],
        "Luxury Textures": [
            {
                "id": "vmd-design-lx-001",
                "product_type": "flat-embossed-vmd",
                "category": "Luxury Textures",
                "design_code": "FB-PT-39",
                "design_name": "FB-PT-39",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-luxury-textures/FB-PT-39.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-luxury-textures/FB-PT-39.jpg",
                "color_name": "FB-PT-39",
            },
            {
                "id": "vmd-design-lx-002",
                "product_type": "flat-embossed-vmd",
                "category": "Luxury Textures",
                "design_code": "FB-PT-40",
                "design_name": "FB-PT-40",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-luxury-textures/FB-PT-40.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-luxury-textures/FB-PT-40.jpg",
                "color_name": "FB-PT-40",
            },
            {
                "id": "vmd-design-lx-003",
                "product_type": "flat-embossed-vmd",
                "category": "Luxury Textures",
                "design_code": "FB-PT-41",
                "design_name": "FB-PT-41",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-luxury-textures/FB-PT-41.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-luxury-textures/FB-PT-41.jpg",
                "color_name": "FB-PT-41",
            },
            {
                "id": "vmd-design-lx-004",
                "product_type": "flat-embossed-vmd",
                "category": "Luxury Textures",
                "design_code": "FB-PT-42",
                "design_name": "FB-PT-42",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-luxury-textures/FB-PT-42.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-luxury-textures/FB-PT-42.jpg",
                "color_name": "FB-PT-42",
            },
            {
                "id": "vmd-design-lx-005",
                "product_type": "flat-embossed-vmd",
                "category": "Luxury Textures",
                "design_code": "FB-PT-69",
                "design_name": "FB-PT-69",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-luxury-textures/FB-PT-69.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-luxury-textures/FB-PT-69.jpg",
                "color_name": "FB-PT-69",
            },
            {
                "id": "vmd-design-lx-006",
                "product_type": "flat-embossed-vmd",
                "category": "Luxury Textures",
                "design_code": "FB-PT-75",
                "design_name": "FB-PT-75",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-luxury-textures/FB-PT-75.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-luxury-textures/FB-PT-75.jpg",
                "color_name": "FB-PT-75",
            },
            {
                "id": "vmd-design-lx-007",
                "product_type": "flat-embossed-vmd",
                "category": "Luxury Textures",
                "design_code": "FB-PT-76",
                "design_name": "FB-PT-76",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-luxury-textures/FB-PT-76.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-luxury-textures/FB-PT-76.jpg",
                "color_name": "FB-PT-76",
            },
            {
                "id": "vmd-design-lx-008",
                "product_type": "flat-embossed-vmd",
                "category": "Luxury Textures",
                "design_code": "FB-PT-77",
                "design_name": "FB-PT-77",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-luxury-textures/FB-PT-77.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-luxury-textures/FB-PT-77.jpg",
                "color_name": "FB-PT-77",
            },
            {
                "id": "vmd-design-lx-009",
                "product_type": "flat-embossed-vmd",
                "category": "Luxury Textures",
                "design_code": "FB-PT-78",
                "design_name": "FB-PT-78",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-luxury-textures/FB-PT-78.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-luxury-textures/FB-PT-78.jpg",
                "color_name": "FB-PT-78",
            },
            {
                "id": "vmd-design-lx-010",
                "product_type": "flat-embossed-vmd",
                "category": "Luxury Textures",
                "design_code": "FB-PT-79",
                "design_name": "FB-PT-79",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-luxury-textures/FB-PT-79.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-luxury-textures/FB-PT-79.jpg",
                "color_name": "FB-PT-79",
            },
            {
                "id": "vmd-design-lx-011",
                "product_type": "flat-embossed-vmd",
                "category": "Luxury Textures",
                "design_code": "FB-PT-81",
                "design_name": "FB-PT-81",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-luxury-textures/FB-PT-81.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-luxury-textures/FB-PT-81.jpg",
                "color_name": "FB-PT-81",
            },
            {
                "id": "vmd-design-lx-012",
                "product_type": "flat-embossed-vmd",
                "category": "Luxury Textures",
                "design_code": "FB-PT-82",
                "design_name": "FB-PT-82",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-luxury-textures/FB-PT-82.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-luxury-textures/FB-PT-82.jpg",
                "color_name": "FB-PT-82",
            },
            {
                "id": "vmd-design-lx-013",
                "product_type": "flat-embossed-vmd",
                "category": "Luxury Textures",
                "design_code": "FB-PT-83",
                "design_name": "FB-PT-83",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-luxury-textures/FB-PT-83.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-luxury-textures/FB-PT-83.jpg",
                "color_name": "FB-PT-83",
            },
            {
                "id": "vmd-design-lx-014",
                "product_type": "flat-embossed-vmd",
                "category": "Luxury Textures",
                "design_code": "FB-PT-84",
                "design_name": "FB-PT-84",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-luxury-textures/FB-PT-84.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-luxury-textures/FB-PT-84.jpg",
                "color_name": "FB-PT-84",
            },
            {
                "id": "vmd-design-lx-015",
                "product_type": "flat-embossed-vmd",
                "category": "Luxury Textures",
                "design_code": "FB-PT-85",
                "design_name": "FB-PT-85",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-luxury-textures/FB-PT-85.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-luxury-textures/FB-PT-85.jpg",
                "color_name": "FB-PT-85",
            },
            {
                "id": "vmd-design-lx-016",
                "product_type": "flat-embossed-vmd",
                "category": "Luxury Textures",
                "design_code": "FB-PT-86",
                "design_name": "FB-PT-86",
                "texture_color": "#FFFFFF",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-luxury-textures/FB-PT-86.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-luxury-textures/FB-PT-86.jpg",
                "color_name": "FB-PT-86",
            },
        ],
        "Leather": [
            {"id":"vmd-design-lh-001", "product_type": "flat-embossed-vmd", "category": "Leather", "design_code": "LH-BR-01", "design_name": "LH-BR-01", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-leather/LH-BR-01.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-leather/LH-BR-01.jpg", "color_name": "LH-BR-01", "available_emboss": ["flux_ribbed","ribbed_45mm","ribbed_60mm","tappered","triangle","square_30","aqualine"]},
            {"id":"vmd-design-lh-002", "product_type": "flat-embossed-vmd", "category": "Leather", "design_code": "LH-BR-02", "design_name": "LH-BR-02", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-leather/LH-BR-02.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-leather/LH-BR-02.jpg", "color_name": "LH-BR-02", "available_emboss": ["flux_ribbed","ribbed_45mm","ribbed_60mm","tappered","triangle","aqualine"]},
            {"id":"vmd-design-lh-003", "product_type": "flat-embossed-vmd", "category": "Leather", "design_code": "LH-BR-03", "design_name": "LH-BR-03", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-leather/LH-BR-03.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-leather/LH-BR-03.jpg", "color_name": "LH-BR-03", "available_emboss": ["flux_ribbed","ribbed_45mm","ribbed_60mm","tappered","triangle","aqualine"]},
            {"id":"vmd-design-lh-004", "product_type": "flat-embossed-vmd", "category": "Leather", "design_code": "LH-BR-04", "design_name": "LH-BR-04", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-leather/LH-BR-04.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-leather/LH-BR-04.jpg", "color_name": "LH-BR-04", "available_emboss": ["flux_ribbed","ribbed_45mm","ribbed_60mm","tappered","triangle","aqualine"]},
            {"id":"vmd-design-lh-005", "product_type": "flat-embossed-vmd", "category": "Leather", "design_code": "LH-BR-05", "design_name": "LH-BR-05", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-leather/LH-BR-05.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-leather/LH-BR-05.jpg", "color_name": "LH-BR-05", "available_emboss": ["flux_ribbed","ribbed_45mm","ribbed_60mm","tappered","triangle","aqualine"]},
            {"id":"vmd-design-lh-006", "product_type": "flat-embossed-vmd", "category": "Leather", "design_code": "LH-BR-06", "design_name": "LH-BR-06", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-leather/LH-BR-06.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-leather/LH-BR-06.jpg", "color_name": "LH-BR-06", "available_emboss": ["flux_ribbed","ribbed_45mm","ribbed_60mm","tappered","triangle","aqualine"]},
            {"id":"vmd-design-lh-007", "product_type": "flat-embossed-vmd", "category": "Leather", "design_code": "LH-GR-01", "design_name": "LH-GR-01", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-leather/LH-GR-01.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-leather/LH-GR-01.jpg", "color_name": "LH-GR-01", "available_emboss": ["flux_ribbed","ribbed_45mm","ribbed_60mm","tappered","triangle","aqualine"]},
            {"id":"vmd-design-lh-008", "product_type": "flat-embossed-vmd", "category": "Leather", "design_code": "LH-GY-01", "design_name": "LH-GY-01", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-leather/LH-GY-01.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-leather/LH-GY-01.jpg", "color_name": "LH-GY-01", "available_emboss": ["flux_ribbed","ribbed_45mm","ribbed_60mm","tappered","triangle","aqualine"]},
            {"id":"vmd-design-lh-009", "product_type": "flat-embossed-vmd", "category": "Leather", "design_code": "LH-GY-02", "design_name": "LH-GY-02", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-leather/LH-GY-02.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-leather/LH-GY-02.jpg", "color_name": "LH-GY-02", "available_emboss": ["flux_ribbed","ribbed_45mm","ribbed_60mm","tappered","triangle","aqualine"]},
            {"id":"vmd-design-lh-010", "product_type": "flat-embossed-vmd", "category": "Leather", "design_code": "LH-NE-01", "design_name": "LH-NE-01", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-leather/LH-NE-01.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-leather/LH-NE-01.jpg", "color_name": "LH-NE-01", "available_emboss": ["flux_ribbed","ribbed_45mm","ribbed_60mm","tappered","triangle","aqualine"]},
            {"id":"vmd-design-lh-011", "product_type": "flat-embossed-vmd", "category": "Leather", "design_code": "LH-NE-02", "design_name": "LH-NE-02", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-leather/LH-NE-02.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-leather/LH-NE-02.jpg", "color_name": "LH-NE-02", "available_emboss": ["flux_ribbed","ribbed_45mm","ribbed_60mm","tappered","triangle","aqualine"]},
        ],
        "Woven Brushwork": [
            {"id": "vmd-design-wb-001", "product_type": "flat-embossed-vmd", "category": "Woven Brushwork", "design_code": "AB-BL-01", "design_name": "AB-BL-01", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-woven-brushwork/AB-BL-01.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-woven-brushwork/AB-BL-01.jpg", "color_name": "AB-BL-01"},
            {"id": "vmd-design-wb-002", "product_type": "flat-embossed-vmd", "category": "Woven Brushwork", "design_code": "AB-NC-05", "design_name": "AB-NC-05", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-woven-brushwork/AB-NC-05.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-woven-brushwork/AB-NC-05.jpg", "color_name": "AB-NC-05"},
            {"id": "vmd-design-wb-003", "product_type": "flat-embossed-vmd", "category": "Woven Brushwork", "design_code": "AB-NC-12", "design_name": "AB-NC-12", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-woven-brushwork/AB-NC-12.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-woven-brushwork/AB-NC-12.jpg", "color_name": "AB-NC-12"},
            {
                "id": "vmd-design-wb-004", "product_type": "flat-embossed-vmd", "category": "Woven Brushwork", "design_code": "SR-NC-02", "design_name": "SR-NC-02", "texture_color": "#FFFFFF",
                "panel_variant": "continuous",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-woven-brushwork/SR-NC-02-PanelA.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-woven-brushwork/SR-NC-02-PanelA.jpg",
                "texture_urls": [
                    "/static/images/flat-embossed-vmt/panels/vmd-woven-brushwork/SR-NC-02-PanelA.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-woven-brushwork/SR-NC-02-PanelB.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-woven-brushwork/SR-NC-02-PanelA.jpg",
                ],
                "color_name": "SR-NC-02",
            },
            {"id": "vmd-design-wb-005", "product_type": "flat-embossed-vmd", "category": "Woven Brushwork", "design_code": "SR-NC-03", "design_name": "SR-NC-03", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-woven-brushwork/SR-NC-03.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-woven-brushwork/SR-NC-03.jpg", "color_name": "SR-NC-03"},
            {"id": "vmd-design-wb-006", "product_type": "flat-embossed-vmd", "category": "Woven Brushwork", "design_code": "SR-NC-04", "design_name": "SR-NC-04", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-woven-brushwork/SR-NC-04.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-woven-brushwork/SR-NC-04.jpg", "color_name": "SR-NC-04"},
            {"id": "vmd-design-wb-007", "product_type": "flat-embossed-vmd", "category": "Woven Brushwork", "design_code": "SR-NC-06", "design_name": "SR-NC-06", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-woven-brushwork/SR-NC-06.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-woven-brushwork/SR-NC-06.jpg", "color_name": "SR-NC-06"},
            {
                "id": "vmd-design-wb-008", "product_type": "flat-embossed-vmd", "category": "Woven Brushwork", "design_code": "SR-NC-13", "design_name": "SR-NC-13", "texture_color": "#FFFFFF",
                "panel_variant": "continuous",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-woven-brushwork/SR-NC-13-PanelA.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-woven-brushwork/SR-NC-13-PanelA.jpg",
                "texture_urls": [
                    "/static/images/flat-embossed-vmt/panels/vmd-woven-brushwork/SR-NC-13-PanelA.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-woven-brushwork/SR-NC-13-PanelB.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-woven-brushwork/SR-NC-13-PanelA.jpg",
                ],
                "color_name": "SR-NC-13",
            },
            {"id": "vmd-design-wb-009", "product_type": "flat-embossed-vmd", "category": "Woven Brushwork", "design_code": "SR-NC-18", "design_name": "SR-NC-18", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-woven-brushwork/SR-NC-18.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-woven-brushwork/SR-NC-18.jpg", "color_name": "SR-NC-18"},
            {"id": "vmd-design-wb-010", "product_type": "flat-embossed-vmd", "category": "Woven Brushwork", "design_code": "WP-BR-01", "design_name": "WP-BR-01", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-woven-brushwork/WP-BR-01.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-woven-brushwork/WP-BR-01.jpg", "color_name": "WP-BR-01"},
            {"id": "vmd-design-wb-011", "product_type": "flat-embossed-vmd", "category": "Woven Brushwork", "design_code": "WP-NC-07", "design_name": "WP-NC-07", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-woven-brushwork/WP-NC-07.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-woven-brushwork/WP-NC-07.jpg", "color_name": "WP-NC-07"},
        ],
        "Nature Reimagined": [
            {
                "id": "vmd-design-nr-001", "product_type": "flat-embossed-vmd", "category": "Nature Reimagined", "design_code": "NA-BL-01", "design_name": "NA-BL-01", "texture_color": "#FFFFFF",
                "panel_variant": "continuous",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-BL-01-PanelA.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-BL-01-PanelA.jpg",
                "texture_urls": [
                    "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-BL-01-PanelA.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-BL-01-PanelB.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-BL-01-PanelC.jpg",
                ],
                "color_name": "NA-BL-01",
            },
            {
                "id": "vmd-design-nr-002", "product_type": "flat-embossed-vmd", "category": "Nature Reimagined", "design_code": "NA-BL-02", "design_name": "NA-BL-02", "texture_color": "#FFFFFF",
                "panel_variant": "continuous",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-BL-02-PanelA.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-BL-02-PanelA.jpg",
                "texture_urls": [
                    "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-BL-02-PanelA.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-BL-02-PanelB.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-BL-02-PanelC.jpg",
                ],
                "color_name": "NA-BL-02",
            },
            {"id": "vmd-design-nr-003", "product_type": "flat-embossed-vmd", "category": "Nature Reimagined", "design_code": "NA-BL-03", "design_name": "NA-BL-03", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-BL-03.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-BL-03.jpg", "color_name": "NA-BL-03"},
            {
                "id": "vmd-design-nr-004", "product_type": "flat-embossed-vmd", "category": "Nature Reimagined", "design_code": "NA-GR-01", "design_name": "NA-GR-01", "texture_color": "#FFFFFF",
                "panel_variant": "continuous",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-GR-01-PanelA.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-GR-01-PanelA.jpg",
                "texture_urls": [
                    "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-GR-01-PanelA.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-GR-01-PanelB.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-GR-01-PanelC.jpg",
                ],
                "color_name": "NA-GR-01",
            },
            {
                "id": "vmd-design-nr-005", "product_type": "flat-embossed-vmd", "category": "Nature Reimagined", "design_code": "NA-GR-02", "design_name": "NA-GR-02", "texture_color": "#FFFFFF",
                "panel_variant": "continuous",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-GR-02-PanelA.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-GR-02-PanelA.jpg",
                "texture_urls": [
                    "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-GR-02-PanelA.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-GR-02-PanelB.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-GR-02-PanelC.jpg",
                ],
                "color_name": "NA-GR-02",
            },
            # {"id": "vmd-design-nr-006", "product_type": "flat-embossed-vmd", "category": "Nature Reimagined", "design_code": "NA-GR-03", "design_name": "NA-GR-03", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-GR-03.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-GR-03.jpg", "color_name": "NA-GR-03"},
            # {"id": "vmd-design-nr-007", "product_type": "flat-embossed-vmd", "category": "Nature Reimagined", "design_code": "NA-GR-04", "design_name": "NA-GR-04", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-GR-04.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-GR-04.jpg", "color_name": "NA-GR-04"},
            {"id": "vmd-design-nr-008", "product_type": "flat-embossed-vmd", "category": "Nature Reimagined", "design_code": "NA-GR-05", "design_name": "NA-GR-05", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-GR-05.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-GR-05.jpg", "color_name": "NA-GR-05"},
            # {"id": "vmd-design-nr-009", "product_type": "flat-embossed-vmd", "category": "Nature Reimagined", "design_code": "NA-NC-16", "design_name": "NA-NC-16", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-NC-16.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-NC-16.jpg", "color_name": "NA-NC-16"},
            {
                "id": "vmd-design-nr-010", "product_type": "flat-embossed-vmd", "category": "Nature Reimagined", "design_code": "NA-NC-19", "design_name": "NA-NC-19", "texture_color": "#FFFFFF",
                "panel_variant": "continuous",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-NC-19_PanelA.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-NC-19_PanelA.jpg",
                "texture_urls": [
                    "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-NC-19_PanelA.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-NC-19_PanelB.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-NC-19_PanelC.jpg",
                ],
                "color_name": "NA-NC-19",
            },
            {
                "id": "vmd-design-nr-011", "product_type": "flat-embossed-vmd", "category": "Nature Reimagined", "design_code": "NA-NE-01", "design_name": "NA-NE-01", "texture_color": "#FFFFFF",
                "panel_variant": "continuous",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-NE-01_PanelA.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-NE-01_PanelA.jpg",
                "texture_urls": [
                    "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-NE-01_PanelA.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-NE-01_PanelB.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-NE-01_PanelA.jpg",
                ],
                "color_name": "NA-NE-01",
            },
            {
                "id": "vmd-design-nr-012", "product_type": "flat-embossed-vmd", "category": "Nature Reimagined", "design_code": "NA-NE-02", "design_name": "NA-NE-02", "texture_color": "#FFFFFF",
                "panel_variant": "continuous",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-NE-02_PanelA.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-NE-02_PanelA.jpg",
                "texture_urls": [
                    "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-NE-02_PanelA.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-NE-02_PanelB.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-NE-02_PanelA.jpg",
                ],
                "color_name": "NA-NE-02",
            },
            {
                "id": "vmd-design-nr-013", "product_type": "flat-embossed-vmd", "category": "Nature Reimagined", "design_code": "NA-RD-01", "design_name": "NA-RD-01", "texture_color": "#FFFFFF",
                "panel_variant": "continuous",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-RD-01-PanelA.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-RD-01-PanelA.jpg",
                "texture_urls": [
                    "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-RD-01-PanelA.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-RD-01-PanelB.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-RD-01-PanelC.jpg",
                ],
                "color_name": "NA-RD-01",
            },
            {
                "id": "vmd-design-nr-014", "product_type": "flat-embossed-vmd", "category": "Nature Reimagined", "design_code": "NA-RD-02", "design_name": "NA-RD-02", "texture_color": "#FFFFFF",
                "panel_variant": "continuous",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-RD-02-PanelA.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-RD-02-PanelA.jpg",
                "texture_urls": [
                    "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-RD-02-PanelA.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-RD-02-PanelB.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-RD-02-PanelC.jpg",
                ],
                "color_name": "NA-RD-02",
            },
            {
                "id": "vmd-design-nr-015", "product_type": "flat-embossed-vmd", "category": "Nature Reimagined", "design_code": "NA-YL-01", "design_name": "NA-YL-01", "texture_color": "#FFFFFF",
                "panel_variant": "continuous",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-YL-01-PanelA.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-YL-01-PanelA.jpg",
                "texture_urls": [
                    "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-YL-01-PanelA.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-YL-01-PanelB.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-YL-01-PanelC.jpg",
                ],
                "color_name": "NA-YL-01",
            },
            {
                "id": "vmd-design-nr-016", "product_type": "flat-embossed-vmd", "category": "Nature Reimagined", "design_code": "NA-YL-02", "design_name": "NA-YL-02", "texture_color": "#FFFFFF",
                "panel_variant": "continuous",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-YL-02-PanelA.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-YL-02-PanelA.jpg",
                "texture_urls": [
                    "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-YL-02-PanelA.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-YL-02-PanelB.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/NA-YL-02-PanelC.jpg",
                ],
                "color_name": "NA-YL-02",
            },
            # {"id": "vmd-design-nr-017", "product_type": "flat-embossed-vmd", "category": "Nature Reimagined", "design_code": "WP-BL-04", "design_name": "WP-BL-04", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/WP-BL-04.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-nature-reimagined/WP-BL-04.jpg", "color_name": "WP-BL-04"},
            {"id": "vmd-design-nr-018", "product_type": "flat-embossed-vmd", "category": "Nature Reimagined", "design_code": "WP-BR-02", "design_name": "WP-BR-02", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/WP-BR-02.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-nature-reimagined/WP-BR-02.jpg", "color_name": "WP-BR-02"},
            {
                "id": "vmd-design-nr-019", "product_type": "flat-embossed-vmd", "category": "Nature Reimagined", "design_code": "WP-GR-04", "design_name": "WP-GR-04", "texture_color": "#FFFFFF",
                "panel_variant": "continuous",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/WP-GR-04-PanelA.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-nature-reimagined/WP-GR-04-PanelA.jpg",
                "texture_urls": [
                    "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/WP-GR-04-PanelA.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/WP-GR-04-PanelB.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/WP-GR-04-PanelC.jpg",
                ],
                "color_name": "WP-GR-04",
            },
            {
                "id": "vmd-design-nr-020", "product_type": "flat-embossed-vmd", "category": "Nature Reimagined", "design_code": "WP-NC-04", "design_name": "WP-NC-04", "texture_color": "#FFFFFF",
                "panel_variant": "continuous",
                "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/WP-NC-04-PanelA.jpg",
                "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-nature-reimagined/WP-NC-04-PanelA.jpg",
                "texture_urls": [
                    "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/WP-NC-04-PanelA.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/WP-NC-04-PanelB.jpg",
                    "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/WP-NC-04-PanelC.jpg",
                ],
                "color_name": "WP-NC-04",
            },
            # {"id": "vmd-design-nr-021", "product_type": "flat-embossed-vmd", "category": "Nature Reimagined", "design_code": "WP-OR-02", "design_name": "WP-OR-02", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-nature-reimagined/WP-OR-02.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-nature-reimagined/WP-OR-02.jpg", "color_name": "WP-OR-02"},
        ],
        "Patterned Weaves": [
            {"id": "vmd-design-pw-001", "product_type": "flat-embossed-vmd", "category": "Patterned Weaves", "design_code": "FB-PT-43", "design_name": "FB-PT-43", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-patterned-weaves/FB-PT-43.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-patterned-weaves/FB-PT-43.jpg", "color_name": "FB-PT-43"},
            {"id": "vmd-design-pw-002", "product_type": "flat-embossed-vmd", "category": "Patterned Weaves", "design_code": "FB-PT-45", "design_name": "FB-PT-45", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-patterned-weaves/FB-PT-45.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-patterned-weaves/FB-PT-45.jpg", "color_name": "FB-PT-45"},
            {"id": "vmd-design-pw-003", "product_type": "flat-embossed-vmd", "category": "Patterned Weaves", "design_code": "FB-PT-47", "design_name": "FB-PT-47", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-patterned-weaves/FB-PT-47.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-patterned-weaves/FB-PT-47.jpg", "color_name": "FB-PT-47"},
            {"id": "vmd-design-pw-004", "product_type": "flat-embossed-vmd", "category": "Patterned Weaves", "design_code": "FB-PT-50", "design_name": "FB-PT-50", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-patterned-weaves/FB-PT-50.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-patterned-weaves/FB-PT-50.jpg", "color_name": "FB-PT-50"},
            {"id": "vmd-design-pw-005", "product_type": "flat-embossed-vmd", "category": "Patterned Weaves", "design_code": "FB-PT-51", "design_name": "FB-PT-51", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-patterned-weaves/FB-PT-51.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-patterned-weaves/FB-PT-51.jpg", "color_name": "FB-PT-51"},
            {"id": "vmd-design-pw-006", "product_type": "flat-embossed-vmd", "category": "Patterned Weaves", "design_code": "FB-PT-52", "design_name": "FB-PT-52", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-patterned-weaves/FB-PT-52.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-patterned-weaves/FB-PT-52.jpg", "color_name": "FB-PT-52"},
            {"id": "vmd-design-pw-007", "product_type": "flat-embossed-vmd", "category": "Patterned Weaves", "design_code": "FB-PT-54", "design_name": "FB-PT-54", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-patterned-weaves/FB-PT-54.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-patterned-weaves/FB-PT-54.jpg", "color_name": "FB-PT-54"},
            {"id": "vmd-design-pw-008", "product_type": "flat-embossed-vmd", "category": "Patterned Weaves", "design_code": "FB-PT-55", "design_name": "FB-PT-55", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-patterned-weaves/FB-PT-55.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-patterned-weaves/FB-PT-55.jpg", "color_name": "FB-PT-55"},
            {"id": "vmd-design-pw-009", "product_type": "flat-embossed-vmd", "category": "Patterned Weaves", "design_code": "FB-PT-56", "design_name": "FB-PT-56", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-patterned-weaves/FB-PT-56.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-patterned-weaves/FB-PT-56.jpg", "color_name": "FB-PT-56"},
            {"id": "vmd-design-pw-010", "product_type": "flat-embossed-vmd", "category": "Patterned Weaves", "design_code": "FB-PT-59", "design_name": "FB-PT-59", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-patterned-weaves/FB-PT-59.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-patterned-weaves/FB-PT-59.jpg", "color_name": "FB-PT-59"},
            {"id": "vmd-design-pw-011", "product_type": "flat-embossed-vmd", "category": "Patterned Weaves", "design_code": "FB-PT-60", "design_name": "FB-PT-60", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-patterned-weaves/FB-PT-60.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-patterned-weaves/FB-PT-60.jpg", "color_name": "FB-PT-60"},
            {"id": "vmd-design-pw-012", "product_type": "flat-embossed-vmd", "category": "Patterned Weaves", "design_code": "FB-PT-62", "design_name": "FB-PT-62", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-patterned-weaves/FB-PT-62.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-patterned-weaves/FB-PT-62.jpg", "color_name": "FB-PT-62"},
            {"id": "vmd-design-pw-013", "product_type": "flat-embossed-vmd", "category": "Patterned Weaves", "design_code": "FB-PT-80", "design_name": "FB-PT-80", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-patterned-weaves/FB-PT-80.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-patterned-weaves/FB-PT-80.jpg", "color_name": "FB-PT-80"},
            {"id": "vmd-design-pw-014", "product_type": "flat-embossed-vmd", "category": "Patterned Weaves", "design_code": "WP-GR-02", "design_name": "WP-GR-02", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-patterned-weaves/WP-GR-02.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-patterned-weaves/WP-GR-02.jpg", "color_name": "WP-GR-02"},
        ],
        "Wood Classics": [
            {"id": "vmd-design-wc-001", "product_type": "wood", "category": "Wood Classics", "design_code": "WD-NC-01", "design_name": "WD-NC-01", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-01.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-01.jpg", "color_name": "WD-NC-01", "available_emboss": []},
            {"id": "vmd-design-wc-002", "product_type": "wood", "category": "Wood Classics", "design_code": "WD-NC-02", "design_name": "WD-NC-02", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-02.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-02.jpg", "color_name": "WD-NC-02", "available_emboss": []},
            {"id": "vmd-design-wc-003", "product_type": "wood", "category": "Wood Classics", "design_code": "WD-NC-03", "design_name": "WD-NC-03", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-03.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-03.jpg", "color_name": "WD-NC-03", "available_emboss": []},
            {"id": "vmd-design-wc-004", "product_type": "wood", "category": "Wood Classics", "design_code": "WD-NC-04", "design_name": "WD-NC-04", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-04.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-04.jpg", "color_name": "WD-NC-04", "available_emboss": []},
            {"id": "vmd-design-wc-005", "product_type": "wood", "category": "Wood Classics", "design_code": "WD-NC-05", "design_name": "WD-NC-05", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-05.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-05.jpg", "color_name": "WD-NC-05", "available_emboss": ["flux_ribbed","ribbed_25mm", "ribbed_45mm", "ribbed_60mm"]},
            {"id": "vmd-design-wc-006", "product_type": "wood", "category": "Wood Classics", "design_code": "WD-NC-06", "design_name": "WD-NC-06", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-06.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-06.jpg", "color_name": "WD-NC-06", "available_emboss": []},
            {"id": "vmd-design-wc-007", "product_type": "wood", "category": "Wood Classics", "design_code": "WD-NC-07", "design_name": "WD-NC-07", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-07.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-07.jpg", "color_name": "WD-NC-07", "available_emboss": []},
            {"id": "vmd-design-wc-008", "product_type": "wood", "category": "Wood Classics", "design_code": "WD-NC-08", "design_name": "WD-NC-08", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-08.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-08.jpg", "color_name": "WD-NC-08", "available_emboss": []},
            {"id": "vmd-design-wc-009", "product_type": "wood", "category": "Wood Classics", "design_code": "WD-NC-09", "design_name": "WD-NC-09", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-09.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-09.jpg", "color_name": "WD-NC-09", "available_emboss": ["flux_ribbed","ribbed_25mm", "ribbed_45mm", "ribbed_60mm"]},
            {"id": "vmd-design-wc-010", "product_type": "wood", "category": "Wood Classics", "design_code": "WD-NC-10", "design_name": "WD-NC-10", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-10.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-10.jpg", "color_name": "WD-NC-10", "available_emboss": []},
            {"id": "vmd-design-wc-011", "product_type": "wood", "category": "Wood Classics", "design_code": "WD-NC-11", "design_name": "WD-NC-11", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-11.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-11.jpg", "color_name": "WD-NC-11", "available_emboss": []},
            {"id": "vmd-design-wc-012", "product_type": "wood", "category": "Wood Classics", "design_code": "WD-NC-12", "design_name": "WD-NC-12", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-12.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-12.jpg", "color_name": "WD-NC-12", "available_emboss": []},
            {"id": "vmd-design-wc-013", "product_type": "wood", "category": "Wood Classics", "design_code": "WD-NC-13", "design_name": "WD-NC-13", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-13.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-13.jpg", "color_name": "WD-NC-13", "available_emboss": ["flux_ribbed","ribbed_25mm", "ribbed_45mm", "ribbed_60mm"]},
            {"id": "vmd-design-wc-014", "product_type": "wood", "category": "Wood Classics", "design_code": "WD-NC-14", "design_name": "WD-NC-14", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-14.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-14.jpg", "color_name": "WD-NC-14", "available_emboss": []},
            {"id": "vmd-design-wc-015", "product_type": "wood", "category": "Wood Classics", "design_code": "WD-NC-15", "design_name": "WD-NC-15", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-15.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-15.jpg", "color_name": "WD-NC-15", "available_emboss": []},
            {"id": "vmd-design-wc-016", "product_type": "wood", "category": "Wood Classics", "design_code": "WD-NC-16", "design_name": "WD-NC-16", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-16.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-16.jpg", "color_name": "WD-NC-16", "available_emboss": []},
            {"id": "vmd-design-wc-017", "product_type": "wood", "category": "Wood Classics", "design_code": "WD-NC-17", "design_name": "WD-NC-17", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-17.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-17.jpg", "color_name": "WD-NC-17", "available_emboss": []},
            {"id": "vmd-design-wc-018", "product_type": "wood", "category": "Wood Classics", "design_code": "WD-NC-18", "design_name": "WD-NC-18", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-18.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-18.jpg", "color_name": "WD-NC-18", "available_emboss": []},
            {"id": "vmd-design-wc-019", "product_type": "wood", "category": "Wood Classics", "design_code": "WD-NC-19", "design_name": "WD-NC-19", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-19.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-19.jpg", "color_name": "WD-NC-19", "available_emboss": []},
            {"id": "vmd-design-wc-020", "product_type": "wood", "category": "Wood Classics", "design_code": "WD-NC-20", "design_name": "WD-NC-20", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-20.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-20.jpg", "color_name": "WD-NC-20", "available_emboss": []},
            {"id": "vmd-design-wc-021", "product_type": "wood", "category": "Wood Classics", "design_code": "WD-NC-21", "design_name": "WD-NC-21", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-21.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-21.jpg", "color_name": "WD-NC-21", "available_emboss": ["flux_ribbed","ribbed_25mm", "ribbed_45mm", "ribbed_60mm"]},
            {"id": "vmd-design-wc-022", "product_type": "wood", "category": "Wood Classics", "design_code": "WD-NC-22", "design_name": "WD-NC-22", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-22.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-22.jpg", "color_name": "WD-NC-22", "available_emboss": []},
            {"id": "vmd-design-wc-023", "product_type": "wood", "category": "Wood Classics", "design_code": "WD-NC-23", "design_name": "WD-NC-23", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-23.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-23.jpg", "color_name": "WD-NC-23", "available_emboss": ["flux_ribbed","ribbed_25mm", "ribbed_45mm", "ribbed_60mm"]},
            {"id": "vmd-design-wc-024", "product_type": "wood", "category": "Wood Classics", "design_code": "WD-NC-24", "design_name": "WD-NC-24", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-24.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-24.jpg", "color_name": "WD-NC-24", "available_emboss": ["flux_ribbed","ribbed_25mm", "ribbed_45mm", "ribbed_60mm"]},
            {"id": "vmd-design-wc-025", "product_type": "wood", "category": "Wood Classics", "design_code": "WD-NC-25", "design_name": "WD-NC-25", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-25.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-25.jpg", "color_name": "WD-NC-25", "available_emboss": []},
            {"id": "vmd-design-wc-026", "product_type": "wood", "category": "Wood Classics", "design_code": "WD-NC-26", "design_name": "WD-NC-26", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-26.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-26.jpg", "color_name": "WD-NC-26", "available_emboss": []},
            {"id": "vmd-design-wc-027", "product_type": "wood", "category": "Wood Classics", "design_code": "WD-NC-27", "design_name": "WD-NC-27", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-27.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-27.jpg", "color_name": "WD-NC-27", "available_emboss": []},
            {"id": "vmd-design-wc-028", "product_type": "wood", "category": "Wood Classics", "design_code": "WD-NC-28", "design_name": "WD-NC-28", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-28.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-28.jpg", "color_name": "WD-NC-28", "available_emboss": []},
            {"id": "vmd-design-wc-029", "product_type": "wood", "category": "Wood Classics", "design_code": "WD-NC-29", "design_name": "WD-NC-29", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-29.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-29.jpg", "color_name": "WD-NC-29", "available_emboss": []},
            {"id": "vmd-design-wc-030", "product_type": "wood", "category": "Wood Classics", "design_code": "WD-NC-30", "design_name": "WD-NC-30", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-30.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-30.jpg", "color_name": "WD-NC-30", "available_emboss": []},
            {"id": "vmd-design-wc-031", "product_type": "wood", "category": "Wood Classics", "design_code": "WD-NC-31", "design_name": "WD-NC-31", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-31.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-31.jpg", "color_name": "WD-NC-31", "available_emboss": []},
            {"id": "vmd-design-wc-032", "product_type": "wood", "category": "Wood Classics", "design_code": "WD-NC-32", "design_name": "WD-NC-32", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-32.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-32.jpg", "color_name": "WD-NC-32", "available_emboss": []},
            {"id": "vmd-design-wc-033", "product_type": "wood", "category": "Wood Classics", "design_code": "WD-NC-33", "design_name": "WD-NC-33", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-33.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-33.jpg", "color_name": "WD-NC-33", "available_emboss": ["flux_ribbed","ribbed_25mm", "ribbed_45mm", "ribbed_60mm"]},
            {"id": "vmd-design-wc-034", "product_type": "wood", "category": "Wood Classics", "design_code": "WD-NC-34", "design_name": "WD-NC-34", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-34.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-34.jpg", "color_name": "WD-NC-34", "available_emboss": ["flux_ribbed","ribbed_25mm", "ribbed_45mm", "ribbed_60mm"]},
            {"id": "vmd-design-wc-035", "product_type": "wood", "category": "Wood Classics", "design_code": "WD-NC-35", "design_name": "WD-NC-35", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-35.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-35.jpg", "color_name": "WD-NC-35", "available_emboss": []},
            {"id": "vmd-design-wc-036", "product_type": "wood", "category": "Wood Classics", "design_code": "WD-NC-36", "design_name": "WD-NC-36", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-36.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-36.jpg", "color_name": "WD-NC-36", "available_emboss": []},
            {"id": "vmd-design-wc-037", "product_type": "wood", "category": "Wood Classics", "design_code": "WD-NC-37", "design_name": "WD-NC-37", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-37.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-wood-classics/WD-NC-37.jpg", "color_name": "WD-NC-37", "available_emboss": []},
        ],
        "Modern Corporate": [
            {"id": "vmd-design-mc-001", "product_type": "flat-embossed-vmd", "category": "Modern Corporate", "design_code": "FB-PT-44", "design_name": "FB-PT-44", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-modern-corporate/FB-PT-44.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-modern-corporate/FB-PT-44.jpg", "color_name": "FB-PT-44"},
            {"id": "vmd-design-mc-002", "product_type": "flat-embossed-vmd", "category": "Modern Corporate", "design_code": "FB-PT-46", "design_name": "FB-PT-46", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-modern-corporate/FB-PT-46.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-modern-corporate/FB-PT-46.jpg", "color_name": "FB-PT-46"},
            {"id": "vmd-design-mc-003", "product_type": "flat-embossed-vmd", "category": "Modern Corporate", "design_code": "FB-PT-48", "design_name": "FB-PT-48", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-modern-corporate/FB-PT-48.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-modern-corporate/FB-PT-48.jpg", "color_name": "FB-PT-48"},
            {"id": "vmd-design-mc-004", "product_type": "flat-embossed-vmd", "category": "Modern Corporate", "design_code": "FB-PT-49", "design_name": "FB-PT-49", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-modern-corporate/FB-PT-49.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-modern-corporate/FB-PT-49.jpg", "color_name": "FB-PT-49"},
            {"id": "vmd-design-mc-005", "product_type": "flat-embossed-vmd", "category": "Modern Corporate", "design_code": "FB-PT-53", "design_name": "FB-PT-53", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-modern-corporate/FB-PT-53.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-modern-corporate/FB-PT-53.jpg", "color_name": "FB-PT-53"},
            {"id": "vmd-design-mc-006", "product_type": "flat-embossed-vmd", "category": "Modern Corporate", "design_code": "FB-PT-57", "design_name": "FB-PT-57", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-modern-corporate/FB-PT-57.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-modern-corporate/FB-PT-57.jpg", "color_name": "FB-PT-57"},
            {"id": "vmd-design-mc-007", "product_type": "flat-embossed-vmd", "category": "Modern Corporate", "design_code": "FB-PT-58", "design_name": "FB-PT-58", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-modern-corporate/FB-PT-58.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-modern-corporate/FB-PT-58.jpg", "color_name": "FB-PT-58"},
            {"id": "vmd-design-mc-008", "product_type": "flat-embossed-vmd", "category": "Modern Corporate", "design_code": "FB-PT-61", "design_name": "FB-PT-61", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-modern-corporate/FB-PT-61.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-modern-corporate/FB-PT-61.jpg", "color_name": "FB-PT-61"},
            {"id": "vmd-design-mc-009", "product_type": "flat-embossed-vmd", "category": "Modern Corporate", "design_code": "FB-PT-63", "design_name": "FB-PT-63", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-modern-corporate/FB-PT-63.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-modern-corporate/FB-PT-63.jpg", "color_name": "FB-PT-63"},
            {"id": "vmd-design-mc-010", "product_type": "flat-embossed-vmd", "category": "Modern Corporate", "design_code": "FB-PT-64", "design_name": "FB-PT-64", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-modern-corporate/FB-PT-64.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-modern-corporate/FB-PT-64.jpg", "color_name": "FB-PT-64"},
            {"id": "vmd-design-mc-011", "product_type": "flat-embossed-vmd", "category": "Modern Corporate", "design_code": "FB-PT-65", "design_name": "FB-PT-65", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-modern-corporate/FB-PT-65.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-modern-corporate/FB-PT-65.jpg", "color_name": "FB-PT-65"},
            {"id": "vmd-design-mc-012", "product_type": "flat-embossed-vmd", "category": "Modern Corporate", "design_code": "FB-PT-87", "design_name": "FB-PT-87", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-modern-corporate/FB-PT-87.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-modern-corporate/FB-PT-87.jpg", "color_name": "FB-PT-87"},
        ],
        "Soft Texture": [
            {"id": "vmd-design-st-001", "product_type": "flat-embossed-vmd", "category": "Soft Texture", "design_code": "TP-BL-01", "design_name": "TP-BL-01", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-soft-texture/TP-BL-01.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-soft-texture/TP-BL-01.jpg", "color_name": "TP-BL-01"},
            {"id": "vmd-design-st-002", "product_type": "flat-embossed-vmd", "category": "Soft Texture", "design_code": "TP-BL-02", "design_name": "TP-BL-02", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-soft-texture/TP-BL-02.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-soft-texture/TP-BL-02.jpg", "color_name": "TP-BL-02"},
            {"id": "vmd-design-st-003", "product_type": "flat-embossed-vmd", "category": "Soft Texture", "design_code": "TP-BL-03", "design_name": "TP-BL-03", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-soft-texture/TP-BL-03.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-soft-texture/TP-BL-03.jpg", "color_name": "TP-BL-03"},
            {"id": "vmd-design-st-004", "product_type": "flat-embossed-vmd", "category": "Soft Texture", "design_code": "TP-GR-01", "design_name": "TP-GR-01", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-soft-texture/TP-GR-01.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-soft-texture/TP-GR-01.jpg", "color_name": "TP-GR-01"},
            {"id": "vmd-design-st-005", "product_type": "flat-embossed-vmd", "category": "Soft Texture", "design_code": "TP-GR-02", "design_name": "TP-GR-02", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-soft-texture/TP-GR-02.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-soft-texture/TP-GR-02.jpg", "color_name": "TP-GR-02"},
            {"id": "vmd-design-st-006", "product_type": "flat-embossed-vmd", "category": "Soft Texture", "design_code": "TP-GR-03", "design_name": "TP-GR-03", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-soft-texture/TP-GR-03.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-soft-texture/TP-GR-03.jpg", "color_name": "TP-GR-03"},
            {"id": "vmd-design-st-007", "product_type": "flat-embossed-vmd", "category": "Soft Texture", "design_code": "TP-GY-01", "design_name": "TP-GY-01", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-soft-texture/TP-GY-01.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-soft-texture/TP-GY-01.jpg", "color_name": "TP-GY-01"},
            {"id": "vmd-design-st-008", "product_type": "flat-embossed-vmd", "category": "Soft Texture", "design_code": "TP-GY-02", "design_name": "TP-GY-02", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-soft-texture/TP-GY-02.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-soft-texture/TP-GY-02.jpg", "color_name": "TP-GY-02"},
            {"id": "vmd-design-st-009", "product_type": "flat-embossed-vmd", "category": "Soft Texture", "design_code": "TP-GY-03", "design_name": "TP-GY-03", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-soft-texture/TP-GY-03.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-soft-texture/TP-GY-03.jpg", "color_name": "TP-GY-03"},
            {"id": "vmd-design-st-010", "product_type": "flat-embossed-vmd", "category": "Soft Texture", "design_code": "TP-NE-01", "design_name": "TP-NE-01", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-soft-texture/TP-NE-01.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-soft-texture/TP-NE-01.jpg", "color_name": "TP-NE-01"},
            {"id": "vmd-design-st-011", "product_type": "flat-embossed-vmd", "category": "Soft Texture", "design_code": "TP-NE-02", "design_name": "TP-NE-02", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-soft-texture/TP-NE-02.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-soft-texture/TP-NE-02.jpg", "color_name": "TP-NE-02"},
            {"id": "vmd-design-st-012", "product_type": "flat-embossed-vmd", "category": "Soft Texture", "design_code": "TP-NE-03", "design_name": "TP-NE-03", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-soft-texture/TP-NE-03.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-soft-texture/TP-NE-03.jpg", "color_name": "TP-NE-03"},
            {"id": "vmd-design-st-013", "product_type": "flat-embossed-vmd", "category": "Soft Texture", "design_code": "TP-NE-04", "design_name": "TP-NE-04", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-soft-texture/TP-NE-04.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-soft-texture/TP-NE-04.jpg", "color_name": "TP-NE-04"},
            {"id": "vmd-design-st-014", "product_type": "flat-embossed-vmd", "category": "Soft Texture", "design_code": "TP-NE-05", "design_name": "TP-NE-05", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-soft-texture/TP-NE-05.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-soft-texture/TP-NE-05.jpg", "color_name": "TP-NE-05"},
            {"id": "vmd-design-st-015", "product_type": "flat-embossed-vmd", "category": "Soft Texture", "design_code": "TP-NE-06", "design_name": "TP-NE-06", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-soft-texture/TP-NE-06.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-soft-texture/TP-NE-06.jpg", "color_name": "TP-NE-06"},
            {"id": "vmd-design-st-016", "product_type": "flat-embossed-vmd", "category": "Soft Texture", "design_code": "TP-NE-07", "design_name": "TP-NE-07", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-soft-texture/TP-NE-07.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-soft-texture/TP-NE-07.jpg", "color_name": "TP-NE-07"},
            {"id": "vmd-design-st-017", "product_type": "flat-embossed-vmd", "category": "Soft Texture", "design_code": "TP-NE-08", "design_name": "TP-NE-08", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-soft-texture/TP-NE-08.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-soft-texture/TP-NE-08.jpg", "color_name": "TP-NE-08"},
            {"id": "vmd-design-st-018", "product_type": "flat-embossed-vmd", "category": "Soft Texture", "design_code": "TP-NE-09", "design_name": "TP-NE-09", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-soft-texture/TP-NE-09.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-soft-texture/TP-NE-09.jpg", "color_name": "TP-NE-09"},
            {"id": "vmd-design-st-019", "product_type": "flat-embossed-vmd", "category": "Soft Texture", "design_code": "TP-NE-10", "design_name": "TP-NE-10", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-soft-texture/TP-NE-10.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-soft-texture/TP-NE-10.jpg", "color_name": "TP-NE-10"},
            {"id": "vmd-design-st-020", "product_type": "flat-embossed-vmd", "category": "Soft Texture", "design_code": "TP-NE-11", "design_name": "TP-NE-11", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-soft-texture/TP-NE-11.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-soft-texture/TP-NE-11.jpg", "color_name": "TP-NE-11"},
            {"id": "vmd-design-st-021", "product_type": "flat-embossed-vmd", "category": "Soft Texture", "design_code": "TP-NE-12", "design_name": "TP-NE-12", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-soft-texture/TP-NE-12.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-soft-texture/TP-NE-12.jpg", "color_name": "TP-NE-12"},
            {"id": "vmd-design-st-022", "product_type": "flat-embossed-vmd", "category": "Soft Texture", "design_code": "TP-NE-13", "design_name": "TP-NE-13", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-soft-texture/TP-NE-13.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-soft-texture/TP-NE-13.jpg", "color_name": "TP-NE-13"},
            {"id": "vmd-design-st-023", "product_type": "flat-embossed-vmd", "category": "Soft Texture", "design_code": "TP-NE-14", "design_name": "TP-NE-14", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-soft-texture/TP-NE-14.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-soft-texture/TP-NE-14.jpg", "color_name": "TP-NE-14"},
            {"id": "vmd-design-st-024", "product_type": "flat-embossed-vmd", "category": "Soft Texture", "design_code": "TP-PK-01", "design_name": "TP-PK-01", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-soft-texture/TP-PK-01.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-soft-texture/TP-PK-01.jpg", "color_name": "TP-PK-01"},
            {"id": "vmd-design-st-025", "product_type": "flat-embossed-vmd", "category": "Soft Texture", "design_code": "TP-PK-02", "design_name": "TP-PK-02", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-soft-texture/TP-PK-02.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-soft-texture/TP-PK-02.jpg", "color_name": "TP-PK-02"},
            {"id": "vmd-design-st-026", "product_type": "flat-embossed-vmd", "category": "Soft Texture", "design_code": "TP-PK-03", "design_name": "TP-PK-03", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-soft-texture/TP-PK-03.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-soft-texture/TP-PK-03.jpg", "color_name": "TP-PK-03"},
            {"id": "vmd-design-st-027", "product_type": "flat-embossed-vmd", "category": "Soft Texture", "design_code": "TP-PK-04", "design_name": "TP-PK-04", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-soft-texture/TP-PK-04.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-soft-texture/TP-PK-04.jpg", "color_name": "TP-PK-04"},
            {"id": "vmd-design-st-028", "product_type": "flat-embossed-vmd", "category": "Soft Texture", "design_code": "TP-PK-05", "design_name": "TP-PK-05", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-soft-texture/TP-PK-05.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-soft-texture/TP-PK-05.jpg", "color_name": "TP-PK-05"},
            {"id": "vmd-design-st-029", "product_type": "flat-embossed-vmd", "category": "Soft Texture", "design_code": "TP-PU-01", "design_name": "TP-PU-01", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-soft-texture/TP-PU-01.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-soft-texture/TP-PU-01.jpg", "color_name": "TP-PU-01"},
            {"id": "vmd-design-st-030", "product_type": "flat-embossed-vmd", "category": "Soft Texture", "design_code": "TP-PU-02", "design_name": "TP-PU-02", "texture_color": "#FFFFFF", "texture_url": "/static/images/flat-embossed-vmt/panels/vmd-soft-texture/TP-PU-02.jpg", "thumbnail_url": "/thumb/flat-embossed-vmt/panels/vmd-soft-texture/TP-PU-02.jpg", "color_name": "TP-PU-02"},
        ],
        "Wood Perforations": [
            {"id": "wood-pf-001", "product_type": "wood", "category": "Wood Perforations", "design_code": "WD-NC-05", "design_name": "WD-NC-05", "texture_color": "#886840", "texture_url": "/static/images/wood/panels/wood-perfocations/WD-NC-05.jpg", "thumbnail_url": "/thumb/wood/panels/wood-perfocations/WD-NC-05.jpg", "color_name": "WD-NC-05"},
            {"id": "wood-pf-002", "product_type": "wood", "category": "Wood Perforations", "design_code": "WD-NC-21", "design_name": "WD-NC-21", "texture_color": "#C8A060", "texture_url": "/static/images/wood/panels/wood-perfocations/WD-NC-21.jpg", "thumbnail_url": "/thumb/wood/panels/wood-perfocations/WD-NC-21.jpg", "color_name": "WD-NC-21"},
            {"id": "wood-pf-003", "product_type": "wood", "category": "Wood Perforations", "design_code": "WD-NC-24", "design_name": "WD-NC-24", "texture_color": "#C0A878", "texture_url": "/static/images/wood/panels/wood-perfocations/WD-NC-24.jpg", "thumbnail_url": "/thumb/wood/panels/wood-perfocations/WD-NC-24.jpg", "color_name": "WD-NC-24"},
            {"id": "wood-pf-004", "product_type": "wood", "category": "Wood Perforations", "design_code": "WD-NC-33", "design_name": "WD-NC-33", "texture_color": "#B8A080", "texture_url": "/static/images/wood/panels/wood-perfocations/WD-NC-33.jpg", "thumbnail_url": "/thumb/wood/panels/wood-perfocations/WD-NC-33.jpg", "color_name": "WD-NC-33"},
            {"id": "wood-pf-005", "product_type": "wood", "category": "Wood Perforations", "design_code": "WD-NC-34", "design_name": "WD-NC-34", "texture_color": "#A89070", "texture_url": "/static/images/wood/panels/wood-perfocations/WD-NC-34.jpg", "thumbnail_url": "/thumb/wood/panels/wood-perfocations/WD-NC-34.jpg", "color_name": "WD-NC-34"},
        ],
        "Classic Parquet": [
            {"id": "wood-cp-002", "product_type": "wood", "category": "Classic Parquet", "design_code": "PR-NC-01", "design_name": "PR-NC-01", "texture_color": "#FFFFFF", "texture_url": "/static/images/wood/panels/classic_parquet/PR-NC-01.jpg", "thumbnail_url": "/thumb/wood/panels/classic_parquet/PR-NC-01.jpg", "color_name": "PR-NC-01"},
            {"id": "wood-cp-003", "product_type": "wood", "category": "Classic Parquet", "design_code": "PR-NC-02", "design_name": "PR-NC-02", "texture_color": "#FFFFFF", "texture_url": "/static/images/wood/panels/classic_parquet/PR-NC-02.jpg", "thumbnail_url": "/thumb/wood/panels/classic_parquet/PR-NC-02.jpg", "color_name": "PR-NC-02"},
            {"id": "wood-cp-004", "product_type": "wood", "category": "Classic Parquet", "design_code": "PR-NC-05", "design_name": "PR-NC-05", "texture_color": "#FFFFFF", "texture_url": "/static/images/wood/panels/classic_parquet/PR-NC-05.jpg", "thumbnail_url": "/thumb/wood/panels/classic_parquet/PR-NC-05.jpg", "color_name": "PR-NC-05"},
            {"id": "wood-cp-005", "product_type": "wood", "category": "Classic Parquet", "design_code": "PR-NC-06", "design_name": "PR-NC-06", "texture_color": "#FFFFFF", "texture_url": "/static/images/wood/panels/classic_parquet/PR-NC-06.jpg", "thumbnail_url": "/thumb/wood/panels/classic_parquet/PR-NC-06.jpg", "color_name": "PR-NC-06"},
            {"id": "wood-cp-006", "product_type": "wood", "category": "Classic Parquet", "design_code": "PR-NC-07", "design_name": "PR-NC-07", "texture_color": "#FFFFFF", "texture_url": "/static/images/wood/panels/classic_parquet/PR-NC-07.jpg", "thumbnail_url": "/thumb/wood/panels/classic_parquet/PR-NC-07.jpg", "color_name": "PR-NC-07"},
            {"id": "wood-cp-007", "product_type": "wood", "category": "Classic Parquet", "design_code": "PR-NC-08", "design_name": "PR-NC-08", "texture_color": "#FFFFFF", "texture_url": "/static/images/wood/panels/classic_parquet/PR-NC-08.jpg", "thumbnail_url": "/thumb/wood/panels/classic_parquet/PR-NC-08.jpg", "color_name": "PR-NC-08"},
            {"id": "wood-cp-008", "product_type": "wood", "category": "Classic Parquet", "design_code": "PR-NC-09", "design_name": "PR-NC-09", "texture_color": "#FFFFFF", "texture_url": "/static/images/wood/panels/classic_parquet/PR-NC-09.jpg", "thumbnail_url": "/thumb/wood/panels/classic_parquet/PR-NC-09.jpg", "color_name": "PR-NC-09"},
            {"id": "wood-cp-009", "product_type": "wood", "category": "Classic Parquet", "design_code": "PR-NC-10", "design_name": "PR-NC-10", "texture_color": "#FFFFFF", "texture_url": "/static/images/wood/panels/classic_parquet/PR-NC-10.jpg", "thumbnail_url": "/thumb/wood/panels/classic_parquet/PR-NC-10.jpg", "color_name": "PR-NC-10"},
            {"id": "wood-cp-010", "product_type": "wood", "category": "Classic Parquet", "design_code": "PR-NC-11", "design_name": "PR-NC-11", "texture_color": "#FFFFFF", "texture_url": "/static/images/wood/panels/classic_parquet/PR-NC-11.jpg", "thumbnail_url": "/thumb/wood/panels/classic_parquet/PR-NC-11.jpg", "color_name": "PR-NC-11"},
            {"id": "wood-cp-011", "product_type": "wood", "category": "Classic Parquet", "design_code": "PR-NC-12", "design_name": "PR-NC-12", "texture_color": "#FFFFFF", "texture_url": "/static/images/wood/panels/classic_parquet/PR-NC-12.jpg", "thumbnail_url": "/thumb/wood/panels/classic_parquet/PR-NC-12.jpg", "color_name": "PR-NC-12"},
            {"id": "wood-cp-012", "product_type": "wood", "category": "Classic Parquet", "design_code": "PR-NC-13", "design_name": "PR-NC-13", "texture_color": "#FFFFFF", "texture_url": "/static/images/wood/panels/classic_parquet/PR-NC-13.jpg", "thumbnail_url": "/thumb/wood/panels/classic_parquet/PR-NC-13.jpg", "color_name": "PR-NC-13"},
            {"id": "wood-cp-013", "product_type": "wood", "category": "Classic Parquet", "design_code": "PR-NC-14", "design_name": "PR-NC-14", "texture_color": "#FFFFFF", "texture_url": "/static/images/wood/panels/classic_parquet/PR-NC-14.jpg", "thumbnail_url": "/thumb/wood/panels/classic_parquet/PR-NC-14.jpg", "color_name": "PR-NC-14"},
            {"id": "wood-cp-014", "product_type": "wood", "category": "Classic Parquet", "design_code": "PR-NC-15", "design_name": "PR-NC-15", "texture_color": "#FFFFFF", "texture_url": "/static/images/wood/panels/classic_parquet/PR-NC-15.jpg", "thumbnail_url": "/thumb/wood/panels/classic_parquet/PR-NC-15.jpg", "color_name": "PR-NC-15"},
            {"id": "wood-cp-015", "product_type": "wood", "category": "Classic Parquet", "design_code": "PR-NC-16", "design_name": "PR-NC-16", "texture_color": "#FFFFFF", "texture_url": "/static/images/wood/panels/classic_parquet/PR-NC-16.jpg", "thumbnail_url": "/thumb/wood/panels/classic_parquet/PR-NC-16.jpg", "color_name": "PR-NC-16"},
            {"id": "wood-cp-016", "product_type": "wood", "category": "Classic Parquet", "design_code": "PR-NC-17", "design_name": "PR-NC-17", "texture_color": "#FFFFFF", "texture_url": "/static/images/wood/panels/classic_parquet/PR-NC-17.jpg", "thumbnail_url": "/thumb/wood/panels/classic_parquet/PR-NC-17.jpg", "color_name": "PR-NC-17"},
            {"id": "wood-cp-017", "product_type": "wood", "category": "Classic Parquet", "design_code": "PR-NC-18", "design_name": "PR-NC-18", "texture_color": "#FFFFFF", "texture_url": "/static/images/wood/panels/classic_parquet/PR-NC-18.jpg", "thumbnail_url": "/thumb/wood/panels/classic_parquet/PR-NC-18.jpg", "color_name": "PR-NC-18"},
            {"id": "wood-cp-018", "product_type": "wood", "category": "Classic Parquet", "design_code": "PR-NC-19", "design_name": "PR-NC-19", "texture_color": "#FFFFFF", "texture_url": "/static/images/wood/panels/classic_parquet/PR-NC-19.jpg", "thumbnail_url": "/thumb/wood/panels/classic_parquet/PR-NC-19.jpg", "color_name": "PR-NC-19"},
            {"id": "wood-cp-019", "product_type": "wood", "category": "Classic Parquet", "design_code": "PR-NC-20", "design_name": "PR-NC-20", "texture_color": "#FFFFFF", "texture_url": "/static/images/wood/panels/classic_parquet/PR-NC-20.jpg", "thumbnail_url": "/thumb/wood/panels/classic_parquet/PR-NC-20.jpg", "color_name": "PR-NC-20"},
            {"id": "wood-cp-020", "product_type": "wood", "category": "Classic Parquet", "design_code": "PR-NC-21", "design_name": "PR-NC-21", "texture_color": "#FFFFFF", "texture_url": "/static/images/wood/panels/classic_parquet/PR-NC-21.jpg", "thumbnail_url": "/thumb/wood/panels/classic_parquet/PR-NC-21.jpg", "color_name": "PR-NC-21"},
            {"id": "wood-cp-021", "product_type": "wood", "category": "Classic Parquet", "design_code": "PR-NC-22", "design_name": "PR-NC-22", "texture_color": "#FFFFFF", "texture_url": "/static/images/wood/panels/classic_parquet/PR-NC-22.jpg", "thumbnail_url": "/thumb/wood/panels/classic_parquet/PR-NC-22.jpg", "color_name": "PR-NC-22"},
            {"id": "wood-cp-022", "product_type": "wood", "category": "Classic Parquet", "design_code": "PR-NC-23", "design_name": "PR-NC-23", "texture_color": "#FFFFFF", "texture_url": "/static/images/wood/panels/classic_parquet/PR-NC-23.jpg", "thumbnail_url": "/thumb/wood/panels/classic_parquet/PR-NC-23.jpg", "color_name": "PR-NC-23"},
            {"id": "wood-cp-023", "product_type": "wood", "category": "Classic Parquet", "design_code": "PR-NC-24", "design_name": "PR-NC-24", "texture_color": "#FFFFFF", "texture_url": "/static/images/wood/panels/classic_parquet/PR-NC-24.jpg", "thumbnail_url": "/thumb/wood/panels/classic_parquet/PR-NC-24.jpg", "color_name": "PR-NC-24"},
            {"id": "wood-cp-024", "product_type": "wood", "category": "Classic Parquet", "design_code": "PR-NC-25", "design_name": "PR-NC-25", "texture_color": "#FFFFFF", "texture_url": "/static/images/wood/panels/classic_parquet/PR-NC-25.jpg", "thumbnail_url": "/thumb/wood/panels/classic_parquet/PR-NC-25.jpg", "color_name": "PR-NC-25"},
            {"id": "wood-cp-025", "product_type": "wood", "category": "Classic Parquet", "design_code": "PR-NC-26", "design_name": "PR-NC-26", "texture_color": "#FFFFFF", "texture_url": "/static/images/wood/panels/classic_parquet/PR-NC-26.jpg", "thumbnail_url": "/thumb/wood/panels/classic_parquet/PR-NC-26.jpg", "color_name": "PR-NC-26"},
            {"id": "wood-cp-026", "product_type": "wood", "category": "Classic Parquet", "design_code": "PR-NC-27", "design_name": "PR-NC-27", "texture_color": "#FFFFFF", "texture_url": "/static/images/wood/panels/classic_parquet/PR-NC-27.jpg", "thumbnail_url": "/thumb/wood/panels/classic_parquet/PR-NC-27.jpg", "color_name": "PR-NC-27"},
            {"id": "wood-cp-027", "product_type": "wood", "category": "Classic Parquet", "design_code": "PR-NC-28", "design_name": "PR-NC-28", "texture_color": "#FFFFFF", "texture_url": "/static/images/wood/panels/classic_parquet/PR-NC-28.jpg", "thumbnail_url": "/thumb/wood/panels/classic_parquet/PR-NC-28.jpg", "color_name": "PR-NC-28"},
            {"id": "wood-cp-028", "product_type": "wood", "category": "Classic Parquet", "design_code": "PR-NC-29", "design_name": "PR-NC-29", "texture_color": "#FFFFFF", "texture_url": "/static/images/wood/panels/classic_parquet/PR-NC-29.jpg", "thumbnail_url": "/thumb/wood/panels/classic_parquet/PR-NC-29.jpg", "color_name": "PR-NC-29"},
            {"id": "wood-cp-029", "product_type": "wood", "category": "Classic Parquet", "design_code": "PR-NC-30", "design_name": "PR-NC-30", "texture_color": "#FFFFFF", "texture_url": "/static/images/wood/panels/classic_parquet/PR-NC-30.jpg", "thumbnail_url": "/thumb/wood/panels/classic_parquet/PR-NC-30.jpg", "color_name": "PR-NC-30"},
        ],
    }

    design_counter = 1
    for cat in vmd_categories_non_emboss:
        cat_id = f"vmd-{cat.lower().replace(' ', '-').replace('&', 'and')}"
        category = {
            "id": cat_id,
            "name": cat,
            "product_type": "flat-embossed-vmd",
            "emboss_available": False,
            "designs": []
        }
        if cat in EXPLICIT_CATEGORY_DESIGNS:
            # Use hand-crafted design list with real image paths
            category["designs"] = EXPLICIT_CATEGORY_DESIGNS[cat]
        else:
            # Auto-generate placeholder designs for categories without assets yet
            for i in range(4):
                color = solid_colors[(design_counter - 1) % len(solid_colors)]
                category["designs"].append({
                    "id": f"vmd-design-{design_counter}",
                    "product_type": "flat-embossed-vmd",
                    "category": cat,
                    "design_code": f"VMD-{design_counter:04d}",
                    "design_name": f"{cat} Design {i+1}",
                    "texture_color": color,
                    "texture_url": None,
                    "thumbnail_url": None,
                    "color_name": ["Warm Tan", "Espresso", "Sienna", "Desert Sand", "Natural Oak", "Rose Clay", "Wheat", "Sandy", "Mocha", "Olive"][i % 10],
                })
                design_counter += 1
        vmd_panel["categories"].append(category)
    
    for cat in vmd_categories_emboss:
        category = {
            "id": f"vmd-{cat.lower().replace(' ', '-')}",
            "name": cat,
            "product_type": "flat-embossed-vmd",
            "emboss_available": True,
            "flat_available": True,
            "designs": []
        }
        # If there are explicit designs provided for this category, use them
        if cat in EXPLICIT_CATEGORY_DESIGNS:
            category["designs"] = EXPLICIT_CATEGORY_DESIGNS[cat]
        else:
            for i in range(4):
                color = solid_colors[(design_counter - 1) % len(solid_colors)]
                category["designs"].append({
                    "id": f"vmd-design-{design_counter}",
                    "product_type": "flat-embossed-vmd",
                    "category": cat,
                    "design_code": f"VMD-{design_counter:04d}",
                    "design_name": f"{cat} Design {i+1}",
                    "texture_color": color,
                    "texture_url": None,
                    "thumbnail_url": None,
                    "color_name": ["Carrara White", "Noir", "Walnut", "Charcoal"][i % 4],
                    "emboss": False,
                })
                design_counter += 1
        vmd_panel["categories"].append(category)
    
    products.append(vmd_panel)
    
    # 2. Wood Panels
    wood_product = {
        "id": "wood",
        "name": "Wood",
        "active": True,
        "sizes": ["1200x2400", "1200x2800"],
        "densities": [],
        "patterns": [],
        "colors": [],
        "thicknesses": ["12mm (PET Panel)", "25mm (PET Panel)", "PET Wool"],
        "categories": []
    }
    # Wood Classics category — designs drawn from the shared EXPLICIT_CATEGORY_DESIGNS dict
    wood_classics_category = {
        "id": "wood-wood-classics",
        "name": "Wood Classics",
        "product_type": "wood",
        "emboss_available": True,
        "designs": EXPLICIT_CATEGORY_DESIGNS.get("Wood Classics", []),
    }
    wood_product["categories"].append(wood_classics_category)
    classic_parquet_category = {
        "id": "wood-classic-parquet",
        "name": "Classic Parquet",
        "product_type": "wood",
        "emboss_available": False,
        "designs": EXPLICIT_CATEGORY_DESIGNS.get("Classic Parquet", []),
    }
    wood_product["categories"].append(classic_parquet_category)
    wood_perforations_category = {
        "id": "wood-perforations",
        "name": "Wood Perforations",
        "product_type": "wood",
        "emboss_available": False,
        "designs": EXPLICIT_CATEGORY_DESIGNS.get("Wood Perforations", []),
    }
    wood_product["categories"].append(wood_perforations_category)
    products.append(wood_product)
    
    # 3. Fabrics
    fabrics_product = {
        "id": "fabrics",
        "name": "Fabrics",
        "active": True,
        "sizes": ["1200x2400", "1200x2800"],
        "densities": [],
        "patterns": [],
        "colors": [],
        "thicknesses": ["12mm (PET Panel)", "25mm (PET Panel)", "PET Wool"],
        "categories": []
    }
    modern_corporate_category = {
        "id": "fabrics-modern-corporate",
        "name": "Modern Corporate",
        "product_type": "fabrics",
        "emboss_available": False,
        "designs": EXPLICIT_CATEGORY_DESIGNS.get("Modern Corporate", []),
    }
    fabrics_product["categories"].append(modern_corporate_category)
    color_core_category = {
        "id": "fabrics-color-core",
        "name": "Color Core",
        "product_type": "fabrics",
        "emboss_available": True,
        "designs": [],
    }
    fabrics_product["categories"].append(color_core_category)
    designer_textile_category = {
        "id": "fabrics-designer-textile",
        "name": "Designer Textile",
        "product_type": "fabrics",
        "emboss_available": True,
        "designs": [],
    }
    fabrics_product["categories"].append(designer_textile_category)
    products.append(fabrics_product)
    
    # 4. Ombre Panels — Color Core Ombre
    ombre_panel = {
        "id": "ombre",
        "name": "Ombre",
        "active": True,
        "sizes": ["1200x2800", "1200x2400"],
        "densities": [],
        "patterns": [],
        "colors": [],
        "thicknesses": ["12mm (PET Panel)", "25mm (PET Panel)", "PET Wool"],
        "categories": []
    }

    color_core_ombre_category = {
        "id": "ombre-color-core-ombre",
        "name": "Color Core Ombre",
        "product_type": "ombre",
        "emboss_available": False,
        "designs": [],
    }
    ombre_panel["categories"].append(color_core_ombre_category)

    signature_ombre_category = {
        "id": "signature-ombre",
        "name": "Signature Ombre",
        "product_type": "ombre",
        "emboss_available": False,
        "designs": [],
    }
    ombre_panel["categories"].append(signature_ombre_category)

    products.append(ombre_panel)
    
    # 5. Univic Strip Panels
    vicstrip_colors = [
        "#FFFFFF", "#F5F5F5", "#E0E0E0", "#BDBDBD",
        "#8D6E63", "#795548", "#5D4037", "#3E2723",
        "#212121", "#37474F", "#455A64", "#546E7A",
        "#1565C0", "#1976D2", "#2196F3", "#42A5F5"
    ]
    
    vicstrip_panel = {
        "id": "vicstrip",
        "name": "Univic Strip",
        "active": True,
        "sizes": ["600x600", "600x2400"],
        "densities": [],
        "patterns": ["Single Groove", "Double Groove", "Square", "Double Square"],
        "colors": vicstrip_colors,
        "thicknesses": ["12mm (PET Panel)", "25mm (PET Panel)"],
        "categories": []
    }
    
    vicstrip_color_names = [
        "Pure White", "Cloud", "Silver", "Pewter",
        "Latte", "Walnut", "Espresso", "Chocolate",
        "Charcoal", "Slate", "Storm", "Graphite",
        "Ocean", "Azure", "Sky", "Cerulean"
    ]
    
    # VicStrip has pattern-based designs instead of categories
    for pattern in vicstrip_panel["patterns"]:
        category = {
            "id": f"vicstrip-{pattern.lower().replace(' ', '-')}",
            "name": pattern,
            "product_type": "vicstrip",
            "emboss_available": False,
            "designs": []
        }
        for i, color in enumerate(vicstrip_colors):
            # design_code is 1-based PER pattern so it lines up with the disk
            # filenames at static/images/vicstrip/thumbnails/{pattern}_vcs{####}.png
            # which are numbered 1..16 inside each pattern folder.
            # `id` keeps the global counter so it stays unique across patterns.
            category["designs"].append({
                "id": f"vicstrip-design-{design_counter}",
                "product_type": "vicstrip",
                "category": pattern,
                "design_code": f"VCS-{i + 1:04d}",
                "design_name": f"{pattern} - {vicstrip_color_names[i]}",
                "texture_color": color,
                "texture_url": None,
                "thumbnail_url": None,
                "pattern": pattern,
                "color": color,
                "color_name": vicstrip_color_names[i],
            })
            design_counter += 1
        vicstrip_panel["categories"].append(category)
    
    products.append(vicstrip_panel)
    
    return products


MOCK_PRODUCTS = generate_mock_products()


# API Routes
@api_router.get("/")
async def root():
    return {"message": "UniVicoustic Product Configurator API"}

@api_router.get("/products", response_model=List[dict])
async def get_products():
    """Get all product types with their configurations"""
    return MOCK_PRODUCTS

@api_router.get("/products/{product_id}")
async def get_product(product_id: str):
    """Get a specific product type by ID"""
    for product in MOCK_PRODUCTS:
        if product["id"] == product_id:
            return product
    return {"error": "Product not found"}

@api_router.get("/products/{product_id}/categories")
async def get_product_categories(product_id: str):
    """Get categories for a specific product type"""
    for product in MOCK_PRODUCTS:
        if product["id"] == product_id:
            return product.get("categories", [])
    return []

@api_router.get("/products/{product_id}/categories/{category_id}/designs")
async def get_category_designs(product_id: str, category_id: str):
    """Get designs for a specific category"""
    for product in MOCK_PRODUCTS:
        if product["id"] == product_id:
            for category in product.get("categories", []):
                if category["id"] == category_id:
                    return category.get("designs", [])
    return []

@api_router.get("/products/{product_id}/specs")
async def get_product_specs(product_id: str):
    """Get technical specifications for a product type"""
    return TECH_SPECS.get(product_id, {})

# ── Chat endpoint ────────────────────────────────────────────────────────────

# Chat runs on Gemini.  It was Claude Haiku until the Anthropic key lapsed;
# the Wall Visualizer below is still on Anthropic and still down for the same
# reason — moving it is a separate job (vision + strict JSON).
#
# Model is env-driven so it can be changed on the server without a redeploy.
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")

# USD per 1M tokens — verify at https://ai.google.dev/gemini-api/docs/pricing
# when changing GEMINI_MODEL, or the cost figures in the chat logs drift.
_PRICE_INPUT_PER_MTOK  = 0.30
_PRICE_OUTPUT_PER_MTOK = 2.50

class ChatMessage(BaseModel):
    role: str
    content: str = Field(max_length=2000)

class ChatRequest(BaseModel):
    messages: List[ChatMessage] = Field(max_items=20)

# Simple in-memory rate limiter (20 requests / 60 seconds per IP)
_rate_store: dict = defaultdict(list)
_RATE_LIMIT = 20
_RATE_WINDOW = 60

def _check_rate_limit(client_ip: str) -> bool:
    now = time.time()
    _rate_store[client_ip] = [t for t in _rate_store[client_ip] if now - t < _RATE_WINDOW]
    if len(_rate_store[client_ip]) >= _RATE_LIMIT:
        return False
    _rate_store[client_ip].append(now)
    return True

# ── Wall Visualizer endpoint ────────────────────────────────────────────────
# Powers the standalone /visualizer page (frontend src/visualizer/).
# Takes a room photo, asks Claude vision to find the wall quadrilaterals,
# returns structured JSON the frontend uses to drive a homography-based
# panel composite.
#
# Why a new endpoint instead of reusing /chat: the chat endpoint expects
# text-only messages and a small token budget; vision needs base64 image
# input plus a tighter prompt that returns strict JSON.

# Pricing constants for the vision-capable model — verify at
# https://www.anthropic.com/pricing.  Sonnet costs more than Haiku per
# token but is a step-up in spatial reasoning, which matters when the
# task is "where exactly are the wall corners."
_VIS_PRICE_INPUT_PER_MTOK  = 3.00
_VIS_PRICE_OUTPUT_PER_MTOK = 15.00

# Strict prompt — ask Claude to return ONLY JSON.  Each wall is described
# by four corner points (in pixel coordinates of the original photo) plus
# metadata the frontend uses for compositing decisions.
_WALL_VISION_PROMPT = """You are an expert in interior photography and 2D room geometry.  Your only job is to find the precise pixel boundary of each VERTICAL WALL surface in the photo so we can paste a wall-panel texture onto it.

Look at the photo.  For each VERTICAL WALL identify the four corner pixel coordinates of just the bare wall surface (the vertical plane where panels would be installed).  Use the original image's pixel coordinate system (origin at top-left, x → right, y → down).

CRITICAL — what counts as the wall:
  • ONLY the vertical wall plane itself.  The wall ENDS at the floor line, the ceiling line, and at any adjacent wall's corner.
  • DO NOT include the floor, ceiling, baseboards, crown moulding, or skirting.
  • DO NOT include windows, doors, mirrors, artwork, decorations, or any opening cut into the wall.
  • DO NOT include furniture in front of the wall.  If a couch or shelf hides part of the wall, return the wall's full quadrilateral as if the obstruction wasn't there — the user masks furniture later.
  • The four corners must trace the actual visible vertical-plane edges, NOT the photo's outer corners.  If the wall doesn't reach the edge of the photo, neither should your corners.

Return ONE quadrilateral per distinct wall plane.  Two walls that meet at a corner give TWO entries (the back wall and the left/right wall), each with their own quadrilateral that ends at the shared vertical seam between them.

Corners must be in this order: top-left, top-right, bottom-right, bottom-left of THAT wall as it appears in the photo (so for a side wall in perspective, top-left is the corner that's higher and farther from the viewer, etc.).

Return STRICT JSON in this exact shape, no prose, no markdown fence:

{
  "image_size": { "w": <int>, "h": <int> },
  "walls": [
    {
      "id": "wall-1",
      "type": "back" | "left" | "right" | "other",
      "corners": [
        { "x": <int>, "y": <int> },
        { "x": <int>, "y": <int> },
        { "x": <int>, "y": <int> },
        { "x": <int>, "y": <int> }
      ],
      "lighting_direction": "from-left" | "from-right" | "from-top" | "from-front" | "ambient",
      "confidence": 0.0..1.0,
      "notes": "<short human-readable note about this specific wall>"
    }
  ]
}

DO NOT include ceiling as a wall type — we don't apply panels to ceilings.  If no clear walls are visible, return an empty walls array.  Do not invent walls that aren't there.  Maximum 3 walls (back + 2 sides).
"""


class VisualizeWallsRequest(BaseModel):
    """Body for /api/visualize-walls.  Image is base64 PNG/JPEG bytes —
    `data:image/...;base64,` prefix accepted but stripped server-side."""
    image_base64: str
    image_mime: str = "image/jpeg"  # caller hint; stripped if image_base64 has data: prefix


@api_router.post("/visualize-walls")
async def visualize_walls(payload: VisualizeWallsRequest, req: Request):
    client_ip = req.client.host if req.client else "unknown"
    if not _check_rate_limit(client_ip):
        raise HTTPException(status_code=429, detail="Too many requests — please wait a moment.")

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="Wall visualizer is not configured (missing ANTHROPIC_API_KEY).")

    # Strip data: URL prefix if the caller sent one, then validate the base64
    # is non-empty and not absurdly large (10 MB cap, matches the frontend
    # PhotoUpload component's check).
    raw_b64 = payload.image_base64
    detected_mime = payload.image_mime or "image/jpeg"
    if raw_b64.startswith("data:"):
        # data:image/png;base64,iVBOR...
        try:
            header, raw_b64 = raw_b64.split(",", 1)
            detected_mime = header.split(";", 1)[0].replace("data:", "") or detected_mime
        except ValueError:
            raise HTTPException(status_code=400, detail="Malformed data URL.")
    if not raw_b64:
        raise HTTPException(status_code=400, detail="image_base64 is empty.")
    # 4/3 base64 ratio → 10 MB image ≈ 13.3 MB base64 string
    if len(raw_b64) > 14 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Image too large — keep it under 10 MB.")

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)

        _t0 = time.time()
        response = client.messages.create(
            model="claude-sonnet-4-5-20250929",  # vision-capable model with strong spatial reasoning
            max_tokens=1500,
            messages=[
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": detected_mime,
                                "data": raw_b64,
                            },
                        },
                        {"type": "text", "text": _WALL_VISION_PROMPT},
                    ],
                }
            ],
        )
        duration_ms = int((time.time() - _t0) * 1000)

        usage = response.usage
        cost_usd = (
            usage.input_tokens * _VIS_PRICE_INPUT_PER_MTOK
            + usage.output_tokens * _VIS_PRICE_OUTPUT_PER_MTOK
        ) / 1_000_000

        # Claude was instructed to return strict JSON.  Pull out the JSON
        # from the first text content block, then defend against any
        # accidental markdown fence or leading prose.
        raw_text = response.content[0].text.strip()
        if raw_text.startswith("```"):
            # Strip markdown fence:  ```json ... ```  →  ...
            raw_text = raw_text.strip("`")
            if raw_text.startswith("json"):
                raw_text = raw_text[4:]
            raw_text = raw_text.strip()
        try:
            parsed = json.loads(raw_text)
        except json.JSONDecodeError as je:
            logger.error(f"visualize-walls: Claude returned non-JSON. First 500 chars: {raw_text[:500]!r}")
            raise HTTPException(status_code=502, detail="Vision model returned malformed JSON; try again.") from je

        # Log usage to the same daily file used by /chat for consistency.
        log_entry = {
            "ts":            datetime.now(timezone.utc).isoformat(),
            "endpoint":      "visualize-walls",
            "model":         "claude-sonnet-4-5-20250929",
            "input_tokens":  usage.input_tokens,
            "output_tokens": usage.output_tokens,
            "cost_usd":      round(cost_usd, 6),
            "duration_ms":   duration_ms,
            "walls_found":   len(parsed.get("walls", [])),
            "ip_hash":       hashlib.sha256(client_ip.encode()).hexdigest()[:12],
        }
        log_file = CHAT_LOGS_DIR / datetime.now(timezone.utc).strftime("%Y-%m-%d.jsonl")
        with open(log_file, "a", encoding="utf-8") as _lf:
            _lf.write(json.dumps(log_entry) + "\n")

        logger.info(
            f"VisWalls | in={usage.input_tokens} out={usage.output_tokens} "
            f"cost=${cost_usd:.6f} walls={len(parsed.get('walls', []))} duration={duration_ms}ms"
        )
        return parsed
    except HTTPException:
        raise
    except Exception as e:
        err_str = str(e)
        logger.error(f"visualize-walls error: {e}")
        if "429" in err_str or "rate_limit" in err_str.lower() or "overloaded" in err_str.lower():
            raise HTTPException(status_code=429, detail="Vision service is busy — please try again in a moment.")
        raise HTTPException(status_code=500, detail="Vision service error — please try again.")


@api_router.post("/chat")
async def chat(request: ChatRequest, req: Request):
    client_ip = req.client.host if req.client else "unknown"
    if not _check_rate_limit(client_ip):
        raise HTTPException(status_code=429, detail="Too many requests — please wait a moment.")

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="Chat assistant is not configured.")

    if not request.messages:
        raise HTTPException(status_code=400, detail="No messages provided.")

    # Only allow role values of 'user' or 'assistant' to prevent prompt injection via role field
    for msg in request.messages:
        if msg.role not in ("user", "assistant"):
            raise HTTPException(status_code=400, detail="Invalid message role.")

    try:
        from google import genai
        from google.genai import types
        client = genai.Client(api_key=api_key)

        # Gemini names the assistant turn "model", not "assistant".  The role
        # values themselves are already whitelisted above.
        contents = [
            types.Content(
                role="model" if msg.role == "assistant" else "user",
                parts=[types.Part(text=msg.content)],
            )
            for msg in request.messages
        ]

        _t0 = time.time()
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                max_output_tokens=1024,
                # 2.5-series models reason before answering and bill that
                # thinking against max_output_tokens.  Left on, a long think
                # can consume the whole 1024 budget and return an EMPTY reply.
                # A product FAQ bot doesn't need it — off is faster, cheaper
                # and removes that failure mode entirely.
                thinking_config=types.ThinkingConfig(thinking_budget=0),
            ),
        )
        duration_ms = int((time.time() - _t0) * 1000)

        usage = response.usage_metadata
        input_tok  = getattr(usage, "prompt_token_count", 0) or 0
        output_tok = getattr(usage, "candidates_token_count", 0) or 0
        cost_usd   = (input_tok * _PRICE_INPUT_PER_MTOK + output_tok * _PRICE_OUTPUT_PER_MTOK) / 1_000_000

        # `.text` is None when the answer was cut short or filtered, rather
        # than raising — surface why instead of returning an empty bubble.
        reply = (response.text or "").strip()
        if not reply:
            finish = None
            if response.candidates:
                finish = getattr(response.candidates[0], "finish_reason", None)
            logger.warning(f"Chat produced no text (finish_reason={finish})")
            if str(finish).upper().endswith("SAFETY"):
                raise HTTPException(
                    status_code=400,
                    detail="I can't answer that one — please try rephrasing.",
                )
            raise HTTPException(status_code=500, detail="Chat service error — please try again.")

        log_entry = {
            "ts":            datetime.now(timezone.utc).isoformat(),
            "model":         GEMINI_MODEL,
            "input_tokens":  input_tok,
            "output_tokens": output_tok,
            "cost_usd":      round(cost_usd, 6),
            "duration_ms":   duration_ms,
            "ip_hash":       hashlib.sha256(client_ip.encode()).hexdigest()[:12],
        }
        log_file = CHAT_LOGS_DIR / datetime.now(timezone.utc).strftime("%Y-%m-%d.jsonl")
        with open(log_file, "a", encoding="utf-8") as _lf:
            _lf.write(json.dumps(log_entry) + "\n")

        logger.info(
            f"Chat | model={GEMINI_MODEL} in={input_tok} out={output_tok} "
            f"cost=${cost_usd:.6f} duration={duration_ms}ms"
        )
        return {"reply": reply}
    except HTTPException:
        raise
    except Exception as e:
        err_str = str(e)
        logger.error(f"Gemini chat error: {e}")
        low = err_str.lower()
        if "429" in err_str or "resource_exhausted" in low or "quota" in low or "rate" in low:
            raise HTTPException(status_code=429, detail="The assistant is busy — please try again in a moment.")
        if "api key" in low or "permission" in low or "401" in err_str or "403" in err_str:
            # Config problem, not a user problem — 503 keeps it out of the
            # "user did something wrong" bucket in the logs.
            raise HTTPException(status_code=503, detail="Chat assistant is not configured.")
        raise HTTPException(status_code=500, detail="Chat service error — please try again.")


# ── Analytics: POST /api/events (replaces PostHog) ───────────────────────────
# Batches of events are POSTed by the frontend analytics layer (see
# frontend/src/lib/analytics.js). The endpoint writes them to a local
# SQLite DB (analytics.db). Anonymous by design — no auth required, but
# we capture User-Agent server-side and the client provides a stable
# anon_id (persisted in their localStorage) so sessions can be stitched
# for analysis without ever knowing who the visitor is.
import analytics_db  # noqa: E402
import geoip_lookup  # noqa: E402  — offline IP→geo resolver (safe if DB absent)


def _client_ip(request: Request) -> Optional[str]:
    """Best-effort real client IP.

    nginx (the only proxy in front — no load balancer) sets
    `X-Real-IP: $remote_addr`, i.e. the actual socket peer = the visitor, and
    overwrites any client-supplied value, so it can't be spoofed. Prefer it.

    Fallback to the LAST entry of X-Forwarded-For: with nginx's
    `$proxy_add_x_forwarded_for`, the real client IP is the hop nginx appended
    (last), while any earlier entries could be attacker-supplied. Finally fall
    back to the socket peer (only meaningful when not behind a proxy).
    """
    xri = request.headers.get("x-real-ip")
    if xri and xri.strip():
        return xri.strip()
    xff = request.headers.get("x-forwarded-for")
    if xff:
        parts = [p.strip() for p in xff.split(",") if p.strip()]
        if parts:
            return parts[-1]
    return request.client.host if request.client else None


class _AnalyticsEvent(BaseModel):
    event_name: str
    anon_id: str
    session_id: str
    user_id: Optional[str] = None
    properties: Optional[dict] = None
    url: Optional[str] = None
    client_ts: Optional[int] = None

class _AnalyticsBatch(BaseModel):
    events: List[_AnalyticsEvent]

@api_router.post("/events", status_code=204)
async def post_events(batch: _AnalyticsBatch, request: Request):
    ua = request.headers.get("user-agent", "")
    # Resolve geo ONCE per request: every event in the batch comes from the
    # same browser, so they share one IP. The IP is used only here and never
    # stored or logged — only the derived country/region/city are persisted.
    # lookup() never raises, so a geo failure can't break event capture.
    country, region, city = geoip_lookup.lookup(_client_ip(request))

    # Professional role: read from the user's ACCOUNT (auth.db), not from the
    # client payload, so it can't be spoofed and stays correct across devices
    # and re-logins. One query per batch covering every distinct user_id in it
    # (usually exactly one). Anonymous events simply get None.
    # Imported locally: `auth` is imported at the bottom of this module, after
    # the app is defined, so it isn't available at module scope up here.
    try:
        from auth import get_profiles_for_user_ids
        profiles = get_profiles_for_user_ids([ev.user_id for ev in batch.events])
    except Exception as e:
        logger.warning(f"profile lookup failed, events will record no profile: {e!r}")
        profiles = {}

    rows = []
    for ev in batch.events:
        row = ev.model_dump()
        # Server-trusted UA; client can't spoof what we record here.
        row["user_agent"] = ua
        row["country"] = country
        row["region"] = region
        row["city"] = city
        row["profile"] = profiles.get(str(ev.user_id)) if ev.user_id else None
        rows.append(row)
    try:
        analytics_db.insert_events(rows)
    except Exception as e:
        # Don't fail the request — analytics shouldn't block users. Log and
        # return 204 anyway.
        logger.error(f"analytics insert failed: {e}")
    return None


# ── Analytics data export: GET /api/admin/analytics/export ──────────────────
# Machine-readable JSON feed of the raw analytics event store, for the central
# analytics web app to ingest. It exposes the same rows the admin dashboard is
# built from, but as structured JSON instead of HTML.
#
# Auth — the token may be supplied either as `?key=<token>` or as an
#   `Authorization: Bearer <token>` header. Two env vars are accepted:
#     ADMIN_TOKEN             — the existing full-admin token (also unlocks the
#                               HTML dashboard + per-user PII views)
#     ANALYTICS_EXPORT_TOKEN  — optional export-only token; set this and hand it
#                               to the other app so it can pull data without
#                               holding the full-admin token (independent
#                               rotation, least privilege).
#   If NEITHER is configured the route 404s, so a misconfigured deploy can't
#   silently leak the whole event store.
#
# Pagination — incremental by the monotonic autoincrement `id` (stable; two
# events can share a server_ts, ids never tie). The consumer pages forward:
#     1. GET …/export?key=…                    → first page (since_id defaults 0)
#     2. read pagination.next_since_id
#     3. GET …/export?key=…&since_id=<that>    → next page
#     4. repeat while pagination.has_more is true
#   Storing the last next_since_id and re-requesting later pulls ONLY new
#   events — that's how the central app does both the initial full backfill and
#   cheap ongoing syncs. `meta.max_id` is the snapshot boundary at query time.

def _resolve_export_token(key: str, request: Request) -> None:
    """Shared auth gate for the export endpoint. Raises 404 when unconfigured,
    401 on mismatch; returns None when the caller is authorised."""
    admin_token = os.environ.get("ADMIN_TOKEN", "")
    export_token = os.environ.get("ANALYTICS_EXPORT_TOKEN", "")
    valid_tokens = {t for t in (admin_token, export_token) if t}
    if not valid_tokens:
        # Neither token configured — behave exactly like the dashboard does
        # when ADMIN_TOKEN is unset: pretend the route doesn't exist.
        raise HTTPException(status_code=404, detail="Not found")
    supplied = key
    if not supplied:
        auth = request.headers.get("authorization", "")
        if auth.lower().startswith("bearer "):
            supplied = auth[7:].strip()
    if supplied not in valid_tokens:
        raise HTTPException(status_code=401, detail="Bad key")


@api_router.get("/admin/analytics/export")
async def export_analytics(
    request: Request,
    key: str = "",
    since_id: int = 0,
    limit: int = 1000,
):
    _resolve_export_token(key, request)

    events = analytics_db.fetch_events_after(since_id=since_id, limit=limit)
    store = analytics_db.stats()

    # ISO-8601 UTC alongside the raw epoch-ms, so a consumer doesn't have to
    # know the unit. server_ts is the authoritative, server-assigned time.
    for e in events:
        ts = e.get("server_ts")
        e["server_ts_iso"] = (
            datetime.fromtimestamp(ts / 1000, tz=timezone.utc).isoformat()
            if ts else None
        )

    last_id = events[-1]["id"] if events else int(since_id)
    return {
        "meta": {
            "schema_version": 1,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "total_events": store["total_events"],
            "max_id": store["max_id"],
        },
        "pagination": {
            "since_id": max(0, int(since_id)),
            "limit": max(1, min(int(limit), analytics_db.MAX_EXPORT_LIMIT)),
            "returned": len(events),
            "next_since_id": last_id,
            "has_more": bool(events) and last_id < store["max_id"],
        },
        "events": events,
    }


def _render_user_detail(conn, key: str, by_user_id: str = "", by_anon_id: str = "") -> str:
    """Render the per-user detail page.

    Two modes:
      - by_user_id: aggregate across all anon_ids tied to this user_id
        (so a person on two devices appears as one user).
      - by_anon_id: scope to a single browser/device — used for visitors
        who never logged in.

    Shows summary (events, sessions, first/last seen, outcomes), a deduped
    list of configurations they tried (product/category/size/thickness/
    emboss extracted from event properties), and the full event timeline.
    """
    def q(sql, *params):
        return conn.execute(sql, params).fetchall()

    if by_user_id:
        where_sql = "user_id = ?"
        where_arg = by_user_id
        page_subject = f"User <code>{by_user_id}</code>"
        # Pull current email (latest user_identified event)
        email_row = q(
            "SELECT json_extract(properties, '$.email') FROM events "
            "WHERE user_id = ? AND event_name = 'user_identified' "
            "ORDER BY server_ts DESC LIMIT 1", by_user_id,
        )
        email = email_row[0][0] if email_row else None
    elif by_anon_id:
        where_sql = "anon_id = ?"
        where_arg = by_anon_id
        page_subject = f"Anonymous visitor <code>{by_anon_id}</code>"
        email = None
    else:
        return "<p>Bad request: need user= or anon= query param.</p>"

    summary = q(
        f"""
        SELECT COUNT(*) AS events,
               COUNT(DISTINCT session_id) AS sessions,
               COUNT(DISTINCT anon_id) AS devices,
               MIN(server_ts) AS first_seen,
               MAX(server_ts) AS last_seen,
               MAX(user_id) AS user_id,
               SUM(CASE WHEN event_name='download_clicked' THEN 1 ELSE 0 END) AS downloads,
               SUM(CASE WHEN event_name='save_clicked' THEN 1 ELSE 0 END) AS saves,
               SUM(CASE WHEN event_name='tech_specs_viewed' THEN 1 ELSE 0 END) AS specs,
               MAX(user_agent) AS ua,
               -- Professional role from their account, stamped onto each event
               -- at ingest. MAX() picks the non-NULL value if any event has it.
               MAX(profile) AS profile
        FROM events
        WHERE {where_sql}
        """, where_arg,
    )[0]

    if not summary[0]:
        return f"""<!doctype html><html><body style="font:14px sans-serif;padding:32px">
        <p>No events found for {page_subject}.</p>
        <p><a href="?key={key}">&larr; Back to overview</a></p>
        </body></html>"""

    events, sessions, devices, first_seen, last_seen, uid, dl, sv, specs, ua, profile = summary

    # Slug → display label, mirroring the overview page's By-profile table.
    _PROFILE_LABELS = {
        "architect": "Architect",
        "interior_designer": "Interior Designer",
        "pmc": "Project Management Consultant",
        "acoustic_consultant": "Acoustic Consultant",
        "other": "Other",
    }
    profile_label = _PROFILE_LABELS.get(profile, profile) if profile else "Not set"

    # Pull every event for this user/anon; we'll group + count combinations
    # in Python (small per-user data so simpler than SQL gymnastics).
    rows = q(
        f"SELECT server_ts, event_name, session_id, anon_id, properties "
        f"FROM events WHERE {where_sql} ORDER BY server_ts ASC",
        where_arg,
    )

    # Build "configurations tried" — group by (product_type, category, size,
    # thickness, emboss) extracted from each event's properties JSON.
    from collections import Counter
    combos = Counter()
    for row in rows:
        props = row[-1]  # properties is last column regardless of select shape
        if not props:
            continue
        try:
            p = json.loads(props)
        except Exception:
            continue
        if not isinstance(p, dict):
            continue
        keys = ("product_type", "category", "size", "thickness", "emboss")
        combo = tuple((p.get(k) or "—") for k in keys)
        if any(v != "—" for v in combo):
            combos[combo] += 1

    # IST formatter to match the main overview dashboard.
    IST = timezone(timedelta(hours=5, minutes=30))
    def fmt_ts(ms):
        return datetime.fromtimestamp(ms / 1000, tz=IST).strftime('%Y-%m-%d %H:%M:%S')

    # Sum-of-session-durations for THIS user, bounded per session so an
    # idle tab doesn't inflate the total.  Computed in Python over the
    # already-loaded `rows` list (avoids another DB hit).
    _session_bounds = {}
    for row in rows:
        ts, _name, sid, _aid, _props = row
        if sid not in _session_bounds:
            _session_bounds[sid] = [ts, ts]
        else:
            if ts > _session_bounds[sid][1]:
                _session_bounds[sid][1] = ts
            if ts < _session_bounds[sid][0]:
                _session_bounds[sid][0] = ts
    total_user_active_ms = sum(end - start for start, end in _session_bounds.values())
    def fmt_duration(ms):
        if ms is None or ms <= 0: return "0:00:00"
        s = int(ms // 1000); h, r = divmod(s, 3600); m, sec = divmod(r, 60)
        return f"{h}:{m:02d}:{sec:02d}"

    combo_rows = "".join(
        f"<tr>"
        f"<td>{p}</td><td>{c}</td><td>{s}</td><td>{t}</td><td>{e}</td>"
        f"<td class=num>{n}</td>"
        f"</tr>"
        for (p, c, s, t, e), n in combos.most_common(40)
    )

    def _props_cell_detail(props, name, ts):
        if not props:
            return "<td><span class=anon>—</span></td>"
        ts_str = fmt_ts(ts)
        return (
            f'<td class=props-trunc'
            f' data-props="{_h(props, quote=True)}"'
            f' data-event="{_h(name, quote=True)}"'
            f' data-time="{_h(ts_str, quote=True)}"'
            f' title="Click to view full payload">'
            f'{_h(props)}'
            f'</td>'
        )

    timeline = "".join(
        f"<tr>"
        f"<td class=ts>{fmt_ts(ts)}</td>"
        f"<td>{name}</td>"
        f"<td class=mono>{sid[:8]}…</td>"
        f"<td class=mono>{aid[:8]}…</td>"
        f"{_props_cell_detail(props, name, ts)}"
        f"</tr>"
        for ts, name, sid, aid, props in rows
    )

    if by_user_id:
        auth_badge = f'<span class=userid>{by_user_id[:8]}…</span> logged-in' + (f' · {email}' if email else '')
    else:
        auth_badge = '<span class=anon>anonymous (never logged in)</span>'

    subject_id = by_user_id or by_anon_id
    return f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>{('User ' if by_user_id else 'Anon ') + subject_id[:8]} — UV Analytics</title>
<style>
  *{{box-sizing:border-box}}
  body{{font:14px -apple-system,Segoe UI,Inter,sans-serif;margin:0;background:#f7f8fa;color:#1f2937}}
  header{{padding:18px 24px;background:#fff;border-bottom:1px solid #cbd5e1}}
  header h1{{margin:0;font-size:18px;font-weight:600}}
  header .crumb{{font-size:12px;color:#6b7280;margin-top:4px}}
  header .crumb a{{color:#4338ca;text-decoration:none}}
  header .crumb a:hover{{text-decoration:underline}}
  .wrap{{padding:0;max-width:none;margin:0}}
  .cards{{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:1px;margin:0;background:#cbd5e1;border-bottom:1px solid #cbd5e1}}
  .card{{background:#fff;border:0;border-radius:0;padding:16px 18px}}
  .card .lbl{{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280}}
  .card .val{{font-size:22px;font-weight:600;margin-top:4px;color:#0f172a}}
  section{{background:#fff;border:0;border-bottom:1px solid #cbd5e1;border-radius:0;padding:18px;margin:0}}
  section h2{{margin:0 0 12px 0;font-size:14px;font-weight:600;color:#0f172a}}
  table{{width:100%;border-collapse:collapse;font-size:13px}}
  th,td{{padding:7px 10px;border-bottom:1px solid #f1f5f9;text-align:left;vertical-align:top}}
  th{{font-weight:500;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.05em;background:#fafafa}}
  td.num{{text-align:right;font-variant-numeric:tabular-nums;font-weight:500}}
  /* Headers of numeric columns must right-align with their values — without
     this the `th,td{{text-align:left}}` rule above left-aligns the header while
     td.num right-aligns the number, so on a wide table the two drift to
     opposite ends of the column and the figures look like they belong to the
     neighbouring column. */
  th.num{{text-align:right}}
  td.ts{{white-space:nowrap;color:#6b7280;font-variant-numeric:tabular-nums}}
  td.mono{{font-family:ui-monospace,Menlo,Consolas,monospace;color:#6b7280;font-size:12px}}
  /* Properties cell: same click-to-modal pattern as the main dashboard. */
  td.props-trunc{{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;color:#374151;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;border-bottom:1px dotted transparent}}
  td.props-trunc:hover{{background:#f1f5f9;border-bottom-color:#94a3b8}}
  table.fixed{{table-layout:fixed}}
  /* Wide-table scroll wrapper, same trick as main dashboard. */
  .table-scroll{{overflow-x:auto;margin:0 -18px;padding:0 18px;-webkit-overflow-scrolling:touch}}
  /* Modal — shared markup with the main dashboard */
  .modal-overlay{{position:fixed;inset:0;background:rgba(15,23,42,0.5);display:none;align-items:center;justify-content:center;z-index:1000;padding:24px}}
  .modal-overlay.open{{display:flex}}
  .modal-box{{background:#fff;border-radius:0;width:min(720px,100%);max-height:80vh;display:flex;flex-direction:column;border:1px solid #0f172a;box-shadow:none;overflow:hidden}}
  .modal-head{{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid #e5e7eb;gap:12px}}
  .modal-title{{font-size:13px;font-weight:600;color:#0f172a;line-height:1.4;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}
  .modal-x{{background:none;border:0;font-size:22px;line-height:1;color:#94a3b8;cursor:pointer;padding:0 6px}}
  .modal-x:hover{{color:#0f172a}}
  .modal-body{{flex:1;margin:0;padding:14px 18px;overflow:auto;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;line-height:1.55;color:#1f2937;white-space:pre-wrap;word-break:break-word;background:#fafafa}}
  .modal-foot{{padding:10px 18px;border-top:1px solid #e5e7eb;display:flex;justify-content:flex-end;gap:8px;background:#fff}}
  .modal-btn{{background:#4338ca;color:#fff;border:0;padding:6px 14px;border-radius:0;font-size:12px;font-weight:500;cursor:pointer}}
  .modal-btn:hover{{background:#3730a3}}
  .modal-btn.copied{{background:#16a34a}}
  .userid{{display:inline-block;padding:1px 6px;background:#dcfce7;color:#166534;border-radius:0;font-size:10px}}
  .anon{{display:inline-block;padding:1px 6px;background:#f3f4f6;color:#6b7280;border-radius:0;font-size:10px}}
  .pillrow{{display:flex;gap:8px;flex-wrap:wrap}}
</style></head>
<body>
<header>
  <h1>{('User' if by_user_id else 'Anonymous visitor')} <code style="font-size:14px">{subject_id}</code></h1>
  <div class="crumb"><a href="?key={key}">&larr; Back to overview</a> &nbsp;·&nbsp; {auth_badge}</div>
</header>
<div class="wrap">

  <div class="cards">
    <div class="card"><div class="lbl">Profile</div><div class="val" style="font-size:15px">{_h(profile_label)}</div></div>
    <div class="card"><div class="lbl">Total events</div><div class="val">{events:,}</div></div>
    <div class="card"><div class="lbl">Sessions</div><div class="val">{sessions:,}</div></div>
    <div class="card"><div class="lbl">Devices</div><div class="val">{devices:,}</div></div>
    <div class="card"><div class="lbl">Downloads</div><div class="val">{dl:,}</div></div>
    <div class="card"><div class="lbl">Saves</div><div class="val">{sv:,}</div></div>
    <div class="card"><div class="lbl">Specs viewed</div><div class="val">{specs:,}</div></div>
    <div class="card"><div class="lbl">Time on configurator</div><div class="val">{fmt_duration(total_user_active_ms)}</div></div>
    <div class="card"><div class="lbl">First seen (IST)</div><div class="val" style="font-size:14px">{fmt_ts(first_seen)}</div></div>
    <div class="card"><div class="lbl">Last seen (IST)</div><div class="val" style="font-size:14px">{fmt_ts(last_seen)}</div></div>
  </div>

  <section>
    <h2>Configurations tried &mdash; deduped, sorted by frequency</h2>
    <div class="table-scroll">
    <table>
      <thead><tr>
        <th>Product</th><th>Category</th><th>Size</th><th>Thickness</th><th>Emboss</th>
        <th class=num>Events touching this combo</th>
      </tr></thead>
      <tbody>{combo_rows or '<tr><td colspan=6><em>No configuration data in this user&apos;s events</em></td></tr>'}</tbody>
    </table>
    </div>
  </section>

  <section>
    <h2>Event timeline ({events:,} events)</h2>
    <div class="table-scroll">
    <table class="fixed">
      <thead><tr>
        <th style="width:170px">Time (IST)</th>
        <th style="width:180px">Event</th>
        <th style="width:90px">Session</th>
        <th style="width:90px">Anon ID</th>
        <th>Properties</th>
      </tr></thead>
      <tbody>{timeline}</tbody>
    </table>
    </div>
  </section>

</div>

<div id="props-modal" class="modal-overlay" aria-hidden="true" role="dialog">
  <div class="modal-box">
    <div class="modal-head">
      <div id="props-modal-title" class="modal-title"></div>
      <button class="modal-x" data-modal-close aria-label="Close">&times;</button>
    </div>
    <pre id="props-modal-body" class="modal-body"></pre>
    <div class="modal-foot">
      <button class="modal-btn" id="props-modal-copy">Copy JSON</button>
    </div>
  </div>
</div>

<script>
(function(){{
  var modal = document.getElementById('props-modal');
  var titleEl = document.getElementById('props-modal-title');
  var bodyEl = document.getElementById('props-modal-body');
  var copyBtn = document.getElementById('props-modal-copy');
  function openModal(props, eventName, eventTime){{
    var pretty = props;
    try {{ pretty = JSON.stringify(JSON.parse(props), null, 2); }} catch (e) {{}}
    titleEl.textContent = eventName + '  ·  ' + eventTime;
    bodyEl.textContent = pretty;
    copyBtn.textContent = 'Copy JSON';
    copyBtn.classList.remove('copied');
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }}
  function closeModal(){{
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }}
  document.addEventListener('click', function(e){{
    var cell = e.target.closest('.props-trunc');
    if (cell) {{
      openModal(cell.dataset.props || '', cell.dataset.event || '', cell.dataset.time || '');
      return;
    }}
    if (e.target.matches('[data-modal-close]') || e.target === modal) {{
      closeModal();
    }}
  }});
  document.addEventListener('keydown', function(e){{
    if (e.key === 'Escape' && modal.classList.contains('open')) closeModal();
  }});
  copyBtn.addEventListener('click', function(){{
    var text = bodyEl.textContent;
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(text).then(function(){{
      copyBtn.textContent = 'Copied';
      copyBtn.classList.add('copied');
      setTimeout(function(){{
        copyBtn.textContent = 'Copy JSON';
        copyBtn.classList.remove('copied');
      }}, 1500);
    }});
  }});
}})();
</script>
</body></html>"""


# ── Analytics admin dashboard: GET /api/admin/analytics?key=… ───────────────
# Self-contained HTML page that renders top metrics by querying analytics.db
# directly. Single env var ADMIN_TOKEN gates access; if unset the route 404s
# so a misconfigured deploy doesn't leak data.
#
# Three views via query params:
#   /api/admin/analytics?key=…             → aggregate overview (default)
#   /api/admin/analytics?key=…&user=<id>   → per-user-id detail (logged-in user)
#   /api/admin/analytics?key=…&anon=<id>   → per-anon_id detail (pre-login / never-logged-in)
#
# Time window: &days=<n> scopes every windowed section (daily chart, top events,
# funnel, user tables).  `days=0` is the ALL-TIME view — cutoff drops to 0 so no
# section is bounded.  The top-row totals have always been all-time regardless.
@api_router.get("/admin/analytics", response_class=HTMLResponse)
async def admin_analytics(key: str = "", days: int = 14, user: str = "", anon: str = ""):
    admin_token = os.environ.get("ADMIN_TOKEN", "")
    if not admin_token:
        raise HTTPException(status_code=404, detail="Not found")
    if key != admin_token:
        raise HTTPException(status_code=401, detail="Bad key")

    # days=0 → all time. Otherwise clamp to 1..365 (was 90; widened so the
    # ranges offered in the picker below are all reachable).
    try:
        days = int(days)
    except (TypeError, ValueError):
        days = 14
    all_time = days <= 0
    days = 0 if all_time else min(days, 365)
    conn = analytics_db.get_conn()
    # cutoff 0 matches every row (server_ts is always > 0), so the same
    # `server_ts >= ?` queries below serve both modes without branching.
    cutoff_ms = 0 if all_time else int((time.time() - days * 86400) * 1000)
    # Labels reused across every windowed heading/card.
    win = "all time" if all_time else f"last {days} days"
    win_short = "all-time" if all_time else f"last {days}d"

    # All timestamps in the dashboard are rendered in IST (Asia/Kolkata,
    # UTC+5:30) — the team operates out of India and reading UTC adds an
    # unnecessary mental conversion step.  Server_ts is still stored as
    # epoch-ms UTC in the database; we only convert at the rendering edge.
    IST = timezone(timedelta(hours=5, minutes=30))

    def q(sql, *params):
        return conn.execute(sql, params).fetchall()

    # Duration formatter: ms → "h:mm:ss"  (e.g. 7842000 → "2:10:42")
    def _fmt_duration(ms):
        if ms is None or ms <= 0:
            return "0:00:00"
        s = int(ms // 1000)
        h, rem = divmod(s, 3600)
        m, sec = divmod(rem, 60)
        return f"{h}:{m:02d}:{sec:02d}"

    # Branch: per-user detail view ----------------------------------------------
    # ?user=<id> queries logged-in user across all their anon_ids/devices.
    # ?anon=<id> queries a single browser/device (used for never-logged-in).
    if user:
        return _render_user_detail(conn, key, by_user_id=user)
    if anon:
        return _render_user_detail(conn, key, by_anon_id=anon)
    # ---------------------------------------------------------------------------

    total_events = q("SELECT COUNT(*) FROM events")[0][0]
    total_users = q("SELECT COUNT(DISTINCT anon_id) FROM events")[0][0]
    total_sessions = q("SELECT COUNT(DISTINCT session_id) FROM events")[0][0]
    window_events = q("SELECT COUNT(*) FROM events WHERE server_ts >= ?", cutoff_ms)[0][0]
    window_users = q("SELECT COUNT(DISTINCT anon_id) FROM events WHERE server_ts >= ?", cutoff_ms)[0][0]

    top_events = q(
        "SELECT event_name, COUNT(*) FROM events WHERE server_ts >= ? "
        "GROUP BY event_name ORDER BY 2 DESC LIMIT 25",
        cutoff_ms,
    )

    outcomes = dict(q(
        "SELECT event_name, COUNT(DISTINCT anon_id) FROM events "
        "WHERE event_name IN ('save_clicked','download_clicked','tech_specs_viewed') "
        "AND server_ts >= ? GROUP BY event_name", cutoff_ms,
    ))

    daily = q(
        # Day buckets in IST so the chart matches local calendar.  The
        # +5 hours / +30 minutes modifiers shift epoch-UTC into IST before
        # date() truncates to the day boundary.
        "SELECT date(server_ts/1000, 'unixepoch', '+5 hours', '+30 minutes') AS d, "
        "       COUNT(*) AS events, COUNT(DISTINCT anon_id) AS users "
        "FROM events WHERE server_ts >= ? GROUP BY d ORDER BY d ASC",
        cutoff_ms,
    )

    # Latest 50 events.  Subquery looks up the email for each user_id from
    # that user's most recent user_identified event (so a logged-in user's
    # email is shown alongside every event they fire, not just the
    # user_identified row itself).  NULL email for events with no user_id.
    recent = q(
        """
        SELECT e.server_ts, e.event_name, e.anon_id, e.session_id, e.user_id, e.properties,
               (SELECT json_extract(ui.properties, '$.email')
                  FROM events ui
                  WHERE ui.user_id = e.user_id
                    AND ui.event_name = 'user_identified'
                  ORDER BY ui.server_ts DESC LIMIT 1) AS email
        FROM events e
        ORDER BY e.server_ts DESC
        LIMIT 50
        """
    )

    # Total active time across all sessions in the window. We bound each
    # session's contribution by its first/last event timestamp — so an idle
    # tab that fires no events doesn't inflate the total. Sessions that have
    # only one event count as zero duration (correctly: no measurable time
    # on page).
    total_active_ms = q(
        """
        SELECT COALESCE(SUM(duration_ms), 0) FROM (
          SELECT MAX(server_ts) - MIN(server_ts) AS duration_ms
          FROM events
          WHERE server_ts >= ?
          GROUP BY session_id
        )
        """, cutoff_ms,
    )[0][0]

    # Per-user total active time across the window, keyed by user_id, summed
    # over all of that user's sessions. Joined into top_users below.
    user_active_ms = dict(q(
        """
        SELECT user_id, COALESCE(SUM(duration_ms), 0) FROM (
          SELECT user_id, session_id, MAX(server_ts) - MIN(server_ts) AS duration_ms
          FROM events
          WHERE server_ts >= ? AND user_id IS NOT NULL
          GROUP BY user_id, session_id
        )
        GROUP BY user_id
        """, cutoff_ms,
    ))

    # Top users by activity in window — grouped by USER_ID (since the
    # configurator requires login, user_id is the canonical identifier).
    # email is pulled from the most recent `user_identified` event's
    # properties JSON. Aggregates across all anon_ids the user has used
    # (multiple devices / browsers / cleared-cookies sessions).
    top_users = q(
        """
        SELECT events.user_id,
               (SELECT json_extract(properties, '$.email')
                  FROM events ui
                  WHERE ui.user_id = events.user_id
                    AND ui.event_name = 'user_identified'
                  ORDER BY ui.server_ts DESC LIMIT 1) AS email,
               COUNT(*) AS events_n,
               COUNT(DISTINCT session_id) AS sessions,
               COUNT(DISTINCT anon_id) AS devices,
               MIN(server_ts) AS first_seen,
               MAX(server_ts) AS last_seen,
               SUM(CASE WHEN event_name='download_clicked' THEN 1 ELSE 0 END) AS downloads,
               SUM(CASE WHEN event_name='save_clicked' THEN 1 ELSE 0 END) AS saves,
               SUM(CASE WHEN event_name='tech_specs_viewed' THEN 1 ELSE 0 END) AS specs,
               MAX(profile) AS profile
        FROM events
        WHERE server_ts >= ? AND user_id IS NOT NULL
        GROUP BY events.user_id
        ORDER BY events_n DESC
        LIMIT 30
        """, cutoff_ms,
    )

    # Breakdown by professional role (from the user's account, stamped onto
    # each event at ingest). 'Not set' covers anonymous visitors plus accounts
    # that skipped the optional field — surfaced explicitly so the numbers
    # reconcile against the totals above rather than silently omitting them.
    by_profile = q(
        """
        SELECT COALESCE(profile, '—') AS p,
               COUNT(DISTINCT COALESCE(user_id, anon_id)) AS users,
               COUNT(*) AS events,
               SUM(CASE WHEN event_name='download_clicked' THEN 1 ELSE 0 END) AS downloads,
               SUM(CASE WHEN event_name='save_clicked' THEN 1 ELSE 0 END) AS saves
        FROM events WHERE server_ts >= ?
        GROUP BY p ORDER BY users DESC
        """, cutoff_ms,
    )

    # Separately, anonymous traffic (anon_ids with no login during the
    # window). Usually small/empty given login is required — but worth
    # surfacing so we notice if something's leaking through.
    anon_users = q(
        """
        SELECT anon_id,
               COUNT(*) AS events_n,
               COUNT(DISTINCT session_id) AS sessions,
               MIN(server_ts) AS first_seen,
               MAX(server_ts) AS last_seen
        FROM events
        WHERE server_ts >= ?
          AND anon_id NOT IN (SELECT DISTINCT anon_id FROM events
                               WHERE user_id IS NOT NULL AND server_ts >= ?)
        GROUP BY anon_id
        ORDER BY events_n DESC
        LIMIT 20
        """, cutoff_ms, cutoff_ms,
    )

    # Pre-format for the template.
    # SQL's GROUP BY only emits rows for days that actually have events, which
    # leaves the chart with gaps and a misleading "empty" look when most days
    # have no traffic. Fill in the full N-day window (in IST, matching the
    # bucket key the SQL produces) so every day shows on the x-axis — busy
    # days get tall bars, quiet days get empty bars but still anchor the date.
    today_ist = datetime.now(IST).date()
    # In all-time mode `days` is 0, so derive the span from the oldest event.
    # The bar chart is capped at CHART_MAX_BARS: beyond that the bars are too
    # thin to read (and the span grows forever as the store fills up), so we
    # show the most recent N days and say so in the heading. Every OTHER
    # all-time section remains genuinely unbounded — only this chart is capped.
    CHART_MAX_BARS = 90
    chart_truncated = False
    if all_time:
        first_ms = q("SELECT MIN(server_ts) FROM events")[0][0]
        if first_ms:
            first_date = datetime.fromtimestamp(first_ms / 1000, tz=IST).date()
            span = (today_ist - first_date).days + 1
        else:
            span = 1
        chart_days = max(1, min(span, CHART_MAX_BARS))
        chart_truncated = span > CHART_MAX_BARS
    else:
        chart_days = days
    all_days_iso = [(today_ist - timedelta(days=i)).isoformat()
                    for i in range(chart_days - 1, -1, -1)]
    events_by_day = {r[0]: (r[1], r[2]) for r in daily}
    daily_full = [(d, *events_by_day.get(d, (0, 0))) for d in all_days_iso]

    # Compute bar fill heights in pixels rather than percentages — percentages
    # don't resolve against an indirect-height ancestor and were collapsing
    # every bar to its min-height. Show the actual event count above each bar
    # so very small bars (low-traffic days) remain readable.
    CHART_FILL_MAX_PX = 120  # max bar height in px; leaves room for label + day
    max_day_events = max((r[1] for r in daily_full), default=1) or 1

    def _bar_html(d, n_events, n_users):
        if n_events <= 0:
            fill_h = 0
        else:
            fill_h = max(2, round((n_events / max_day_events) * CHART_FILL_MAX_PX))
        count_label = f'{n_events}' if n_events > 0 else ''
        return (
            f'<div class="bar" title="{d}: {n_events} events, {n_users} users">'
            f'<div class="count">{count_label}</div>'
            f'<div class="fill" style="height:{fill_h}px"></div>'
            f'<div class="day">{d[5:]}</div></div>'
        )

    daily_bars = "".join(_bar_html(r[0], r[1], r[2]) for r in daily_full)

    # Profile slug → human label. Slugs are what the sign-up form submits and
    # what the DB / exports store; the dashboard shows the friendly name.
    PROFILE_LABELS = {
        "architect": "Architect",
        "interior_designer": "Interior Designer",
        "pmc": "Project Management Consultant",
        "acoustic_consultant": "Acoustic Consultant",
        "other": "Other",
        "—": "Not set / anonymous",
    }
    profile_rows = "".join(
        f"<tr><td>{_h(PROFILE_LABELS.get(p, p))}</td><td class=num>{u:,}</td>"
        f"<td class=num>{e:,}</td><td class=num>{d:,}</td><td class=num>{s:,}</td></tr>"
        for p, u, e, d, s in by_profile
    )

    # Range picker — each link preserves the admin key and swaps only `days`.
    # days=0 is the all-time view. The active range gets the `on` class.
    _RANGES = [(7, "7 days"), (14, "14 days"), (30, "30 days"), (90, "90 days"), (0, "All time")]
    range_links = "".join(
        '<a href="?key={k}&days={d}" class="range{on}">{label}</a>'.format(
            k=key, d=d, label=label,
            on=" on" if (all_time if d == 0 else (not all_time and days == d)) else "",
        )
        for d, label in _RANGES
    )
    top_rows = "".join(f"<tr><td>{name}</td><td class=num>{n}</td></tr>" for name, n in top_events)
    # In the latest-events table, prefer linking by user_id (canonical) when
    # we know the user, fall back to anon link otherwise.
    def _link_user(uid):  return f'<a href="?key={key}&user={uid}" class="user">{uid[:8]}…</a>'
    def _link_anon(aid):  return f'<a href="?key={key}&anon={aid}" class="user">{aid[:8]}…</a>'
    def _fmt_when(ms):
        # Render in IST so the dashboard times match local clocks.
        return datetime.fromtimestamp(ms / 1000, tz=IST).strftime('%Y-%m-%d %H:%M')
    def _props_cell(props, name, ts):
        # Empty / null properties → just a dash, no click target.
        if not props:
            return "<td><span class=anon>—</span></td>"
        # Full payload lives in data-props (HTML-attribute-escaped). The
        # cell's text node is the same payload, also escaped; CSS clips it
        # to a single line. Click handler at the bottom of the page reads
        # data-props, JSON.parses it, pretty-prints into a modal.
        ts_str = datetime.fromtimestamp(ts / 1000, tz=IST).strftime('%Y-%m-%d %H:%M:%S')
        return (
            f'<td class=props-trunc'
            f' data-props="{_h(props, quote=True)}"'
            f' data-event="{_h(name, quote=True)}"'
            f' data-time="{_h(ts_str, quote=True)}"'
            f' title="Click to view full payload">'
            f'{_h(props)}'
            f'</td>'
        )

    recent_rows = "".join(
        f"<tr>"
        f"<td class=ts>{datetime.fromtimestamp(ts / 1000, tz=IST).strftime('%Y-%m-%d %H:%M:%S')}</td>"
        f"<td>{name}</td>"
        f"<td class=mono>{_link_user(uid) if uid else _link_anon(anon)}</td>"
        # Email column — resolved from the most recent user_identified event
        # for this user_id (NULL when the event isn't tied to a logged-in user).
        f"<td>{email or '<span class=anon>—</span>'}</td>"
        f"<td class=mono>{sid[:8]}…</td>"
        f"{_props_cell(props, name, ts)}"
        f"</tr>"
        for ts, name, anon, sid, uid, props, email in recent
    )
    # Top logged-in users table — keyed by user_id, shows email + time spent.
    user_rows = "".join(
        f"<tr>"
        f"<td class=mono>{_link_user(uid)}</td>"
        f"<td>{email or '<span class=anon>(no email)</span>'}</td>"
        f"<td>{_h(PROFILE_LABELS.get(prof, prof)) if prof else '<span class=anon>—</span>'}</td>"
        f"<td class=num>{evt:,}</td>"
        f"<td class=num>{sess:,}</td>"
        f"<td class=num>{dev:,}</td>"
        f"<td class=num>{dl}</td>"
        f"<td class=num>{sv}</td>"
        f"<td class=num>{sp}</td>"
        f"<td class=num>{_fmt_duration(user_active_ms.get(uid, 0))}</td>"
        f"<td class=ts>{_fmt_when(first)}</td>"
        f"<td class=ts>{_fmt_when(last)}</td>"
        f"</tr>"
        for uid, email, evt, sess, dev, first, last, dl, sv, sp, prof in top_users
    )
    # Anonymous-traffic table (no login during window).
    anon_rows = "".join(
        f"<tr>"
        f"<td class=mono>{_link_anon(aid)}</td>"
        f"<td class=num>{evt:,}</td>"
        f"<td class=num>{sess:,}</td>"
        f"<td class=ts>{_fmt_when(first)}</td>"
        f"<td class=ts>{_fmt_when(last)}</td>"
        f"</tr>"
        for aid, evt, sess, first, last in anon_users
    )

    def card(label, value):
        return f'<div class="card"><div class="lbl">{label}</div><div class="val">{value:,}</div></div>'

    # Variant for non-numeric (duration) cards so we don't try to comma-
    # format a string like "2:14:08".
    def card_raw(label, value):
        return f'<div class="card"><div class="lbl">{label}</div><div class="val">{value}</div></div>'

    html = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>UV Analytics</title>
<style>
  *{{box-sizing:border-box}}
  body{{font:14px -apple-system,Segoe UI,Inter,sans-serif;margin:0;background:#f7f8fa;color:#1f2937}}
  header{{padding:18px 24px;background:#fff;border-bottom:1px solid #cbd5e1;display:flex;justify-content:space-between;align-items:baseline;flex-wrap:wrap;gap:12px}}
  header h1{{margin:0;font-size:18px;font-weight:600}}
  header .meta{{font-size:12px;color:#6b7280}}
  .wrap{{padding:0;max-width:none;margin:0}}
  /* Sticky side TOC — visible on wider screens, hidden on mobile so it
     doesn't crowd the data tables. Smooth-scrolls to each section. */
  nav.toc{{position:sticky;top:0;z-index:10;display:flex;flex-wrap:wrap;align-items:stretch;background:#fff;border-bottom:1px solid #cbd5e1;font-size:12.5px}}
  nav.toc .lbl{{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:#9ca3af;display:flex;align-items:center;padding:0 14px;border-right:1px solid #e5e7eb}}
  nav.toc a{{display:flex;align-items:center;padding:9px 14px;color:#4b5563;text-decoration:none;border-right:1px solid #e5e7eb;line-height:1;border-bottom:2px solid transparent}}
  nav.toc a:hover{{background:#f1f5f9;color:#0f172a;border-bottom-color:#4f46e5}}
  html{{scroll-behavior:smooth}}
  section{{scroll-margin-top:24px}}
  .cards{{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:1px;margin:0;background:#cbd5e1;border-bottom:1px solid #cbd5e1}}
  .card{{background:#fff;border:0;border-radius:0;padding:16px 18px}}
  .card .lbl{{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280}}
  .card .val{{font-size:22px;font-weight:600;margin-top:4px;color:#0f172a}}
  section{{background:#fff;border:0;border-bottom:1px solid #cbd5e1;border-radius:0;padding:18px;margin:0}}
  section h2{{margin:0 0 12px 0;font-size:14px;font-weight:600;color:#0f172a}}
  table{{width:100%;border-collapse:collapse;font-size:13px}}
  /* `table.fixed` opts a table into table-layout:fixed so that per-column
     widths set via <th style="width:...">  actually pin the layout (in
     auto mode the browser stretches columns to content, which is what was
     making the Latest-events table overflow once we added the Email
     column). The Properties cell then wraps to multiple lines. */
  table.fixed{{table-layout:fixed}}
  /* Tables can exceed the section card's width once you have many columns
     (Top users now has 11 columns); wrap the <table> in a div.table-scroll
     and the overflow appears as a horizontal scrollbar inside the section
     instead of pushing the page wider. The negative-margin + matching
     padding trick keeps the scrollable region flush with the table without
     also widening the visible card. */
  .table-scroll{{overflow-x:auto;margin:0 -18px;padding:0 18px;-webkit-overflow-scrolling:touch}}
  th,td{{padding:7px 10px;border-bottom:1px solid #f1f5f9;text-align:left;vertical-align:top}}
  th{{font-weight:500;color:#6b7280;font-size:11px;text-transform:uppercase;letter-spacing:.05em;background:#fafafa}}
  td.num{{text-align:right;font-variant-numeric:tabular-nums;font-weight:500}}
  /* Headers of numeric columns must right-align with their values — without
     this the `th,td{{text-align:left}}` rule above left-aligns the header while
     td.num right-aligns the number, so on a wide table the two drift to
     opposite ends of the column and the figures look like they belong to the
     neighbouring column. */
  th.num{{text-align:right}}
  td.ts{{white-space:nowrap;color:#6b7280;font-variant-numeric:tabular-nums}}
  td.mono{{font-family:ui-monospace,Menlo,Consolas,monospace;color:#6b7280;font-size:12px;overflow:hidden;text-overflow:ellipsis}}
  /* Properties cell: truncated to one line.  Click opens a modal with the
     full pretty-printed JSON.  Full payload is stashed in the cell's
     data-props attribute (HTML-escaped on the server side). */
  td.props-trunc{{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:11px;color:#374151;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;border-bottom:1px dotted transparent}}
  td.props-trunc:hover{{background:#f1f5f9;border-bottom-color:#94a3b8}}
  /* ── Properties modal ─────────────────────────────────────────────── */
  .modal-overlay{{position:fixed;inset:0;background:rgba(15,23,42,0.5);display:none;align-items:center;justify-content:center;z-index:1000;padding:24px}}
  .modal-overlay.open{{display:flex}}
  .modal-box{{background:#fff;border-radius:0;width:min(720px,100%);max-height:80vh;display:flex;flex-direction:column;border:1px solid #0f172a;box-shadow:none;overflow:hidden}}
  .modal-head{{display:flex;justify-content:space-between;align-items:center;padding:14px 18px;border-bottom:1px solid #e5e7eb;gap:12px}}
  .modal-title{{font-size:13px;font-weight:600;color:#0f172a;line-height:1.4;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}}
  .modal-x{{background:none;border:0;font-size:22px;line-height:1;color:#94a3b8;cursor:pointer;padding:0 6px}}
  .modal-x:hover{{color:#0f172a}}
  .modal-body{{flex:1;margin:0;padding:14px 18px;overflow:auto;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;line-height:1.55;color:#1f2937;white-space:pre-wrap;word-break:break-word;background:#fafafa}}
  .modal-foot{{padding:10px 18px;border-top:1px solid #e5e7eb;display:flex;justify-content:flex-end;gap:8px;background:#fff}}
  .modal-btn{{background:#4338ca;color:#fff;border:0;padding:6px 14px;border-radius:0;font-size:12px;font-weight:500;cursor:pointer}}
  .modal-btn:hover{{background:#3730a3}}
  .modal-btn.copied{{background:#16a34a}}
  a.user{{color:#4338ca;text-decoration:none;font-weight:500}}
  a.user:hover{{text-decoration:underline}}
  details.legend summary{{cursor:pointer;font-size:13px;font-weight:600;color:#0f172a;list-style:none;padding:4px 0;user-select:none}}
  details.legend summary::-webkit-details-marker{{display:none}}
  details.legend summary::before{{content:"\\25B6";display:inline-block;margin-right:8px;font-size:9px;color:#6b7280;transition:transform .15s}}
  details.legend[open] summary::before{{transform:rotate(90deg)}}
  details.legend td code{{background:#f1f5f9;padding:1px 6px;border-radius:0;font-size:12px;color:#0f172a}}
  details.legend td{{vertical-align:top}}
  .userid{{display:inline-block;padding:1px 6px;background:#dcfce7;color:#166534;border-radius:0;font-size:10px}}
  .anon{{display:inline-block;padding:1px 6px;background:#f3f4f6;color:#6b7280;border-radius:0;font-size:10px}}
  .chart{{display:flex;align-items:flex-end;gap:6px;height:180px;border-bottom:1px solid #e5e7eb;padding-bottom:8px}}
  .bar{{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;min-width:0;height:100%}}
  .bar .count{{font-size:10px;color:#6b7280;margin-bottom:3px;font-variant-numeric:tabular-nums;line-height:1;min-height:11px}}
  .bar .fill{{width:100%;background:linear-gradient(180deg,#6366f1 0%,#818cf8 100%);border-radius:0}}
  .bar .day{{font-size:10px;color:#9ca3af;margin-top:6px;font-variant-numeric:tabular-nums}}
  .row2{{display:grid;grid-template-columns:1fr 1fr;gap:1px;margin:0;background:#cbd5e1;border-bottom:1px solid #cbd5e1}}
  .row2>section{{border-bottom:0}}
  @media (max-width: 760px){{.row2{{grid-template-columns:1fr}}}}
  .ranges{{margin-top:10px;display:flex;gap:6px;flex-wrap:wrap;align-items:center}}
  .ranges .rlbl{{font-size:12px;color:#94a3b8;margin-right:2px}}
  a.range{{display:inline-block;padding:5px 14px;border-radius:0;font-size:12px;
    text-decoration:none;background:#f1f5f9;color:#334155;border:1px solid #cbd5e1}}
  a.range:hover{{background:#e2e8f0}}
  a.range.on{{background:#4f46e5;color:#fff;border-color:#4f46e5;font-weight:600}}
  a.dl{{display:inline-block;padding:5px 14px;border-radius:0;font-size:12px;
    text-decoration:none;background:#065f46;color:#fff;border:1px solid #065f46;font-weight:600}}
  a.dl:hover{{background:#047857;border-color:#047857}}
  a.dl.alt{{background:#fff;color:#065f46}}
  a.dl.alt:hover{{background:#ecfdf5}}
</style></head>
<body>
<header>
  <h1>UniVicoustic — Analytics</h1>
  <div class="meta">Window: {win} &nbsp;·&nbsp; All-time totals shown in top row</div>
  <div class="ranges"><span class="rlbl">Range:</span>{range_links}</div>
  <div class="ranges">
    <span class="rlbl">Download:</span>
    <a class="dl" href="/api/admin/analytics/download.xlsx?key={key}&amp;days={0 if all_time else days}">⬇ Excel — {win}</a>
    <a class="dl alt" href="/api/admin/analytics/download.xlsx?key={key}&amp;days=0">⬇ Excel — all time</a>
    <span class="rlbl">multi-sheet .xlsx · full rows (not truncated)</span>
  </div>
</header>

<nav class="toc" aria-label="On-page navigation">
  <div class="lbl">Jump to</div>
  <a href="#overview">Overview cards</a>
  <a href="#daily">Daily activity</a>
  <a href="#events">Top events</a>
  <a href="#funnel">Outcome funnel</a>
  <a href="#profiles">Profiles</a>
  <a href="#users">Logged-in users</a>
  <a href="#anon">Anonymous traffic</a>
  <a href="#latest">Latest 50 events</a>
  <a href="#glossary">Event glossary</a>
</nav>

<div class="wrap">

  <div id="overview" class="cards">
    {card("Events (all-time)", total_events)}
    {card("Users (all-time)", total_users)}
    {card("Sessions (all-time)", total_sessions)}
    {card(f"Events ({win_short})", window_events)}
    {card(f"Users ({win_short})", window_users)}
    {card_raw(f"Time on configurator ({win_short})", _fmt_duration(total_active_ms))}
    {card("Save clicks", outcomes.get("save_clicked", 0))}
    {card("Downloads", outcomes.get("download_clicked", 0))}
    {card("Tech-specs views", outcomes.get("tech_specs_viewed", 0))}
  </div>

  <section id="daily">
    <h2>Daily activity ({'last ' + str(chart_days) + ' days (most recent — chart is capped)' if chart_truncated else win})</h2>
    <div class="chart">{daily_bars or '<em style="color:#9ca3af">No data in window</em>'}</div>
  </section>

  <div class="row2">
    <section id="events">
      <h2>Top events ({win})</h2>
      <table>
        <thead><tr><th>Event</th><th class=num>Count</th></tr></thead>
        <tbody>{top_rows or '<tr><td colspan=2><em>No events</em></td></tr>'}</tbody>
      </table>
    </section>
    <section id="funnel">
      <h2>Outcome funnel (unique users)</h2>
      <table>
        <thead><tr><th>Outcome</th><th class=num>Users</th></tr></thead>
        <tbody>
          <tr><td>Tech-specs viewed</td><td class=num>{outcomes.get('tech_specs_viewed', 0):,}</td></tr>
          <tr><td>Save clicked</td><td class=num>{outcomes.get('save_clicked', 0):,}</td></tr>
          <tr><td>Downloaded</td><td class=num>{outcomes.get('download_clicked', 0):,}</td></tr>
        </tbody>
      </table>
    </section>
  </div>

  <section id="profiles">
    <h2>By profile ({win}) &mdash; professional role chosen at sign-up</h2>
    <table>
      <thead><tr>
        <th>Profile</th>
        <th class=num style="width:120px">Users</th><th class=num style="width:120px">Events</th>
        <th class=num style="width:120px">Downloads</th><th class=num style="width:120px">Saves</th>
      </tr></thead>
      <tbody>{profile_rows or '<tr><td colspan=5><em>No data in window</em></td></tr>'}</tbody>
    </table>
  </section>

  <section id="users">
    <h2>Top logged-in users ({win}) &mdash; click an ID to see their journey</h2>
    <div class="table-scroll">
    <table>
      <thead><tr>
        <th>User ID</th><th>Email</th><th>Profile</th>
        <th class=num>Events</th><th class=num>Sessions</th><th class=num>Devices</th>
        <th class=num>Downloads</th><th class=num>Saves</th><th class=num>Specs</th>
        <th class=num>Time spent</th>
        <th>First seen (IST)</th><th>Last seen (IST)</th>
      </tr></thead>
      <tbody>{user_rows or '<tr><td colspan=12><em>No logged-in users in window</em></td></tr>'}</tbody>
    </table>
    </div>
  </section>

  <section id="anon">
    <h2>Anonymous traffic ({win}) &mdash; visitors who never logged in</h2>
    <div class="table-scroll">
    <table>
      <thead><tr>
        <th>Anon ID</th>
        <th class=num>Events</th><th class=num>Sessions</th>
        <th>First seen (IST)</th><th>Last seen (IST)</th>
      </tr></thead>
      <tbody>{anon_rows or '<tr><td colspan=5><em>No anonymous traffic in window (good — everyone logged in)</em></td></tr>'}</tbody>
    </table>
    </div>
  </section>

  <section id="latest">
    <h2>Latest 50 events</h2>
    <div class="table-scroll">
    <table class="fixed">
      <thead><tr>
        <th style="width:155px">Time (IST)</th>
        <th style="width:170px">Event</th>
        <th style="width:85px">User/Anon</th>
        <th style="width:220px">Email</th>
        <th style="width:90px">Session</th>
        <th>Properties</th>
      </tr></thead>
      <tbody>{recent_rows or '<tr><td colspan=6><em>No events</em></td></tr>'}</tbody>
    </table>
    </div>
  </section>

  <section id="glossary">
    <details class="legend" open>
      <summary>Event glossary &mdash; what each event name means</summary>
      <table style="margin-top:12px">
        <thead><tr><th style="width:230px">Event</th><th>What it means</th></tr></thead>
        <tbody>
          <tr><td><code>configurator_loaded</code></td><td>The configurator page mounted in a user's browser (first paint).</td></tr>
          <tr><td><code>user_registered</code></td><td>New account created via email-OTP signup.</td></tr>
          <tr><td><code>user_logged_in</code></td><td>Existing user signed in.</td></tr>
          <tr><td><code>user_logged_out</code></td><td>User clicked Log out.</td></tr>
          <tr><td><code>user_identified</code></td><td>Frontend tied an anon_id to a known user_id + email (fires once after login or app boot with cached session). Used by the dashboard to display emails.</td></tr>
          <tr><td><code>series_changed</code></td><td>User switched to a different product series (e.g. Bespoke Graphics &rarr; Fabrics).</td></tr>
          <tr><td><code>category_changed</code></td><td>User picked a different category within the current series (e.g. Designer Textile &rarr; Color Core).</td></tr>
          <tr><td><code>product_type_selected</code></td><td>Surface type changed (flat / embossed / grooving). Properties include <code>from</code> and <code>to</code>.</td></tr>
          <tr><td><code>emboss_pattern_selected</code></td><td>User selected an emboss pattern (Ribbed 25, Aqualine, Penray, etc.).</td></tr>
          <tr><td><code>studio_lighting_toggled</code></td><td>User changed the HDRI studio lighting mode (Off / Warm / Soft).</td></tr>
          <tr><td><code>category_dwell</code></td><td>How long the user spent on a category before moving on. Properties include <code>dwell_ms</code>.</td></tr>
          <tr><td><code>preview_rendered</code></td><td>The user has filled every required field — the live preview is now fully showing their configuration. Often the closest signal to "intent to use the result."</td></tr>
          <tr><td><code>save_clicked</code></td><td>User clicked the Save button. Properties include <code>result: "saved"</code> or <code>"no_design"</code>.</td></tr>
          <tr><td><code>download_clicked</code></td><td>User clicked the Download button (PNG/PDF of the configuration). The strongest outcome signal.</td></tr>
          <tr><td><code>tech_specs_viewed</code></td><td>User opened the Tech Specs panel (acoustic / fire rating / certifications).</td></tr>
          <tr><td><code>reset_clicked</code></td><td>User clicked Reset to clear the configurator.</td></tr>
          <tr><td><code>configuration_abandoned</code></td><td>User left the page (close tab / navigate away) before completing or downloading. <code>config_complete</code> property tells you whether they had all fields filled.</td></tr>
        </tbody>
      </table>
      <p style="margin-top:14px;font-size:12px;color:#6b7280;line-height:1.5">
        <strong>How to read it:</strong> Every event row in the database carries the user's full configuration snapshot
        (<code>product_type</code>, <code>category</code>, <code>size</code>, <code>thickness</code>, <code>emboss</code>) in its <code>properties</code> JSON.
        Per-user pages expand this into the &ldquo;Configurations tried&rdquo; table.
        Server-side timestamps (<code>server_ts</code>, ms epoch UTC) are authoritative; client timestamps may drift.
      </p>
    </details>
  </section>
</div>

<!-- ── Properties modal ──
     One modal lives at the page level.  Click handler is delegated from
     document, so any cell with class="props-trunc" anywhere on the page
     opens it.  Closes on X, overlay click, or Escape. -->
<div id="props-modal" class="modal-overlay" aria-hidden="true" role="dialog">
  <div class="modal-box">
    <div class="modal-head">
      <div id="props-modal-title" class="modal-title"></div>
      <button class="modal-x" data-modal-close aria-label="Close">&times;</button>
    </div>
    <pre id="props-modal-body" class="modal-body"></pre>
    <div class="modal-foot">
      <button class="modal-btn" id="props-modal-copy">Copy JSON</button>
    </div>
  </div>
</div>

<script>
(function(){{
  var modal = document.getElementById('props-modal');
  var titleEl = document.getElementById('props-modal-title');
  var bodyEl = document.getElementById('props-modal-body');
  var copyBtn = document.getElementById('props-modal-copy');

  function openModal(props, eventName, eventTime){{
    var pretty = props;
    try {{ pretty = JSON.stringify(JSON.parse(props), null, 2); }} catch (e) {{}}
    titleEl.textContent = eventName + '  ·  ' + eventTime;
    bodyEl.textContent = pretty;
    copyBtn.textContent = 'Copy JSON';
    copyBtn.classList.remove('copied');
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
  }}
  function closeModal(){{
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }}

  // Delegated click: any .props-trunc cell anywhere on the page.
  document.addEventListener('click', function(e){{
    var cell = e.target.closest('.props-trunc');
    if (cell) {{
      openModal(cell.dataset.props || '', cell.dataset.event || '', cell.dataset.time || '');
      return;
    }}
    if (e.target.matches('[data-modal-close]') || e.target === modal) {{
      closeModal();
    }}
  }});
  document.addEventListener('keydown', function(e){{
    if (e.key === 'Escape' && modal.classList.contains('open')) closeModal();
  }});
  copyBtn.addEventListener('click', function(){{
    var text = bodyEl.textContent;
    if (!navigator.clipboard) return;
    navigator.clipboard.writeText(text).then(function(){{
      copyBtn.textContent = 'Copied';
      copyBtn.classList.add('copied');
      setTimeout(function(){{
        copyBtn.textContent = 'Copy JSON';
        copyBtn.classList.remove('copied');
      }}, 1500);
    }});
  }});
}})();
</script>
</body></html>"""
    return html


# ── Analytics Excel export: GET /api/admin/analytics/download.xlsx?key=… ─────
# Multi-sheet .xlsx of everything the dashboard shows, for offline analysis.
# Same ADMIN_TOKEN gate and same `days` window semantics as the dashboard
# (days=0 → all time), so the button can hand over whatever range is on screen.
#
# Deliberate difference from the dashboard: the HTML page truncates its tables
# (top 25 events / 30 users / 20 anon) to stay readable. The spreadsheet does
# NOT — it carries every row, since exporting a truncated list is the one thing
# that would make the download useless for analysis.
#
# Sheets: Summary · Daily activity · Top events · Users · Anonymous · All events
@api_router.get("/admin/analytics/download.xlsx")
async def admin_analytics_xlsx(key: str = "", days: int = 14):
    admin_token = os.environ.get("ADMIN_TOKEN", "")
    if not admin_token:
        raise HTTPException(status_code=404, detail="Not found")
    if key != admin_token:
        raise HTTPException(status_code=401, detail="Bad key")

    try:
        import io
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill, Alignment
        from openpyxl.utils import get_column_letter
        from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE
    except ImportError:
        # openpyxl missing on this box — fail loudly but without 500-ing the app.
        raise HTTPException(status_code=503,
                            detail="Excel export unavailable (openpyxl not installed).")

    try:
        days = int(days)
    except (TypeError, ValueError):
        days = 14
    all_time = days <= 0
    days = 0 if all_time else min(days, 365)
    cutoff_ms = 0 if all_time else int((time.time() - days * 86400) * 1000)
    win = "all time" if all_time else f"last {days} days"

    conn = analytics_db.get_conn()
    IST = timezone(timedelta(hours=5, minutes=30))

    def q(sql, *params):
        return conn.execute(sql, params).fetchall()

    def ist(ms):
        if not ms:
            return ""
        return datetime.fromtimestamp(ms / 1000, tz=IST).strftime("%Y-%m-%d %H:%M:%S")

    # Excel rejects control characters and caps a cell at 32,767 chars.
    def clean(v):
        if isinstance(v, str):
            v = ILLEGAL_CHARACTERS_RE.sub("", v)
            if len(v) > 32000:
                v = v[:32000] + "…[truncated]"
        return v

    wb = Workbook()
    HEAD_FILL = PatternFill("solid", fgColor="4F46E5")
    HEAD_FONT = Font(color="FFFFFF", bold=True)

    def add_sheet(title, headers, rows, widths=None, first=False):
        ws = wb.active if first else wb.create_sheet()
        ws.title = title
        ws.append(headers)
        for c in range(1, len(headers) + 1):
            cell = ws.cell(row=1, column=c)
            cell.fill = HEAD_FILL
            cell.font = HEAD_FONT
            cell.alignment = Alignment(vertical="center")
        for r in rows:
            ws.append([clean(v) for v in r])
        ws.freeze_panes = "A2"                      # keep headers visible
        if rows:
            ws.auto_filter.ref = (
                f"A1:{get_column_letter(len(headers))}{len(rows) + 1}"
            )
        for i, w in enumerate(widths or [], start=1):
            ws.column_dimensions[get_column_letter(i)].width = w
        return ws

    # ── Sheet 1: Summary ────────────────────────────────────────────────────
    total_events = q("SELECT COUNT(*) FROM events")[0][0]
    total_users = q("SELECT COUNT(DISTINCT anon_id) FROM events")[0][0]
    total_sessions = q("SELECT COUNT(DISTINCT session_id) FROM events")[0][0]
    win_events = q("SELECT COUNT(*) FROM events WHERE server_ts>=?", cutoff_ms)[0][0]
    win_users = q("SELECT COUNT(DISTINCT anon_id) FROM events WHERE server_ts>=?", cutoff_ms)[0][0]
    win_sessions = q("SELECT COUNT(DISTINCT session_id) FROM events WHERE server_ts>=?", cutoff_ms)[0][0]
    outcomes = dict(q(
        "SELECT event_name, COUNT(DISTINCT anon_id) FROM events "
        "WHERE event_name IN ('save_clicked','download_clicked','tech_specs_viewed') "
        "AND server_ts>=? GROUP BY event_name", cutoff_ms))
    first_ms = q("SELECT MIN(server_ts) FROM events")[0][0]
    last_ms = q("SELECT MAX(server_ts) FROM events")[0][0]

    add_sheet("Summary", ["Metric", "Value"], [
        ("Generated (IST)", ist(int(time.time() * 1000))),
        ("Range", win),
        ("", ""),
        ("Events (all-time)", total_events),
        ("Users (all-time)", total_users),
        ("Sessions (all-time)", total_sessions),
        ("Oldest event (IST)", ist(first_ms)),
        ("Newest event (IST)", ist(last_ms)),
        ("", ""),
        (f"Events ({win})", win_events),
        (f"Users ({win})", win_users),
        (f"Sessions ({win})", win_sessions),
        ("", ""),
        (f"Unique users who saved ({win})", outcomes.get("save_clicked", 0)),
        (f"Unique users who downloaded ({win})", outcomes.get("download_clicked", 0)),
        (f"Unique users who viewed tech specs ({win})", outcomes.get("tech_specs_viewed", 0)),
    ], widths=[42, 26], first=True)

    # ── Sheet 2: Daily activity ─────────────────────────────────────────────
    add_sheet("Daily activity", ["Date (IST)", "Events", "Users", "Sessions"], q(
        "SELECT date(server_ts/1000,'unixepoch','+5 hours','+30 minutes') AS d,"
        " COUNT(*), COUNT(DISTINCT anon_id), COUNT(DISTINCT session_id)"
        " FROM events WHERE server_ts>=? GROUP BY d ORDER BY d ASC", cutoff_ms),
        widths=[14, 10, 10, 10])

    # ── Sheet 3: Top events (ALL event types, not just top 25) ──────────────
    add_sheet("Top events", ["Event", "Count", "Unique users"], q(
        "SELECT event_name, COUNT(*), COUNT(DISTINCT anon_id) FROM events"
        " WHERE server_ts>=? GROUP BY event_name ORDER BY 2 DESC", cutoff_ms),
        widths=[32, 10, 14])

    # ── Sheet 4: Users (ALL logged-in users) ────────────────────────────────
    urows = q("""
        SELECT e.user_id,
               (SELECT json_extract(properties,'$.email') FROM events ui
                 WHERE ui.user_id=e.user_id AND ui.event_name='user_identified'
                 ORDER BY ui.server_ts DESC LIMIT 1) AS email,
               MAX(e.profile) AS profile,
               COUNT(*), COUNT(DISTINCT session_id), COUNT(DISTINCT anon_id),
               SUM(CASE WHEN event_name='download_clicked' THEN 1 ELSE 0 END),
               SUM(CASE WHEN event_name='save_clicked' THEN 1 ELSE 0 END),
               SUM(CASE WHEN event_name='tech_specs_viewed' THEN 1 ELSE 0 END),
               MIN(server_ts), MAX(server_ts)
        FROM events e WHERE server_ts>=? AND user_id IS NOT NULL
        GROUP BY e.user_id ORDER BY 4 DESC""", cutoff_ms)
    add_sheet("Users",
              ["User ID", "Email", "Profile", "Events", "Sessions", "Devices",
               "Downloads", "Saves", "Tech specs", "First seen (IST)", "Last seen (IST)"],
              [(r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], ist(r[9]), ist(r[10])) for r in urows],
              widths=[38, 30, 22, 9, 10, 9, 11, 8, 11, 20, 20])

    # ── Sheet 4b: By profile ────────────────────────────────────────────────
    add_sheet("By profile",
              ["Profile", "Users", "Events", "Downloads", "Saves"],
              q("""
        SELECT COALESCE(profile,'(not set)'),
               COUNT(DISTINCT COALESCE(user_id, anon_id)), COUNT(*),
               SUM(CASE WHEN event_name='download_clicked' THEN 1 ELSE 0 END),
               SUM(CASE WHEN event_name='save_clicked' THEN 1 ELSE 0 END)
        FROM events WHERE server_ts>=? GROUP BY 1 ORDER BY 2 DESC""", cutoff_ms),
              widths=[26, 10, 10, 12, 10])

    # ── Sheet 5: Anonymous traffic (ALL) ────────────────────────────────────
    arows = q("""
        SELECT anon_id, COUNT(*), COUNT(DISTINCT session_id), MIN(server_ts), MAX(server_ts)
        FROM events
        WHERE server_ts>=? AND anon_id NOT IN
              (SELECT DISTINCT anon_id FROM events WHERE user_id IS NOT NULL AND server_ts>=?)
        GROUP BY anon_id ORDER BY 2 DESC""", cutoff_ms, cutoff_ms)
    add_sheet("Anonymous",
              ["Anon ID", "Events", "Sessions", "First seen (IST)", "Last seen (IST)"],
              [(r[0], r[1], r[2], ist(r[3]), ist(r[4])) for r in arows],
              widths=[38, 10, 10, 20, 20])

    # ── Sheet 6: All events (raw) ───────────────────────────────────────────
    # Hard cap so one click can't try to materialise an unbounded table in RAM
    # on a small instance. Disclosed on the Summary sheet when it bites.
    RAW_CAP = 100000
    erows = q("""
        SELECT e.id, e.server_ts, e.event_name, e.user_id,
               (SELECT json_extract(properties,'$.email') FROM events ui
                 WHERE ui.user_id=e.user_id AND ui.event_name='user_identified'
                 ORDER BY ui.server_ts DESC LIMIT 1) AS email,
               e.anon_id, e.session_id, e.profile, e.country, e.region, e.city,
               e.url, e.properties
        FROM events e WHERE e.server_ts>=? ORDER BY e.id DESC LIMIT ?""",
        cutoff_ms, RAW_CAP)
    add_sheet("All events",
              ["ID", "Time (IST)", "Event", "User ID", "Email", "Anon ID", "Session ID",
               "Profile", "Country", "Region", "City", "URL", "Properties (JSON)"],
              [(r[0], ist(r[1]), r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9], r[10], r[11], r[12])
               for r in erows],
              widths=[8, 20, 26, 38, 28, 38, 38, 22, 9, 18, 18, 40, 60])
    if len(erows) >= RAW_CAP:
        wb["Summary"].append(("", ""))
        wb["Summary"].append(
            ("NOTE", f"'All events' capped at {RAW_CAP:,} most recent rows "
                     f"({win_events:,} in range). Narrow the range for the rest."))

    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    stamp = datetime.now(IST).strftime("%Y-%m-%d")
    scope = "all-time" if all_time else f"{days}d"
    fname = f"univicoustic-analytics-{scope}-{stamp}.xlsx"
    return Response(
        content=buf.getvalue(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


# Include the router in the main app
app.include_router(api_router)

# ── Auth router (frontend-only OTP register + email-only login). See auth.py
# for the full description of the flow and security caveats. The router
# carries its own /api/auth prefix so it doesn't double up on api_router's. ──
from auth import router as auth_router  # noqa: E402  (defined after app for clarity)
app.include_router(auth_router)

cors_origins = [
    origin.strip()
    for origin in os.environ.get(
        'CORS_ORIGINS',
        'http://localhost:3000,http://localhost:8000'
    ).split(',')
    if origin.strip()
]
cors_origin_regex = os.environ.get('CORS_ORIGIN_REGEX')

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=cors_origins,
    allow_origin_regex=cors_origin_regex,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Main entry point
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host="0.0.0.0", port=8001, reload=True)
