# Copied from WebODM, as forked in LuxODM (commit a2a81052): what the analyzer uses of app/api/tiler.py (rendering
# tiles, their ETags and formats, colour maps, a raster's value at a point), for rio-tiler 9.
# Copyright (C) the WebODM authors (OpenDroneMap) and the LuxODM authors.
# Licensed under the GNU Affero General Public License v3.0 (see LICENSE).
import hashlib
import importlib
import io
import os
import warnings
from functools import lru_cache

import numpy as np
from django.http import HttpResponse, HttpResponseNotModified
from django.utils.http import parse_etags
from PIL import Image
from rasterio.crs import CRS
from rasterio.errors import NotGeoreferencedWarning
from rest_framework import exceptions
from rio_tiler.colormap import apply_cmap
from rio_tiler.colormap import cmap as colormap
from rio_tiler.errors import AlphaBandWarning, InvalidColorMapName, PointOutsideBounds
from rio_tiler.profiles import img_profiles
from rio_tiler.utils import render

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


# libwebp effort (0-6) for WebP tiles. GDAL's WEBP driver, which rio-tiler's render uses, spends
# ~90 ms on a 512px tile; Pillow at method 2 makes a file of about the same size in ~4 ms
WEBP_METHOD = 2


def render_tile(data, mask, img_format, colormap=None, **options):
    """
    Same as rio_tiler.utils.render, but WebP is encoded with Pillow (see WEBP_METHOD).

    :param data: uint8 array (bands, height, width)
    :param mask: uint8 array (height, width), 0 = transparent, 255 = opaque, or None for no alpha
    :param img_format: png | jpeg | webp
    :param colormap: rio-tiler colormap to apply to single band data
    :param options: encoder options (rio_tiler.profiles.img_profiles)
    """
    # Anything Pillow's WebP encoder cannot take as is keeps going through GDAL
    if img_format != "webp" or data.dtype != np.uint8 or data.shape[0] not in (1, 3):
        return render(data, mask, img_format=img_format, colormap=colormap, **options)

    # As rio_tiler.utils.render does
    if colormap:
        data, alpha = apply_cmap(data, colormap)
        if mask is not None:
            mask = np.bitwise_and(alpha, mask)
    if data.shape[0] == 1:
        data = np.repeat(data, 3, axis=0)

    bands = list(data)
    if mask is not None:
        bands.append(mask.astype(np.uint8))

    buf = io.BytesIO()
    Image.fromarray(np.stack(bands, axis=-1)).save(buf, "WEBP", quality=options.get("quality", 75),
                                                  lossless=options.get("lossless", False), method=WEBP_METHOD)
    return buf.getvalue()


# Modules whose code decides what a tile looks like (see raster_etag)
TILE_RENDERING_MODULES = ['dji_thermal_ui.analyzer.raster.tiler', 'dji_thermal_ui.analyzer.raster.colormaps',
                          'dji_thermal_ui.analyzer.raster.thermal_correction']


@lru_cache(maxsize=None)
def tile_code_fingerprint():
    """
    Hash of the code and libraries that render tiles
    """
    import PIL
    import rasterio
    import rio_tiler
    from PIL import features

    h = hashlib.sha1()
    for name in TILE_RENDERING_MODULES:
        with open(importlib.import_module(name).__file__, 'rb') as f:
            h.update(f.read())
    h.update(" ".join(str(v) for v in [rio_tiler.__version__, rasterio.__version__, rasterio.__gdal_version__,
                                        np.__version__, PIL.__version__, features.version('webp')]).encode())
    return h.hexdigest()


def raster_etag(request, raster_path, *extra):
    """
    ETag of a tile. Tiles are served with "no-cache" (the browser keeps them but asks every time
    whether they are still valid), so this must change whenever anything the tile is rendered from
    changes: the request (URL and Accept, which picks the format), the raster file (replaced when
    it is rebuilt), the rendering code and whatever else the caller reads while rendering (extra).
    """
    st = os.stat(raster_path)
    parts = [tile_code_fingerprint(), request.get_full_path(), request.headers.get('Accept', ''),
             raster_path, st.st_ino, st.st_size, st.st_mtime_ns] + list(extra)
    return '"%s"' % hashlib.sha1("\n".join(str(p) for p in parts).encode()).hexdigest()


def not_modified(request, etag):
    """A 304 response when the browser already has this version of the tile, else None"""
    if etag not in parse_etags(request.headers.get('If-None-Match', '')):
        return None
    res = HttpResponseNotModified()
    res['ETag'] = etag
    res['Cache-Control'] = 'private, no-cache'
    return res


def tile_response(content, ext, etag):
    res = HttpResponse(content, content_type="image/{}".format(ext))
    res['ETag'] = etag
    res['Cache-Control'] = 'private, no-cache'
    return res


def tile_format(request, mask, ext=None):
    """
    (extension, driver, encoder options) of a tile: ext when the URL asks for one, else JPEG when
    the tile is fully opaque, WebP when the browser takes it, PNG otherwise
    """
    if ext is None:
        if np.equal(mask, 255).all():
            ext = "jpg"
        elif 'image/webp' in request.headers.get('Accept', ''):
            ext = "webp"
        else:
            ext = "png"
    driver = "jpeg" if ext == "jpg" else ext
    return ext, driver, img_profiles.get(driver, {})


def parse_rescale(rescale):
    """[min, max] from "min,max", or a validation error"""
    try:
        return list(map(float, rescale.split(",")))
    except (AttributeError, ValueError):
        raise exceptions.ValidationError("Invalid rescale value") from None


def check_colormap(name):
    """The rio-tiler colour map called name, or a validation error"""
    try:
        return colormap.get(name)
    except InvalidColorMapName:
        raise exceptions.ValidationError("Not a valid color_map value") from None


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
