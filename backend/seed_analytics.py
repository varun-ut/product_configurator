"""
seed_analytics.py
-----------------
One-off script to populate analytics.db with realistic-looking synthetic
events so the admin dashboard has something to show. Safe to run multiple
times — each run adds another batch tagged with run_id in properties.

Run from the backend dir:
    python seed_analytics.py            # adds ~500 events spread over 14 days
    python seed_analytics.py --count 2000  # add more
    python seed_analytics.py --wipe     # delete existing rows first
"""

import argparse
import json
import random
import time
import uuid

import analytics_db

# Realistic event mix — weights roughly match what the configurator emits
# during a normal user session.
EVENT_WEIGHTS = [
    ("configurator_loaded", 10),
    ("series_changed", 30),
    ("category_changed", 25),
    ("emboss_pattern_selected", 18),
    ("studio_lighting_toggled", 8),
    ("category_dwell", 35),
    ("preview_rendered", 12),
    ("save_clicked", 4),
    ("download_clicked", 6),
    ("tech_specs_viewed", 5),
    ("reset_clicked", 3),
    ("configuration_abandoned", 7),
    ("product_type_selected", 12),
    ("user_logged_in", 2),
    ("user_registered", 1),
    ("user_logged_out", 1),
]
WEIGHTED_EVENTS = [name for name, w in EVENT_WEIGHTS for _ in range(w)]

PRODUCT_TYPES = ["flat-embossed-vmd", "ombre", "fabrics", "vicstrip", "wood"]
CATEGORIES = [
    "vmd-marble", "vmd-leather", "vmd-line-and-texture",
    "ombre-color-core-ombre", "signature-ombre",
    "fabrics-designer-textile", "fabrics-color-core",
    "wood-classic-parquet", "wood-perforations",
]
EMBOSS = ["ribbed_25mm", "ribbed_45mm", "tappered", "flux_ribbed", "afterflute", "deck", "triangle"]
SIZES = ["1200x2800", "1200x2400", "600x600", "600x1200"]
THICKNESSES = ["12mm (PET Panel)", "25mm (PET Panel)", "PET Wool"]


def random_properties(event_name: str, snapshot: dict) -> dict:
    """Produce properties similar to what the live track() calls would emit."""
    base = dict(snapshot)
    if event_name == "category_dwell":
        base["dwell_ms"] = random.randint(800, 45_000)
    if event_name == "save_clicked":
        base["result"] = random.choice(["saved", "saved", "saved", "no_design"])
    if event_name == "preview_rendered":
        base["config_complete"] = random.random() > 0.2
    if event_name == "configuration_abandoned":
        base["config_complete"] = random.random() > 0.7
    if event_name == "product_type_selected":
        base["from"] = random.choice(["flat", "embossed", "grooving"])
        base["to"] = random.choice(["flat", "embossed", "grooving"])
    return base


def generate_session(now_ms: int, hours_ago: int):
    """Generate a plausible sequence of events for one anonymous session."""
    session_id = str(uuid.uuid4())
    anon_id = str(uuid.uuid4())
    # 70% of users stay anonymous; 30% are logged-in
    user_id = str(uuid.uuid4()) if random.random() > 0.7 else None
    start_ms = now_ms - (hours_ago * 3600_000) - random.randint(0, 3600_000)

    snapshot = {
        "product_type": random.choice(PRODUCT_TYPES),
        "category": random.choice(CATEGORIES),
        "size": random.choice(SIZES),
        "thickness": random.choice(THICKNESSES),
        "emboss": random.choice(EMBOSS) if random.random() > 0.4 else None,
    }
    session_length = random.randint(6, 28)
    events = []
    ts = start_ms
    # Sessions almost always start with configurator_loaded
    events.append({
        "event_name": "configurator_loaded",
        "anon_id": anon_id, "session_id": session_id, "user_id": user_id,
        "properties": {"run": "seed"},
        "url": "https://app.example.com/configurator",
        "client_ts": ts,
    })
    for _ in range(session_length):
        ts += random.randint(800, 18_000)
        name = random.choice(WEIGHTED_EVENTS)
        events.append({
            "event_name": name,
            "anon_id": anon_id, "session_id": session_id, "user_id": user_id,
            "properties": random_properties(name, snapshot),
            "url": "https://app.example.com/configurator",
            "client_ts": ts,
        })
    return events


def seed(count: int, wipe: bool):
    if wipe:
        with analytics_db._lock:
            conn = analytics_db.get_conn()
            conn.execute("DELETE FROM events")
        print("Wiped existing events.")

    now_ms = int(time.time() * 1000)
    all_rows = []
    sessions = max(1, count // 18)
    for _ in range(sessions):
        hours_ago = random.randint(0, 14 * 24)  # spread over 14 days
        all_rows.extend(generate_session(now_ms, hours_ago))
        if len(all_rows) >= count:
            break
    all_rows = all_rows[:count]
    # Insert in chunks of 100 (the MAX_BATCH limit).
    inserted = 0
    for i in range(0, len(all_rows), 100):
        inserted += analytics_db.insert_events(all_rows[i:i + 100])
    print(f"Seeded {inserted} events across ~{sessions} sessions.")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--count", type=int, default=500, help="approximate event count to add")
    ap.add_argument("--wipe", action="store_true", help="delete existing events first")
    args = ap.parse_args()
    seed(args.count, args.wipe)
