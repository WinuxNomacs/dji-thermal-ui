"""
A conversion's radiometric analysis (the viewer and the frame page): the temperatures of a spot, a line or an area,
histograms and isotherms (the region measured as raster/measurements.py finds it), on its mosaics and on single frames.

Frames are measured by dji-thermal-cli (api.measure) when they are asked for, as the conversion converted them, or with
some measurement parameters changed (exact: the SDK measures again). The mosaics can be corrected for another
emissivity and reflected temperature with LuxODM's thermal correction model (raster/thermal_correction.py):
an approximation, since the SDK is not run again.

All temperatures are in the conversion's unit. Used by the API, in the web process.
"""
import json
import math
import os
from functools import lru_cache

import numpy as np

from . import thermal_conversion, thermal_mosaics

PERCENTILES = (2, 98)
HISTOGRAM_BINS = 64
MAX_VERTICES = 1000
VISUAL_COVER_PX = 1024      # a visual mosaic's coverage of a shape: its mask read at most this many pixels across
MAX_SAMPLES = 1000          # a line's profile: sampled at the grid's pixel spacing, at most this many times
# How a shape was drawn: areas by dragging (box, circle), measured as their polygon; a Delta T (delta): a 2-point line
# whose two ends are each measured as a spot
SHAPE_KINDS = ('box', 'circle', 'delta', 'across')
ISOTHERM_MODES = ('above', 'below', 'between')
# The measurement parameters a frame can be measured again with (Settings fields: temperatures in the unit)
CHANGES = ('distance', 'humidity', 'emissivity', 'reflected_temp', 'ambient_temp')
# What the mosaics' approximate correction changes
CORRECTIONS = ('emissivity', 'reflected_temp')
# On a frame, in pixels: a spot's disc and a line's strip (on a mosaic: app/measurements' metres)
FRAME_SHAPES = {'point_radius': 1.5, 'line_half_width': 1.0}
# Delta T Around Pointer: the circle's largest radius (metres on a mosaic, pixels on a frame)
AROUND_MAX = {'mosaic': 10.0, 'frame': 50.0}
FRAME_CACHE = 16            # frames measured kept in memory (about 1.3 MB each for the M4T's 640 × 512)
# How temperatures are drawn (display only, in the browser): gamma on the palette's shares, an unsharp mask's amount,
# the bands (stepped or banded: their width in the values' unit, a band's edge at origin) and the legend's samples
GAMMA_LIMITS = (0.2, 5.0)
SHARPEN_LIMITS = (0.0, 5.0)
BAND_MODES = ('stepped', 'banded')
BAND_WIDTH_MAX = 100.0
CURVE_SAMPLES = 65


class MeasureError(ValueError):
    """Something asked is not valid (the message is for the user)"""


# --- units ---------------------------------------------------------------------------------------------------------

def to_celsius(v, unit):
    return {'F': lambda x: (x - 32.0) / 1.8, 'K': lambda x: x - 273.15}.get(unit, lambda x: x)(v)


def from_celsius(v, unit):
    return {'F': lambda x: x * 1.8 + 32.0, 'K': lambda x: x + 273.15}.get(unit, lambda x: x)(v)


def difference_in(unit, celsius):
    """A temperature difference in Celsius, in the unit"""
    return celsius * 1.8 if unit == 'F' else celsius


def number(value, name):
    try:
        return thermal_conversion.number(value)
    except (TypeError, ValueError):
        raise MeasureError("{} is not a number".format(name)) from None


# --- what is asked -------------------------------------------------------------------------------------------------

def parse_isotherm(value):
    """
    "above,T", "below,T" or "between,A,B" as (mode, low, high): the values above low, below high or between both;
    None when value is empty
    """
    if value is None or value == "":
        return None
    parts = str(value).split(',')
    mode = parts[0]
    if mode not in ISOTHERM_MODES or len(parts) != (3 if mode == 'between' else 2):
        raise MeasureError("The isotherm is above,T or below,T or between,A,B")
    values = [number(p, "The isotherm's temperature") for p in parts[1:]]
    if mode == 'above':
        return mode, values[0], None
    if mode == 'below':
        return mode, None, values[0]
    if not values[1] > values[0]:
        raise MeasureError("The isotherm's second temperature must be above the first")
    return mode, values[0], values[1]


def isotherm_mask(values, isotherm):
    """Where values (an array, NaN = no data) are in the isotherm"""
    _mode, low, high = isotherm
    with np.errstate(invalid='ignore'):
        inside = np.isfinite(values)
        if low is not None:
            inside &= values >= low
        if high is not None:
            inside &= values <= high
    return inside


