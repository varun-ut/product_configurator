"""
dump_catalog.py
===============
Dumps the product catalog and tech specs to static JSON files so the
frontend can fetch them directly from S3/CDN — no backend API needed.

Run from the backend/ directory:

    cd backend
    python scripts/dump_catalog.py

Outputs:
    backend/data/products.json     — replaces /api/products
    backend/data/tech-specs.json   — replaces /api/products/{id}/specs

Then upload to S3:

    aws s3 sync backend/data/ s3://univicoustic-assets/data/

Re-run this script (+ re-sync) whenever you add new designs or categories
to server.py.
"""

import sys
import json
import re
from pathlib import Path

# Add backend/ to path so we can import server.py directly
BACKEND_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(BACKEND_DIR))

from server import MOCK_PRODUCTS, TECH_SPECS  # noqa: E402 (import after sys.path)

OUTPUT_DIR = BACKEND_DIR / "data"


def rewrite_thumb_urls(obj):
    """
    Recursively walk the product catalog and rewrite any thumbnail_url
    that points to the old /thumb/ endpoint:

        /thumb/some/path/file.jpg  →  /static/_thumbcache/some/path/file.jpg

    generate_thumbs.py always writes JPEG output regardless of source
    extension, so .png sources end up as .jpg in the thumbcache.
    The extension is normalised to .jpg here to match.
    """
    if isinstance(obj, dict):
        return {k: rewrite_thumb_urls(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [rewrite_thumb_urls(item) for item in obj]
    elif isinstance(obj, str) and obj.startswith("/thumb/"):
        path_without_prefix = obj[len("/thumb/"):]
        # Normalise extension to .jpg (thumbcache always stores JPEG)
        path_jpg = re.sub(r'\.[^.]+$', '.jpg', path_without_prefix)
        return f"/static/_thumbcache/{path_jpg}"
    return obj


def run():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # ── products.json ──────────────────────────────────────────────────────────
    products = rewrite_thumb_urls(MOCK_PRODUCTS)
    products_path = OUTPUT_DIR / "products.json"
    with open(products_path, "w", encoding="utf-8") as f:
        json.dump(products, f, indent=2, ensure_ascii=False)
    total_designs = sum(
        len(cat.get("designs", []))
        for p in products
        for cat in p.get("categories", [])
    )
    print(f"Written: {products_path}")
    print(f"  {len(products)} products, {total_designs} designs total")

    # ── tech-specs.json ────────────────────────────────────────────────────────
    specs_path = OUTPUT_DIR / "tech-specs.json"
    with open(specs_path, "w", encoding="utf-8") as f:
        json.dump(TECH_SPECS, f, indent=2, ensure_ascii=False)
    print(f"Written: {specs_path}")
    print(f"  {len(TECH_SPECS)} product specs")

    print("\nNext step — upload to S3:")
    print("  aws s3 sync backend/data/ s3://univicoustic-assets/data/")


if __name__ == "__main__":
    run()
