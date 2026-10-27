# Copied from WebODM, as forked in LuxODM (commit a2a81052): what the analyzer uses of app/api/tiler.py (rendering
# tiles, their ETags and formats, colour maps, a raster's value at a point), for rio-tiler 9.
# Copyright (C) the WebODM authors (OpenDroneMap) and the LuxODM authors.
# Licensed under the GNU Affero General Public License v3.0 (see LICENSE).
import hashlib
import importlib
import os
import warnings
from functools import lru_cache

import numpy as np
from django.http import HttpResponseNotModified
from django.utils.http import parse_etags
from rasterio.crs import CRS
from rasterio.errors import NotGeoreferencedWarning
from rest_framework import exceptions
from rio_tiler.colormap import cmap as colormap
from rio_tiler.errors import AlphaBandWarning, InvalidColorMapName, PointOutsideBounds

from .colormaps import thermal_colormaps

# Disable: NotGeoreferencedWarning: Dataset has no geotransform, gcps, or rpcs. The identity matrix be returned.
warnings.filterwarnings("ignore", category=NotGeoreferencedWarning)

# Disable: Alpha band was removed from the output data array
warnings.filterwarnings("ignore", category=AlphaBandWarning)

# Disable: UserWarning: Warning: 'partition' will ignore the 'mask' of the MaskedArray.
warnings.filterwarnings("ignore", category=UserWarning)

# Disable: RuntimeWarning: overflow encountered in reduce
warnings.filterwarnings("ignore", category=RuntimeWarning)

for custom_colormap in thermal_colormaps:
    colormap = colormap.register(custom_colormap)

WGS84 = CRS.from_epsg(4326)

# How many zoom levels past a raster's own resolution its layer can be zoomed in
ZOOM_EXTRA_LEVELS = 3


@lru_cache(maxsize=128)
def get_colormap_encoded_values(cmap):
    values = colormap.get(cmap).values()
    # values = [[R, G, B, A], [R, G, B, A], ...]
    encoded_values = []
    for rgba in values:
        # Pack R, G, B, A (each 0-255) into a 32-bit integer
        # Format: 0xRRGGBBAA (R in most significant byte). rio-tiler's own colour maps hold numpy uint8s, which would
        # overflow when shifted: Python ints first
        r, g, b, a = (int(v) for v in rgba)
        encoded = (r << 24) | (g << 16) | (b << 8) | a
        encoded_values.append(encoded)

    return encoded_values


# Modules whose code decides what a tile holds (see raster_etag)
TILE_RENDERING_MODULES = ['dji_thermal_ui.analyzer.raster.tiler', 'dji_thermal_ui.analyzer.raster.colormaps',
                          'dji_thermal_ui.analyzer.raster.thermal_correction']


@lru_cache(maxsize=None)
def tile_code_fingerprint():
    """
    Hash of the code and libraries that read tiles
    """
    import rasterio
    import rio_tiler

    h = hashlib.sha1()
    for name in TILE_RENDERING_MODULES:
        with open(importlib.import_module(name).__file__, 'rb') as f:
            h.update(f.read())
    h.update(" ".join(str(v) for v in [rio_tiler.__version__, rasterio.__version__, rasterio.__gdal_version__,
                                        np.__version__]).encode())
    return h.hexdigest()


def raster_etag(request, raster_path, *extra):
    """
    ETag of a tile. Tiles are served with "no-cache" (the browser keeps them but asks every time
    whether they are still valid), so this must change whenever anything the tile is read from
    changes: the request (its URL), the raster file (replaced when it is rebuilt), the code that
    reads it and whatever else the caller reads (extra).
    """
    st = os.stat(raster_path)
    parts = [tile_code_fingerprint(), request.get_full_path(), raster_path, st.st_ino, st.st_size,
             st.st_mtime_ns] + list(extra)
    return '"%s"' % hashlib.sha1("\n".join(str(p) for p in parts).encode()).hexdigest()


def not_modified(request, etag):
    """A 304 response when the browser already has this version of the tile, else None"""
    if etag not in parse_etags(request.headers.get('If-None-Match', '')):
        return None
    res = HttpResponseNotModified()
    res['ETag'] = etag
    res['Cache-Control'] = 'private, no-cache'
    return res


def parse_rescale(rescale):
    """[min, max] from "min,max", or a validation error"""
    try:
        return list(map(float, rescale.split(",")))
    except (AttributeError, ValueError):
        raise exceptions.ValidationError("Invalid rescale value") from None


COLORMAP_LABELS = {
    "viridis": "Viridis",
    "jet": "Jet",
    "plasma": "Plasma",
    "inferno": "Inferno",
    "magma": "Magma",
    "ironbow": "Ironbow",
    "gray": "White hot",
    "gray_r": "Black hot",
    "lava": "Lava",
    "arctic": "Arctic",
    "rainbow": "Rainbow",
    "hot": "Hot"
}


def colormap_entries(names):
    """The colour maps a layer can be shown with: [{key, color_map (encoded RGBA values), label}]"""
    entries = []
    for cmap in names:
        try:
            entries.append({'key': cmap, 'color_map': get_colormap_encoded_values(cmap),
                            'label': COLORMAP_LABELS.get(cmap, cmap)})
        except (FileNotFoundError, InvalidColorMapName):
            raise exceptions.ValidationError("Not a valid color_map value: %s" % cmap) from None
    return entries


def get_zoom_safe(src_dst):
    minzoom, maxzoom = src_dst.minzoom, src_dst.maxzoom
    if maxzoom < minzoom:
        maxzoom = minzoom
    return minzoom, maxzoom


def point_values(src, lon, lat, indexes=None, expr=None, nodata=None, vrt_options=None, to_meter=1.0):
    """
    The value of each band (or of the expression) of an open rio-tiler Reader at a point (lon/lat), None where
    there is no data; or None when the point is outside the raster
    """
    # Checked first: a point far from the raster can't even be projected into its CRS (a UTM zone)
    west, south, east, north = src.get_geographic_bounds(WGS84)
    if not (west <= lon <= east and south <= lat <= north):
        return None
    try:
        pt = src.point(lon, lat, indexes=indexes, expression=expr, nodata=nodata, vrt_options=vrt_options)
    except PointOutsideBounds:
        return None
    masked = np.ma.getmaskarray(pt.array)
    return [None if masked[i] else float(pt.array.data[i]) * to_meter for i in range(pt.array.shape[0])]