def check_geometry(geometry, lonlat=True):
    """A GeoJSON Point, LineString or Polygon (lon/lat, or a frame's pixel x/y), checked; its polygon closed"""
    if isinstance(geometry, dict) and geometry.get('type') == 'Feature':
        geometry = geometry.get('geometry')
    if not isinstance(geometry, dict) or geometry.get('type') not in ('Point', 'LineString', 'Polygon'):
        raise MeasureError("The geometry is a point, a line or a polygon")
    kind, coords = geometry['type'], geometry.get('coordinates')

    def position(c):
        if not isinstance(c, (list, tuple)) or len(c) < 2:
            raise MeasureError("Invalid coordinates") from None
        x, y = number(c[0], "A coordinate"), number(c[1], "A coordinate")
        if lonlat and not (-180 <= x <= 180 and -90 <= y <= 90):
            raise MeasureError("Coordinates out of range")
        return [x, y]

    try:
        if kind == 'Point':
            return {'type': kind, 'coordinates': position(coords)}
        if kind == 'LineString':
            line = [position(c) for c in coords]
            if len(line) < 2 or len(line) > MAX_VERTICES:
                raise MeasureError("A line has 2 to {} points".format(MAX_VERTICES))
            return {'type': kind, 'coordinates': line}
        ring = [position(c) for c in coords[0]]
    except TypeError:
        raise MeasureError("Invalid coordinates") from None
    if ring and ring[0] != ring[-1]:
        ring.append(ring[0])
    if len(ring) < 4 or len(ring) > MAX_VERTICES:
        raise MeasureError("An area has 3 to {} corners".format(MAX_VERTICES))
    return {'type': kind, 'coordinates': [ring]}


def check_shape(shape, geometry, lonlat=True):
    """
    How a shape was drawn when it was not clicked point by point: {kind: box} or {kind: circle, center, radius} (the
    radius in metres on a mosaic, in pixels on a frame), an area; {kind: delta}, a Delta T, a line of 2 points;
    {kind: across, own, other, other_target}, a Delta T across two conversions' mosaics (the compare page's): a line of
    2 points, the end own (0 or 1) on this conversion's, the other on conversion other's tab other_target; checked;
    None for none
    """
    if shape is None or shape == "":
        return None
    if not isinstance(shape, dict) or shape.get('kind') not in SHAPE_KINDS:
        raise MeasureError("The shape is a box, a circle or a Delta T")
    if shape['kind'] == 'across':
        if geometry is None or geometry['type'] != 'LineString' or len(geometry['coordinates']) != 2:
            raise MeasureError("A Delta T across two datasets is a line of 2 points")
        own, other, tab = shape.get('own'), shape.get('other'), shape.get('other_target')
        if own not in (0, 1) or isinstance(own, bool):
            raise MeasureError("A Delta T across two datasets has one end (0 or 1) on this one")
        if not isinstance(other, int) or isinstance(other, bool) or other < 1 or not isinstance(tab, str) or not tab:
            raise MeasureError("A Delta T across two datasets names the other dataset and its mosaic")
        return {'kind': 'across', 'own': own, 'other': other, 'other_target': tab}
    if shape['kind'] == 'delta':
        if geometry is None or geometry['type'] != 'LineString' or len(geometry['coordinates']) != 2:
            raise MeasureError("A Delta T is a line of 2 points")
        return {'kind': 'delta'}
    if geometry is None or geometry['type'] != 'Polygon':
        raise MeasureError("A box or a circle is an area")
    if shape['kind'] == 'box':
        return {'kind': 'box'}
    center = check_geometry({'type': 'Point', 'coordinates': shape.get('center')}, lonlat)['coordinates']
    radius = number(shape.get('radius'), "The circle's radius")
    if not radius > 0:
        raise MeasureError("The circle's radius must be above zero")
    return {'kind': 'circle', 'center': center, 'radius': radius}


# --- statistics ----------------------------------------------------------------------------------------------------

def shapes(geometry, to_crs=None, sizes=None):
    """(the shape, what it measures) as shapely geometries in the grid's units"""
    from .raster.measurements import inside, projected
    shape = projected(geometry, to_crs)
    if not shape.is_valid:
        shape = shape.buffer(0)
    return shape, inside(geometry['type'], shape, **(sizes or {}))


