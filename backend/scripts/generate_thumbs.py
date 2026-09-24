"""
generate_thumbs.py
==================
Pre-generates all thumbnails that the backend normally produces lazily via
the /thumb/ endpoint.

Run this locally (or in CI) before syncing assets to S3:

    cd backend
    python scripts/generate_thumbs.py

Output layout mirrors the server's _thumbcache/ directory exactly, so the
same relative paths work whether thumbnails are served from EC2 or from S3.

    backend/static/images/fabric/color-core/panels/FB-GY-03_CC-01.jpg
    → backend/static/_thumbcache/fabric/color-core/panels/FB-GY-03_CC-01.jpg

After running this script, upload both images/ and _thumbcache/ to S3:

    aws s3 sync backend/static/ s3://your-assets-bucket/static/ --delete
"""

import sys
from pathlib import Path

try:
    from PIL import Image, ImageOps
except ImportError:
    print("ERROR: Pillow is not installed. Run:  pip install Pillow")
    sys.exit(1)

# Some source assets (e.g. raw emboss masters) are very large. Trust local files
# and disable Pillow's decompression-bomb guard so the script can process them.
Image.MAX_IMAGE_PIXELS = None

# ── Config (must match server.py) ────────────────────────────────────────────

STATIC_DIR   = Path(__file__).parent.parent / "static"
IMAGES_DIR   = STATIC_DIR / "images"
CACHE_DIR    = STATIC_DIR / "_thumbcache"
THUMB_SIZE   = (200, 200)
JPEG_QUALITY = 82

# Image file extensions to process
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tiff", ".gif"}

# ── Helpers ───────────────────────────────────────────────────────────────────

def make_thumbnail(source: Path, dest: Path) -> None:
    """Resize + center-crop source image to THUMB_SIZE, save as JPEG to dest."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    with Image.open(source) as img:
        # Composite transparent images onto white before JPEG save.
        # Without this, transparent areas render black (common for emboss PNGs).
        if img.mode in ("RGBA", "LA", "P"):
            converted = img.convert("RGBA")
            background = Image.new("RGBA", converted.size, (255, 255, 255, 255))
            background.paste(converted, mask=converted.split()[3])
            img = background.convert("RGB")
        else:
            img = img.convert("RGB")

        # Center-crop + resize — mirrors CSS background-size: cover
        thumb = ImageOps.fit(img, THUMB_SIZE, Image.LANCZOS)
        thumb.save(dest, format="JPEG", quality=JPEG_QUALITY, optimize=True)


def run():
    if not IMAGES_DIR.exists():
        print(f"ERROR: images directory not found: {IMAGES_DIR}")
        sys.exit(1)

    all_images = [
        p for p in IMAGES_DIR.rglob("*")
        if p.is_file() and p.suffix.lower() in IMAGE_EXTS
    ]

    if not all_images:
        print("No images found.")
        return

    generated = 0
    skipped   = 0
    errors    = 0

    for source in sorted(all_images):
        # Relative path from images/ e.g. fabric/color-core/panels/FB-GY-03_CC-01.jpg
        rel = source.relative_to(IMAGES_DIR)
        # Output always as .jpg regardless of source extension
        dest = (CACHE_DIR / rel).with_suffix(".jpg")

        if dest.exists():
            skipped += 1
            continue

        try:
            make_thumbnail(source, dest)
            generated += 1
            print(f"  generated  {rel}")
        except Exception as exc:
            errors += 1
            print(f"  ERROR      {rel}  —  {exc}")

    print(
        f"\nDone. Generated: {generated} | Already existed (skipped): {skipped} | Errors: {errors}"
    )
    if errors:
        print("Fix errors above before uploading to S3.")
        sys.exit(1)


if __name__ == "__main__":
    run()
