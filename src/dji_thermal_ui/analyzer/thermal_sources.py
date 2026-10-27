"""
The source frames of a spot or an area of a mosaic (the viewer's and the compare page's pop-out): every frame that saw
it, from the frame models dji-thermal-cli 1.5.0 keeps beside a mosaic, with where the spot or area is in each frame's
pixels; or, in a mosaic built before, only the frames the mosaic took its pixels from.

Frame pixels are a column and a row with pixel centres at whole numbers, as dji-thermal-cli gives them. Used by the
API, in the web process.
"""
import math

import numpy as np

from . import thermal_measure

MAX_SAMPLES = 4096          # the points of an area each frame's share of it is measured on
OUTLINE_VERTICES = 256      # an area's outline in a frame: its edges cut into about this many vertices


def read_models(path):
    """The frame models beside a mosaic GeoTIFF, or None when it has none (built before dji-thermal-cli 1.5.0)"""
    from dji_thermal_cli import api
    try:
        return api.read_frame_models(path)
    except (OSError, ValueError, KeyError, TypeError):
        return None


def rounded(values, digits=2):
    return [round(float(v), digits) for v in values]


def angle(value):
    return None if value is None or not np.isfinite(value) else round(float(value), 1)


def sources(path, geometry, names, models):
    """
    The frames that saw a geometry (a checked Point or Polygon, lon/lat) on a mosaic (path: its GeoTIFF, with the
    source frame band and, since dji-thermal-cli 1.4.0, the frame pixel bands; names: its frames, as its source band
    numbers them; models: its frame models or None): {frames, reason}, the frames the mosaic used first. Each is
    {frame, used, view_angle} and, for a spot, its pixel (or None where it is not known); for an area, the share of
    it the frame saw (None without models), the share the mosaic took from it and its outline in the frame's pixels
    (rings, none without models).
    """
    import rasterio
    from pyproj import Transformer

    with rasterio.open(path) as ds:
        to_crs = Transformer.from_crs("EPSG:4326", ds.crs, always_xy=True)
        to_lonlat = Transformer.from_crs(ds.crs, "EPSG:4326", always_xy=True)
        if geometry['type'] == 'Point':
            return spot(ds, to_crs, geometry['coordinates'], names, models)
        return area(ds, to_crs, to_lonlat, geometry, names, models)


def spot(ds, to_crs, lonlat, names, models):
    from rasterio.windows import Window

    x, y = to_crs.transform(*lonlat)
    col, row = ~ds.transform @ (x, y)
    if not (0 <= row < ds.height and 0 <= col < ds.width):     # NaN, far from the mosaic's zone, too
        return {'frames': [], 'reason': 'outside_raster'}
    window = Window(int(math.floor(col)), int(math.floor(row)), 1, 1)
    bands = [b for b in (2, 3, 4, 5) if b <= ds.count]
    values = [float(v) for v in ds.read(bands, window=window)[:, 0, 0]]
    index = int(round(values[0])) if np.isfinite(values[0]) else None
    used = names[index] if index is not None and 0 <= index < len(names) else None
    used_pixel = values[2:4] if len(values) == 4 and all(np.isfinite(values[2:4])) else None

    frames = []
    if models is not None:
        pixels = models.pixels(*lonlat)[:, 0, :]
        angles = models.view_angles(*lonlat)[:, 0]
        for k in np.flatnonzero(np.isfinite(pixels[:, 0])):
            name = models.files[k]
            frames.append({'frame': name, 'used': name == used, 'view_angle': angle(angles[k]),
                           'pixel': rounded(used_pixel if name == used and used_pixel else pixels[k])})
    if used is not None and not any(f['used'] for f in frames):
        frames.append({'frame': used, 'used': True, 'view_angle': angle(values[1]),
                       'pixel': rounded(used_pixel) if used_pixel else None})
    frames.sort(key=lambda f: (not f['used'], f['view_angle'] if f['view_angle'] is not None else 90))
    return {'frames': frames, 'reason': None if frames else 'nodata'}