def shape_size(geometry_type, shape):
    if geometry_type == 'Polygon':
        return {'area': shape.area, 'perimeter': shape.length}
    if geometry_type == 'LineString':
        return {'length': shape.length}
    return {}


def region_mask(geom, out_shape, transform):
    """The pixels of a grid a shapely polygon touches (outline pixels included, as the tiler's region statistics)"""
    from rasterio.features import geometry_mask
    if geom.is_empty:
        return np.zeros(out_shape, dtype=bool)
    return geometry_mask([geom], out_shape=out_shape, transform=transform, all_touched=True,
                         invert=True)


def value_stats(values, isotherm=None):
    """min / max / mean / std / median, the PERCENTILES, a histogram and the valid pixels of an array's finite
    values (as the tiler's region_band_stats), with the isotherm's share of them"""
    from .raster.stats import region_band_stats
    finite = np.isfinite(values)
    stats = region_band_stats(np.ma.masked_array(values, mask=~finite), percentiles=PERCENTILES, bins=HISTOGRAM_BINS)
    stats.pop('total_pixels', None)     # of the grid read, which says nothing about the shape
    if isotherm is not None:
        n = int(isotherm_mask(values, isotherm).sum())
        stats['isotherm'] = {'pixels': n, 'share': n / stats['valid_pixels'] if stats['valid_pixels'] else None}
    return stats


def region_stats(values, transform, inside, isotherm=None, locate=None):
    """
    What a shape measures on a grid of values (NaN = no data): the statistics inside it and where its extremes are
    (locate(row, col) -> coordinates)
    """
    mask = region_mask(inside, values.shape, transform)
    inner = np.where(mask, values, np.nan)
    out = value_stats(inner, isotherm)
    if out['valid_pixels'] == 0:
        return out
    if locate is not None:
        filled = np.where(np.isfinite(inner), inner, np.nan)
        out['min_location'] = locate(*np.unravel_index(np.nanargmin(filled), filled.shape))
        out['max_location'] = locate(*np.unravel_index(np.nanargmax(filled), filled.shape))
    return out


def check_around(value, kind):
    """Delta T Around Pointer's radius asked (kind: mosaic, in metres, or frame, in pixels), checked; None for none"""
    if value is None or value == "":
        return None
    radius = number(value, "The circle's radius")
    if not 0 < radius <= AROUND_MAX[kind]:
        raise MeasureError("The circle's radius is above 0 and at most {:g}".format(AROUND_MAX[kind]))
    return radius


def around_point(values, transform, x, y, radius, at=None):
    """
    Delta T Around Pointer on a grid of values (NaN = no data): the mean, min and max of the finite pixels in a circle
    of radius around (x, y) (in the grid's units), the pixel there left out, and the difference of the temperature at
    the point (at; else the grid's own pixel there) with their mean (ΔT)
    """
    from shapely.geometry import Point
    mask = region_mask(Point(x, y).buffer(radius), values.shape, transform)
    col, row = ~transform @ (x, y)
    row, col = int(math.floor(row)), int(math.floor(col))
    if 0 <= row < values.shape[0] and 0 <= col < values.shape[1]:
        mask[row, col] = False
        if at is None and np.isfinite(values[row, col]):
            at = float(values[row, col])
    around = values[mask]
    around = around[np.isfinite(around)]
    out = {'radius': radius, 'pixels': int(around.size), 'mean': None, 'min': None, 'max': None, 'delta_t': None}
    if around.size:
        out.update(mean=float(around.mean()), min=float(around.min()), max=float(around.max()))
        if at is not None:
            out['delta_t'] = at - out['mean']
    return out


def mosaic_around(path, unit, lon, lat, radius, correction=None, at=None):
    """Delta T Around Pointer (around_point) on a mosaic, at a point (lon, lat) with a radius in metres"""
    import rasterio
    from pyproj import Transformer
    with rasterio.open(path) as ds:
        crs = ds.crs
    x, y = Transformer.from_crs("EPSG:4326", crs, always_xy=True).transform(lon, lat)
    empty = {'radius': radius, 'pixels': 0, 'mean': None, 'min': None, 'max': None, 'delta_t': None}
    if not (math.isfinite(x) and math.isfinite(y)):
        return empty
    read = read_mosaic(path, unit, (x - radius, y - radius, x + radius, y + radius))
    if read is None:
        return empty
    values, transform, _crs = read
    return around_point(corrected(values, unit, correction), transform, x, y, radius, at)


