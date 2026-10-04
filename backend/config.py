"""
Emboss Configuration
====================
Per-image / per-panel emboss parameter presets.

Each key is a label you choose (e.g. image name, panel category, any ID).
Each value is a dict with the parameters accepted by generate_emboss_layer():

    depth            – float  – intensity multiplier (>1 stronger, <1 subtler)
    bevel_width      – int    – shadow/highlight spread in pixels
    shadow_opacity   – float  – peak shadow darkness (0–1)
    highlight_opacity– float  – peak highlight brightness (0–1)
    debossed         – bool   – False = raised (emboss), True = carved (deboss)

Usage in emboss_layer.py:
    from config import EMBOSS_CONFIGS
    cfg = EMBOSS_CONFIGS["diamond_strong"]
    layer = generate_emboss_layer("diamond.png", **cfg)
"""

# ── Default fallback (used when no specific config is specified) ──────────────

DEFAULT = {
    "depth": 2.0,
    "bevel_width": 30,
    "shadow_opacity": 0.95,
    "highlight_opacity": 0.35,
    "debossed": False,
}

# ── Per-image / per-panel configurations ──────────────────────────────────────
# Add, remove, or tweak entries as needed.
# The key is just a label — use whatever naming makes sense for your workflow.

EMBOSS_CONFIGS = {

    # ── Diamond pattern variations ────────────────────────────────────────
    "diamond_default": {
        "depth": 2.0,
        "bevel_width": 30,
        "shadow_opacity": 0.95,
        "highlight_opacity": 0.35,
        "debossed": False,
    },
    "diamond_subtle": {
        "depth": 0.8,
        "bevel_width": 15,
        "shadow_opacity": 0.5,
        "highlight_opacity": 0.2,
        "debossed": False,
    },
    "diamond_strong": {
        "depth": 3.5,
        "bevel_width": 40,
        "shadow_opacity": 1.0,
        "highlight_opacity": 0.5,
        "debossed": False,
    },
    "diamond_debossed": {
        "depth": 2.0,
        "bevel_width": 30,
        "shadow_opacity": 0.9,
        "highlight_opacity": 0.3,
        "debossed": True,
    },

    # ── Per-category panel presets ────────────────────────────────────────
    # Tune these per panel category so each wall scene gets its own look.

    "line_and_texture": {
        "depth": 1.5,
        "bevel_width": 20,
        "shadow_opacity": 0.8,
        "highlight_opacity": 0.3,
        "debossed": False,
    },
    "rhythm_and_repeat": {
        "depth": 2.0,
        "bevel_width": 25,
        "shadow_opacity": 0.9,
        "highlight_opacity": 0.35,
        "debossed": False,
    },
    "quiet_bloom": {
        "depth": 1.2,
        "bevel_width": 18,
        "shadow_opacity": 0.6,
        "highlight_opacity": 0.25,
        "debossed": False,
    },
    "fun_and_fantasy": {
        "depth": 2.5,
        "bevel_width": 35,
        "shadow_opacity": 0.95,
        "highlight_opacity": 0.4,
        "debossed": False,
    },
    "indian_modern": {
        "depth": 1.8,
        "bevel_width": 22,
        "shadow_opacity": 0.85,
        "highlight_opacity": 0.3,
        "debossed": False,
    },
    "color_block": {
        "depth": 1.0,
        "bevel_width": 12,
        "shadow_opacity": 0.5,
        "highlight_opacity": 0.2,
        "debossed": False,
    },
    "marble": {
        "depth": 1.3,
        "bevel_width": 20,
        "shadow_opacity": 0.7,
        "highlight_opacity": 0.25,
        "debossed": False,
    },
    "luxury_textures": {
        "depth": 2.2,
        "bevel_width": 28,
        "shadow_opacity": 0.9,
        "highlight_opacity": 0.4,
        "debossed": False,
    },
    "leather": {
        "depth": 1.6,
        "bevel_width": 15,
        "shadow_opacity": 0.75,
        "highlight_opacity": 0.3,
        "debossed": False,
    },

    # ── Bloom pattern ─────────────────────────────────────────────────────
    # Dense grid of small rounded-square petals with thin lines.
    # Tight bevel so shadow stays within each cell; strong shadow for crisp
    # edge definition; generous highlight so the surface reads as raised/popped.
    "bloom": {
        "depth": 1.4,
        "bevel_width": 8,
        "shadow_opacity": 0.85,
        "highlight_opacity": 0.45,
        "debossed": False,
    },
    # ── Flux Ribbed ─────────────────────────────────────────────────────
    # Narrow parallel ribs — requires a tight bevel so highlights run along
    # the ribs while shadows sit close to the valley. Strong depth helps
    # the ribs read as crisp embossing on textured surfaces.
    "flux_ribbed": {
        # Tweak: reduce highlight_opacity and depth slightly so ribs don't
        # appear blown-out white; widen bevel and deepen shadows for
        # smoother, more natural ribbed embossing.
            "depth": 1.9,
            "bevel_width": 20,
            "shadow_opacity": 0.98,
            "highlight_opacity": 0.02,
        "debossed": True,
    },
}