def area(ds, to_crs, to_lonlat, geometry, names, models):
    from rasterio.windows import Window, from_bounds

    x, y = to_crs.transform(*zip(*geometry['coordinates'][0]))
    if not (np.all(np.isfinite(x)) and np.all(np.isfinite(y))):     # far from the mosaic's zone
        return {'frames': [], 'reason': 'outside_raster'}
    _shape, inside, _ring = thermal_measure.shapes(geometry, to_crs)
    w = from_bounds(*inside.bounds, transform=ds.transform)
    col, row = math.floor(w.col_off), math.floor(w.row_off)
    col1, row1 = math.ceil(w.col_off + w.width), math.ceil(w.row_off + w.height)
    col, row, col1, row1 = max(col, 0), max(row, 0), min(col1, ds.width), min(row1, ds.height)
    if col1 <= col or row1 <= row:
        return {'frames': [], 'reason': 'outside_raster'}
    window = Window(col, row, col1 - col, row1 - row)
    transform = ds.window_transform(window)
    mask = thermal_measure.region_mask(inside, (row1 - row, col1 - col), transform)
    total = int(mask.sum())
    if total == 0:
        return {'frames': [], 'reason': 'outside_raster'}

    # The frames the mosaic took the area's pixels from, and how many from each
    source = ds.read(2, window=window)[mask]
    source = np.where(np.isfinite(source), source, -1).round().astype(int)
    used_angles = ds.read(3, window=window)[mask]
    frames = {}
    for i, name in enumerate(names):
        taken = source == i
        if taken.any():
            picked = used_angles[taken & np.isfinite(used_angles)]
            frames[name] = {'frame': name, 'used': True, 'share': None, 'used_share': round(int(taken.sum()) / total, 4),
                            'view_angle': angle(picked.mean()) if picked.size else None, 'outline': []}

    if models is not None:
        # Each frame's share of the area: of the area's pixel centres (at most MAX_SAMPLES of them), those it saw
        rows, cols = np.nonzero(mask)
        step = max(1, int(math.ceil(rows.size / MAX_SAMPLES)))
        x, y = transform @ (cols[::step] + 0.5, rows[::step] + 0.5)
        lon, lat = to_lonlat.transform(np.asarray(x), np.asarray(y))
        seen = np.isfinite(models.pixels(lon, lat)[:, :, 0])
        angles = models.view_angles(lon, lat)
        share = seen.mean(axis=1)
        for k in np.flatnonzero(share > 0):
            name = models.files[k]
            f = frames.setdefault(name, {'frame': name, 'used': False, 'used_share': 0.0, 'outline': []})
            f['share'] = round(float(share[k]), 4)
            f['view_angle'] = angle(np.nanmean(angles[k][seen[k]]))
        outlines(frames, models, inside, to_crs, to_lonlat, abs(ds.transform.a))

    ordered = sorted(frames.values(), key=lambda f: (not f['used'], -f['used_share'], -(f['share'] or 0)))
    return {'frames': ordered, 'reason': None if ordered else 'nodata'}


def outlines(frames, models, inside, to_crs, to_lonlat, gsd):
    """Each frame's outline of the area: the area within the frame's footprint (a quarter of the mosaic's pixel
    inside it, so that its edge is seen), its edges cut into about OUTLINE_VERTICES vertices, in the frame's pixels
    (a vertex the frame did not see after all left out)"""
    import shapely
    from shapely.geometry import Polygon

    index = {name: k for k, name in enumerate(models.files)}
    parts = []
    for name in frames:
        k = index.get(name)
        if k is None:
            continue
        x, y = to_crs.transform(models.footprints[k][:, 0], models.footprints[k][:, 1])
        footprint = Polygon(np.column_stack([x, y]))
        footprint = (footprint if footprint.is_valid else footprint.buffer(0)).buffer(-gsd / 4)
        seen = inside.intersection(footprint)
        for polygon in getattr(seen, 'geoms', [seen]):
            if polygon.geom_type != 'Polygon' or polygon.is_empty:
                continue
            ring = shapely.segmentize(polygon.exterior, max(polygon.exterior.length / OUTLINE_VERTICES, 1e-6))
            parts.append((name, k, np.asarray(ring.coords)[:-1]))
    if not parts:
        return
    # One projection of every outline's vertices into every frame, each outline then read in its own frame's row
    points = np.concatenate([p for _, _, p in parts])
    lon, lat = to_lonlat.transform(points[:, 0], points[:, 1])
    pixels = models.pixels(np.asarray(lon), np.asarray(lat))
    start = 0
    for name, k, p in parts:
        px = pixels[k, start:start + len(p)]
        start += len(p)
        px = px[np.isfinite(px[:, 0])]
        if len(px) >= 3:
            frames[name]['outline'].append([rounded(v, 1) for v in px])