def profile_points(line, step):
    """Where a line (shapely, in the grid's units) is sampled: every step from its start to its end, at most MAX_SAMPLES
    times. Returns (distances, x, y) arrays."""
    coords = np.asarray(line.coords, dtype=np.float64)
    along = np.concatenate([[0.0], np.cumsum(np.hypot(*np.diff(coords[:, :2], axis=0).T))])
    length = float(along[-1])
    n = max(2, min(MAX_SAMPLES, int(math.floor(length / step)) + 1)) if step > 0 else 2
    distances = np.linspace(0.0, length, n)
    return distances, np.interp(distances, along, coords[:, 0]), np.interp(distances, along, coords[:, 1])


def grid_values(values, transform, x, y):
    """A grid's values at points (x, y arrays in its units), NaN outside it"""
    cols, rows = ~transform @ (x, y)
    cols, rows = np.floor(cols).astype(np.int64), np.floor(rows).astype(np.int64)
    inside = (rows >= 0) & (rows < values.shape[0]) & (cols >= 0) & (cols < values.shape[1])
    out = np.full(len(x), np.nan)
    out[inside] = values[rows[inside], cols[inside]]
    return out


def no_data(values, unit):
    """values as float64 with dji-thermal-cli's no-data marker (absolute zero) as NaN"""
    values = np.asarray(values, dtype=np.float64)
    with np.errstate(invalid='ignore'):
        return np.where(values > thermal_mosaics.low_value(unit), values, np.nan)


# --- colours -------------------------------------------------------------------------------------------------------

def parse_adjust(params):
    """
    The display adjustments the browser draws a mosaic or frame with (gamma, sharpen, and bands=stepped or banded
    with band_width and band_origin in the values' unit), checked: {gamma, sharpen, bands: (mode, width, origin) or
    None}, none by default. They change how temperatures are drawn, never the temperatures.
    """
    def ranged(name, label, limits, default):
        raw = params.get(name)
        if raw is None or raw == "":
            return default
        v = number(raw, label)
        if not limits[0] <= v <= limits[1]:
            raise MeasureError("{} is from {:g} to {:g}".format(label, *limits))
        return v

    mode = params.get('bands') or ''
    if mode and mode not in BAND_MODES:
        raise MeasureError("bands is stepped or banded")
    bands = None
    if mode:
        width = number(params.get('band_width'), "The bandwidth")
        if not 0 < width <= BAND_WIDTH_MAX:
            raise MeasureError("The bandwidth is above 0 and up to {:g}".format(BAND_WIDTH_MAX))
        origin = params.get('band_origin')
        bands = (mode, width, 0.0 if origin is None or origin == '' else number(origin, "The bands' origin"))
    return {'gamma': ranged('gamma', "Gamma", GAMMA_LIMITS, 1.0), 'bands': bands,
            'sharpen': ranged('sharpen', "Sharpening", SHARPEN_LIMITS, 0.0)}


def tone(values, low, high, adjust=None):
    """Values' shares of the palette (0..1) over low..high, with gamma"""
    t = np.clip((np.asarray(values, dtype=np.float64) - low) / (high - low), 0.0, 1.0)
    gamma = (adjust or {}).get('gamma', 1.0)
    return t ** (1.0 / gamma) if gamma != 1.0 else t


def curve_shares(low, high, adjust=None):
    """The palette's share at CURVE_SAMPLES temperatures evenly across low..high (gamma's tone curve)"""
    return [float(t) for t in tone(np.linspace(low, high, CURVE_SAMPLES), low, high, adjust)]


# --- the mosaics ---------------------------------------------------------------------------------------------------

def median(values):
    v = [x for x in values if isinstance(x, (int, float)) and not isinstance(x, bool) and math.isfinite(x)]
    return float(np.median(v)) if v else None


def mosaic_baseline(conversion, kind):
    """The emissivity and reflected temperature (in the unit) a mosaic was measured with: the conversion's, else the
    normalization's (harmonized), else the flight's median of the frames' recorded values"""
    options = conversion.options or {}
    unit = options.get('unit') or 'C'
    rows = [r for r in ((conversion.dataset.analysis or {}).get('files') or []) if r.get('kind') == 'thermal']
    emissivity = options.get('emissivity')
    if emissivity is None:
        emissivity = median(r.get('emissivity') for r in rows)
    reflected = options.get('reflected_temp')
    if reflected is None:
        norm = (((conversion.mosaics or {}).get('kinds') or {}).get(kind) or {}).get('normalization')
        if norm and norm[1] is not None:
            reflected = from_celsius(norm[1], unit)
        else:
            r = median(row.get('reflection') for row in rows)
            reflected = from_celsius(r, unit) if r is not None else None
    return {'emissivity': emissivity if emissivity is not None else 1.0,
            'reflected_temp': reflected if reflected is not None else from_celsius(20.0, unit)}


