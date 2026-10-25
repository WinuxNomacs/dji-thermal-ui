# Copied from WebODM, as forked in LuxODM (commit a2a81052): the thermal palettes of app/api/custom_colormaps_helper.py
# (the NDVI and highlight colour maps left out).
# Copyright (C) the WebODM authors (OpenDroneMap) and the LuxODM authors.
# Licensed under the GNU Affero General Public License v3.0 (see LICENSE).

# Thermal palettes: continuous gradients between color stops (position 0-1, RGB). They approximate the
# look of the palettes thermal cameras offer; they are not copies of any manufacturer's tables.
def gradient_cmap(stops):
    """256 entries interpolated linearly between the stops [(position, (r, g, b)), ...]"""
    cmap = {}
    for i in range(256):
        x = i / 255.0
        for (p0, c0), (p1, c1) in zip(stops, stops[1:]):
            if x <= p1 or (p1, c1) == stops[-1]:
                t = 0.0 if p1 == p0 else min(1.0, max(0.0, (x - p0) / (p1 - p0)))
                cmap[i] = tuple(int(round(a + (b - a) * t)) for a, b in zip(c0, c1)) + (255,)
                break
    return cmap

THERMAL_STOPS = {
    "ironbow": [(0.00, (0, 0, 0)), (0.15, (30, 0, 100)), (0.30, (105, 0, 145)), (0.45, (180, 20, 100)),
                (0.60, (230, 70, 30)), (0.75, (250, 150, 10)), (0.88, (255, 215, 60)), (1.00, (255, 255, 230))],
    "lava": [(0.00, (0, 0, 0)), (0.25, (90, 0, 0)), (0.50, (200, 25, 0)), (0.75, (255, 120, 0)),
             (0.90, (255, 200, 40)), (1.00, (255, 255, 180))],
    "arctic": [(0.00, (0, 0, 40)), (0.25, (0, 50, 150)), (0.50, (0, 150, 210)), (0.75, (110, 220, 235)),
               (1.00, (255, 255, 255))],
}

# What the layer panel offers for a layer drawn as temperatures, in this order. "gray" is white hot and
# "gray_r" black hot (the palettes of rio-tiler that they are named after in thermal cameras)
THERMAL_COLORMAPS = ["ironbow", "gray", "gray_r", "lava", "arctic", "rainbow", "hot",
                     "magma", "inferno", "plasma", "viridis", "jet"]

thermal_colormaps = [{name: gradient_cmap(stops)} for name, stops in THERMAL_STOPS.items()]