def mosaic_correction(conversion, kind, raw):
    """
    The thermal correction ((params, baseline), as parse_correction gives them) of a mosaic for the emissivity and
    reflected temperature asked ({field: value}, blank keeps the mosaic's), or None when nothing changes
    """
    from .raster.thermal_correction import is_identity
    unit = (conversion.options or {}).get('unit') or 'C'
    base = mosaic_baseline(conversion, kind)
    wanted = dict(base)
    for field in CORRECTIONS:
        value = (raw or {}).get(field)
        if not thermal_conversion.blank(value):
            wanted[field] = number(value, field.replace('_', ' ').capitalize())
    low, high = thermal_conversion.LIMITS['emissivity']
    if not low <= wanted['emissivity'] <= high:
        raise MeasureError("The emissivity is between {:g} and {:g}".format(low, high))
    reflected = to_celsius(wanted['reflected_temp'], unit)
    if not -100 <= reflected <= 1000:
        raise MeasureError("The reflected temperature is between -100 and 1000 °C")
    # Transmission 1 (what the M4T reports at mapping distances): the atmosphere's temperature then doesn't matter
    params = (wanted['emissivity'], 1.0, reflected, 20.0)
    baseline = (base['emissivity'], 1.0, to_celsius(base['reflected_temp'], unit), 20.0)
    return None if is_identity(params, baseline) else (params, baseline)


def corrected(values, unit, correction):
    """values (in the unit) corrected, or as they are"""
    if correction is None:
        return values
    from .raster.thermal_correction import corrected_array
    return from_celsius(corrected_array(to_celsius(values, unit), *correction), unit)


def read_mosaic(path, unit, bounds=None):
    """
    A mosaic's temperatures (NaN = no data) within bounds (in its CRS; all of it without) and their grid:
    (values, transform, crs), or None when bounds miss it
    """
    import rasterio
    from rasterio.windows import Window, from_bounds
    with rasterio.open(path) as ds:
        full = Window(0, 0, ds.width, ds.height)
        window = full
        if bounds is not None:
            w = from_bounds(*bounds, transform=ds.transform)
            col, row = math.floor(w.col_off), math.floor(w.row_off)
            window = Window(col, row, math.ceil(w.col_off + w.width) - col, math.ceil(w.row_off + w.height) - row)
            try:
                window = window.intersection(full)
            except Exception:       # rasterio's WindowError: they don't intersect
                return None
            if window.width <= 0 or window.height <= 0:
                return None
        values = ds.read(1, window=window).astype(np.float64)
        return no_data(values, unit), ds.window_transform(window), ds.crs


def mosaic_measure(path, unit, geometry, correction=None, isotherm=None, frames=None):
    """
    What a geometry (lon/lat) measures on a mosaic, or the whole mosaic's statistics without one. A line also gets
    its profile; frames ((path, band, names): the source frame raster) adds each sample's source frame to it.
    """
    import rasterio
    from pyproj import Transformer

    if geometry is None:
        values, _t, _c = read_mosaic(path, unit)
        return dict(value_stats(corrected(values, unit, correction), isotherm), kind='mosaic')

    with rasterio.open(path) as ds:
        crs = ds.crs
    to_crs = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
    to_lonlat = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
    out = {'kind': geometry['type'], 'reason': None}
    flat = np.asarray(geometry['coordinates'], dtype=float).reshape(-1, 2)
    if not np.all(np.isfinite(to_crs.transform(flat[:, 0], flat[:, 1]))):     # far from the mosaic's zone
        out.update(valid_pixels=0, reason='outside_raster')
        return out
    shape, inside = shapes(geometry, to_crs)
    read = read_mosaic(path, unit, inside.bounds)
    out.update(shape_size(geometry['type'], shape))
    if read is None:
        out.update(valid_pixels=0, reason='outside_raster')
        return out
    values, transform, _crs = read
    values = corrected(values, unit, correction)

    def locate(row, col):
        x, y = transform @ (col + 0.5, row + 0.5)
        return list(to_lonlat.transform(x, y))

    out.update(region_stats(values, transform, inside, isotherm, locate))
    if geometry['type'] == 'Point':
        col, row = ~transform @ (shape.x, shape.y)
        row, col = int(math.floor(row)), int(math.floor(col))
        inside_grid = 0 <= row < values.shape[0] and 0 <= col < values.shape[1]
        out['value'] = float(values[row, col]) if inside_grid and np.isfinite(values[row, col]) else None
    if geometry['type'] == 'LineString':
        distances, x, y = profile_points(shape, abs(transform.a))
        temperatures = grid_values(values, transform, x, y)
        lon, lat = to_lonlat.transform(x, y)
        out['profile'] = {'distance': distances.tolist(), 'values': temperatures.tolist(),
                          'points': [[float(a), float(b)] for a, b in zip(lon, lat)]}
        if frames is not None:
            out['profile']['frames'] = source_frames(frames, x, y, np.isfinite(temperatures))
    if out['valid_pixels'] == 0:
        out['reason'] = 'nodata'
    return out


def delta_measure(measure, geometry, length):
    """
    A Delta T (a line of 2 points, shape delta): each end read as the pixel under it, the value a spot there gives
    (measure(a Point geometry) -> what it measures), not its disc's mean, which mixes in what is around a small spot:
    {kind, first, second: the ends' pixels, delta_t: second − first, length, valid_pixels (2), reason};
    valid_pixels 0, with the reason, where an end has no temperature
    """
    ends = [measure({'type': 'Point', 'coordinates': c}) for c in geometry['coordinates']]
    first, second = (e.get('value') for e in ends)
    out = {'kind': 'LineString', 'first': first, 'second': second, 'length': length, 'reason': None,
           'delta_t': None, 'valid_pixels': 0}
    if first is None or second is None:
        missed = [e for e in ends if e.get('value') is None]
        out['reason'] = next((e['reason'] for e in missed if e.get('reason') == 'outside_raster'), 'nodata')
        return out
    out.update(delta_t=second - first, valid_pixels=2)
    return out


def mosaic_length(path, geometry):
    """A line's (lon/lat) length in a mosaic's projection, in metres (None far from its zone)"""
    import rasterio
    from pyproj import Transformer

    with rasterio.open(path) as ds:
        to_crs = Transformer.from_crs("EPSG:4326", ds.crs, always_xy=True)
    shape = shapes(geometry, to_crs)[0]
    return shape.length if math.isfinite(shape.length) else None


def frame_length(geometry):
    """A line's (pixel x/y) length on a frame, in pixels"""
    return shapes(geometry, sizes=FRAME_SHAPES)[0].length


def visual_measure(path, geometry):
    """
    What a geometry (lon/lat) measures on a visual mosaic of its own (path: its copy for the map, with a mask): the
    shape's size in the mosaic's projection (length; area and perimeter) and the mosaic's pixels it covers, read at
    most VISUAL_COVER_PX across (valid_pixels, 0 with a reason outside the mosaic), with no temperatures
    """
    import rasterio
    from pyproj import Transformer
    from rasterio.errors import WindowError
    from rasterio.windows import Window, from_bounds

    with rasterio.open(path) as ds:
        to_crs = Transformer.from_crs("EPSG:4326", ds.crs, always_xy=True)
        out = {'kind': geometry['type'], 'reason': None}
        flat = np.asarray(geometry['coordinates'], dtype=float).reshape(-1, 2)
        if not np.all(np.isfinite(to_crs.transform(flat[:, 0], flat[:, 1]))):     # far from the mosaic's zone
            return dict(out, valid_pixels=0, reason='outside_raster')
        shape, inside = shapes(geometry, to_crs)
        out.update(shape_size(geometry['type'], shape))
        # A spot: its own pixel (what it measures is a few pixels around it)
        reach = shape.buffer(abs(ds.transform.a) / 4) if geometry['type'] == 'Point' else inside
        try:
            window = from_bounds(*reach.bounds, transform=ds.transform).round_offsets().round_lengths() \
                .intersection(Window(0, 0, ds.width, ds.height))
        except WindowError:         # not over the mosaic
            window = None
        covered = 0
        if window is not None and window.width > 0 and window.height > 0:
            scale = max(1.0, max(window.width, window.height) / VISUAL_COVER_PX)
            size = (max(1, int(round(window.height / scale))), max(1, int(round(window.width / scale))))
            mask = ds.dataset_mask(window=window, out_shape=size) > 0
            transform = ds.window_transform(window) @ rasterio.Affine.scale(window.width / size[1], window.height / size[0])
            covered = int((mask & region_mask(reach, size, transform)).sum())
    out['valid_pixels'] = covered
    if not covered:
        out['reason'] = 'outside_raster'
    return out


def ground_heights(path, geometry):
    """The ground's heights (path: the DSM's copy the Heights tab reads) at a spot, {height}, or in an area, {heights:
    {min, mean, max}}; None where the DSM has none. Nothing for a line"""
    if geometry['type'] not in ('Point', 'Polygon'):
        return {}
    r = mosaic_measure(path, 'C', geometry)      # heights stay far above the no-data marker of °C
    if geometry['type'] == 'Point':
        return {'height': r.get('value')}
    return {'heights': {k: r[k] for k in ('min', 'mean', 'max')} if r.get('valid_pixels') else None}


def source_frames(frames, x, y, valid):
    """The source frames' names at points (in the raster's CRS) where valid, else None"""
    import rasterio
    path, band, names = frames
    with rasterio.open(path) as ds:
        found = [v[0] for v in ds.sample(zip(x, y), indexes=band)]
    out = []
    for value, ok in zip(found, valid):
        i = int(round(float(value))) if ok and np.isfinite(value) else -1
        out.append(names[i] if 0 <= i < len(names) else None)
    return out


# --- frames --------------------------------------------------------------------------------------------------------

def frame_rows(conversion):
    """The dataset's thermal frames as its analysis lists them, oblique ones included: [row]"""
    return [r for r in ((conversion.dataset.analysis or {}).get('files') or []) if r.get('kind') == 'thermal']


def listed_rows(conversion):
    """The frames the frame page lists: the thermal frames (frame_rows), or a visual mosaic of its own's visual frames,
    shown as they are and never measured: [row]"""
    from .thermal_analysis import is_visual
    if (conversion.mosaics or {}).get('visual_only'):
        return [r for r in ((conversion.dataset.analysis or {}).get('files') or []) if is_visual(r)]
    return frame_rows(conversion)


def visual_alone_frames(conversion):
    """The visual frames a visual mosaic of its own placed, in its order (its sidecar's), [] before it is built"""
    try:
        with open(os.path.join(conversion.data_dir(), thermal_mosaics.VIEWER_DIR, 'visual.json'), encoding='utf-8') as f:
            return [x['file'] for x in json.load(f).get('frames') or []]
    except (OSError, ValueError, KeyError, TypeError):
        return []


def frame_list(conversion):
    """The frames a conversion's frame page offers: [{path, pitch, time, lat, lon, converted, mosaic (index or None)}];
    a visual mosaic of its own's visual frames, each converted (shown as it is)"""
    alone = bool((conversion.mosaics or {}).get('visual_only'))
    converted = {f['path']: f for f in ((conversion.results or {}).get('files') or [])}
    placed = visual_alone_frames(conversion) if alone else (conversion.mosaics or {}).get('frames') or []
    in_mosaic = {name: i for i, name in enumerate(placed)}
    return [{'path': r['path'], 'pitch': r.get('pitch'), 'time': r.get('time') or "",
             'lat': r.get('lat'), 'lon': r.get('lon'),
             'converted': alone or bool((converted.get(r['path']) or {}).get('ok')),
             'mosaic': in_mosaic.get(r['path'])} for r in listed_rows(conversion)]


def frame_file(conversion, rel):
    """The full path of one of the conversion's frames (one its dataset's analysis lists), or MeasureError"""
    from .raster.security import path_traversal_check
    if not rel or rel not in {r['path'] for r in frame_rows(conversion)}:
        raise MeasureError("Not a frame of this flight")
    root = conversion.dataset.images_dir()
    path = os.path.join(root, rel)
    try:
        path_traversal_check(path, root)
    except Exception:
        raise MeasureError("Not a frame of this flight") from None
    if not os.path.isfile(path):
        raise MeasureError("The frame is not there any more")
    return path


def parse_changes(raw):
    """The measurement parameters asked to change ({field: value}, blanks left out), checked as the Convert form's"""
    changes = {}
    for field in CHANGES:
        value = (raw or {}).get(field)
        if not thermal_conversion.blank(value):
            changes[field] = value
    if not changes:
        return {}
    checked, errors = thermal_conversion.parse_settings(changes)
    errors = {k: v for k, v in errors.items() if k in CHANGES}
    if errors:
        field, message = next(iter(errors.items()))
        raise MeasureError("{}: {}".format(field.replace('_', ' ').capitalize(), message))
    return {field: checked[field] for field in changes}


def frame_settings(conversion, changes=None):
    """
    The conversion's settings for measuring a frame as it converted them, with the changes: a normalized
    conversion's frames take the normalization's ambient and reflected temperatures (unless given)
    """
    options = dict(conversion.options or {})
    unit = options.get('unit') or 'C'
    norm = (conversion.results or {}).get('normalization')
    if options.get('normalize') and norm:
        for field, key in (('ambient_temp', 'ambient_c'), ('reflected_temp', 'reflected_c')):
            if options.get(field) is None and norm.get(key) is not None:
                options[field] = from_celsius(norm[key], unit)
    options.update(changes or {})
    settings, errors = thermal_conversion.parse_settings(options)
    if errors:
        raise MeasureError(next(iter(errors.values())))
    return settings


def measured_as(conversion):
    """The dataset whose settings measure a frame of this one: an orthophoto imported from a task sent to WebODM from
    one of the flight's datasets, that dataset (while it is there); any other, itself (one imported otherwise has no
    settings: each frame's own parameters)"""
    from .models import WebODMTask
    imported = (conversion.options or {}).get('imported') or {}
    if imported.get('from') != 'webodm' or not imported.get('task'):
        return conversion
    task = WebODMTask.objects.select_related('conversion').filter(
        task_id=imported['task'], conversion__dataset_id=conversion.dataset_id).first()
    return task.conversion if task else conversion


def frame_offset(conversion, rel):
    """The offset (in the unit) a normalized conversion subtracted from a frame: (offset, known)"""
    if not (conversion.options or {}).get('normalize'):
        return 0.0, True
    for f in (conversion.results or {}).get('files') or []:
        if f.get('path') == rel and f.get('offset_c') is not None:
            return difference_in((conversion.options or {}).get('unit') or 'C', f['offset_c']), True
    return 0.0, False


@lru_cache(maxsize=FRAME_CACHE)
def measured(path, mtime, settings_items):
    """dji-thermal-cli's measurement of a frame (cached: the page asks for it again for its values and each point)"""
    from dji_thermal_cli import api
    settings = dict(settings_items)
    m = api.measure(path, thermal_conversion.api_arguments(settings)['settings'], settings['unit'])
    values = no_data(m.temperature, settings['unit'])
    values.setflags(write=False)
    return values, dict(m.params), m.distance_source, list(m.notes)


def measure_frame(conversion, rel, changes=None):
    """
    A frame's temperatures as the conversion converted it (with the changes, if any): {values, params,
    distance_source, notes, offset, offset_known, settings}. Raises MeasureError for a frame it can't measure.
    """
    path = frame_file(conversion, rel)
    conversion = measured_as(conversion)
    settings = frame_settings(conversion, changes)
    items = tuple(sorted((k, tuple(v) if isinstance(v, list) else v) for k, v in settings.items()))
    try:
        values, params, source, notes = measured(path, os.stat(path).st_mtime_ns, items)
    except MeasureError:
        raise
    except Exception as e:
        raise MeasureError("dji-thermal-cli could not measure the frame: {}".format(e)) from e
    offset, known = frame_offset(conversion, rel)
    if offset:
        values = values - offset
    return {'values': values, 'params': params, 'distance_source': source, 'notes': notes, 'offset': offset,
            'offset_known': known, 'settings': {f: settings[f] for f in CHANGES}}


def frame_measure(values, geometry, isotherm=None):
    """What a geometry (pixel x/y) measures on a frame's values, or the whole frame's statistics without one"""
    from affine import Affine
    if geometry is None:
        return dict(value_stats(values, isotherm), kind='frame')
    shape, inside = shapes(geometry, sizes=FRAME_SHAPES)
    out = {'kind': geometry['type'], 'reason': None}
    out.update(shape_size(geometry['type'], shape))
    out.update(region_stats(values, Affine.identity(), inside, isotherm,
                            lambda row, col: [col + 0.5, row + 0.5]))
    if geometry['type'] == 'Point':
        row, col = int(math.floor(shape.y)), int(math.floor(shape.x))
        inside_grid = 0 <= row < values.shape[0] and 0 <= col < values.shape[1]
        out['value'] = float(values[row, col]) if inside_grid and np.isfinite(values[row, col]) else None
    if geometry['type'] == 'LineString':
        distances, x, y = profile_points(shape, 1.0)
        out['profile'] = {'distance': distances.tolist(),
                          'values': grid_values(values, Affine.identity(), x, y).tolist(),
                          'points': [[float(a), float(b)] for a, b in zip(x, y)]}
    if out['valid_pixels'] == 0:
        out['reason'] = 'nodata'
    return out
