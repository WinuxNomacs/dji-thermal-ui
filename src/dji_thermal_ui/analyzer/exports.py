"""
Exports: a flight's frames as their originals, temperature TIFFs, coloured PNGs or R-JPEGs, each also private (no
location or personal information), and a conversion's mosaics as TIFF or PNG. A frame is made from its source when
it is exported, with a conversion's settings (or the flight's embedded values) and the view's colouring
(colouring.py, as the browser colours it). Several files are a zip, each frame made as the zip reaches it.
"""
import dataclasses
import io
import os
import re
import secrets
import tempfile
import threading
import time
import zlib
from pathlib import Path

import numpy as np

from . import colouring, thermal_conversion, thermal_measure, thermal_mosaics

FRAME_FORMATS = ('original', 'original_private', 'tiff', 'tiff_private', 'png', 'rjpeg', 'rjpeg_private')
MOSAIC_FORMATS = ('tiff', 'tiff_private', 'png')
PICTURES = ('view', 'original')
# What an R-JPEG or an original can't carry: the temperatures a conversion normalized or replaced
CARRIES_PARAMETERS_ONLY = ('original', 'original_private', 'rjpeg', 'rjpeg_private')
CARRY_HINT = "export them as TIFF, which holds the temperatures as converted"
AUTO_PERCENTILES = (2, 98)      # the range when none is given, as the frame page's Auto
SAMPLE_STEP = 8                 # every this many pixels of each frame (in both directions) for a shared range
KEEP_SECONDS = 3600             # how long an export asked for can be downloaded
STRIP_ROWS = 256                # the rows of a mosaic's PNG coloured at once
NOTES_FILE = 'export-notes.txt'

_asked = {}
_asked_lock = threading.Lock()


class ExportError(ValueError):
    pass


# --- what is asked ---------------------------------------------------------------------------------------------------

def keep(request):
    """An export asked for, kept for KEEP_SECONDS: its id"""
    now = time.monotonic()
    token = secrets.token_hex(16)
    with _asked_lock:
        for t in [t for t, (at, _) in _asked.items() if now - at > KEEP_SECONDS]:
            del _asked[t]
        _asked[token] = (now, request)
    return token


def kept(token):
    """The export asked for with this id, or None (unknown, or older than KEEP_SECONDS)"""
    with _asked_lock:
        found = _asked.get(token)
    if not found or time.monotonic() - found[0] > KEEP_SECONDS:
        return None
    return found[1]


def check_view(raw, unit):
    """The view's colouring as asked ({palette, range, gamma, equalize, sharpen, isotherm}), checked: {palette (key or
    None), range ((low, high) or None), adjust, isotherm ((low, high) or None)}"""
    raw = raw if isinstance(raw, dict) else {}
    try:
        adjust = thermal_measure.parse_adjust({k: '' if raw.get(k) is None else str(raw.get(k))
                                               for k in ('gamma', 'sharpen')} |
                                              {'equalize': '1' if raw.get('equalize') else '0'})
        isotherm = colouring.isotherm_range(thermal_measure.parse_isotherm(raw.get('isotherm') or None))
    except thermal_measure.MeasureError as e:
        raise ExportError(str(e)) from None
    value_range = raw.get('range')
    if value_range is not None:
        try:
            low, high = (float(v) for v in value_range)
        except (TypeError, ValueError):
            raise ExportError("The range is [low, high]") from None
        if not (np.isfinite(low) and np.isfinite(high) and high > low):
            raise ExportError("The range's maximum must be above its minimum")
        value_range = (low, high)
    palette = raw.get('palette')
    if palette is not None and not isinstance(palette, str):
        raise ExportError("The palette is a palette's key")
    return {'palette': palette or None, 'range': value_range, 'adjust': adjust, 'isotherm': isotherm, 'unit': unit}


def check_frames(dataset, conversion, raw, unit):
    """
    A frames export as asked ({format, frames (paths, or none: all), changes, view, picture, visual}), checked
    against the flight and the conversion (or None: the flight's embedded values): the request to keep, or ExportError
    """
    fmt = raw.get('format')
    if fmt not in FRAME_FORMATS:
        raise ExportError("The format is one of " + ", ".join(FRAME_FORMATS))
    rows = [r for r in (dataset.analysis or {}).get('files') or [] if r.get('kind') == 'thermal']
    known = [r['path'] for r in rows]
    frames = raw.get('frames')
    if frames is None:
        frames = known
    elif not (isinstance(frames, list) and all(isinstance(f, str) for f in frames)):
        raise ExportError("frames is a list of the flight's frames")
    elif set(frames) - set(known):
        raise ExportError("Not a frame of this flight: " + sorted(set(frames) - set(known))[0])
    if not frames:
        raise ExportError("No frames to export")
    try:
        changes = thermal_measure.parse_changes(raw.get('changes'))
    except thermal_measure.MeasureError as e:
        raise ExportError(str(e)) from None
    settings = frame_settings(conversion, changes, unit)
    if fmt in CARRIES_PARAMETERS_ONLY:
        if conversion is not None and (conversion.options or {}).get('normalize'):
            raise ExportError("{} can't carry the temperatures a normalized conversion made: {}".format(
                LABELS[fmt], CARRY_HINT))
        if any(settings.get(f) is not None for f in ('replace_above', 'replace_below')):
            raise ExportError("{} can't carry replaced temperatures: {}".format(LABELS[fmt], CARRY_HINT))
    picture = raw.get('picture') or 'view'
    if picture not in PICTURES:
        raise ExportError("The picture is view or original")
    visual = bool(raw.get('visual')) and fmt in ('original', 'original_private')
    return {'kind': 'frames', 'dataset': dataset.id, 'conversion': conversion.id if conversion else None,
            'format': fmt, 'frames': sorted(dict.fromkeys(frames)), 'changes': changes,
            'view': check_view(raw.get('view'), settings['unit']), 'picture': picture, 'visual': visual}


def check_mosaic(conversion, tab, raw, correction):
    """A mosaic export as asked ({format, view}): the request to keep, or ExportError"""
    fmt = raw.get('format')
    if fmt not in MOSAIC_FORMATS:
        raise ExportError("The format is one of " + ", ".join(MOSAIC_FORMATS))
    unit = (conversion.mosaics or {}).get('unit') or 'C'
    return {'kind': 'mosaic', 'conversion': conversion.id, 'tab': tab, 'format': fmt,
            'view': check_view(raw.get('view'), unit), 'correction': correction}


LABELS = {'original': "Original", 'original_private': "Original (Private)", 'tiff': "TIFF",
          'tiff_private': "TIFF (Private)", 'png': "PNG", 'rjpeg': "R-JPEG", 'rjpeg_private': "R-JPEG (Private)"}


# --- the frames -----------------------------------------------------------------------------------------------------

def frame_settings(conversion, changes, unit):
    """The settings a frame is measured with: the conversion's (as its frame page measures them), else
    dji-thermal-cli's defaults (the frames' embedded values) in the unit, with the changes"""
    try:
        if conversion is not None:
            return thermal_measure.frame_settings(conversion, changes)
        settings, errors = thermal_conversion.parse_settings(dict(changes or {}, unit=unit))
    except thermal_measure.MeasureError as e:
        raise ExportError(str(e)) from None
    if errors:
        raise ExportError(next(iter(errors.values())))
    return settings


def frame_path(dataset, rel):
    from .raster.security import path_traversal_check
    root = dataset.images_dir()
    path = path_traversal_check(os.path.join(root, rel), root)
    if not os.path.isfile(path):
        raise ExportError("The frame is not there any more")
    return path


def frame_offset(conversion, rel):
    """What a normalized conversion subtracted from a frame (°C), 0 otherwise"""
    if conversion is None or not (conversion.options or {}).get('normalize'):
        return 0.0
    return next((f.get('offset_c') or 0.0 for f in (conversion.results or {}).get('files') or []
                 if f.get('path') == rel), 0.0)


def frame_values(dataset, conversion, rel, changes, unit):
    """A frame's temperatures (NaN where there are none), as its frame page measures them"""
    if conversion is not None:
        try:
            return thermal_measure.measure_frame(conversion, rel, changes)['values']
        except thermal_measure.MeasureError as e:
            raise ExportError(str(e)) from None
    path = frame_path(dataset, rel)
    settings = frame_settings(None, changes, unit)
    items = tuple(sorted((k, tuple(v) if isinstance(v, list) else v) for k, v in settings.items()))
    try:
        return thermal_measure.measured(path, os.stat(path).st_mtime_ns, items)[0]
    except Exception as e:
        raise ExportError("dji-thermal-cli could not measure the frame: {}".format(e)) from e


def cli_settings(settings, private):
    """dji-thermal-cli's Settings for these (checked) settings, private or not as the format says"""
    return dataclasses.replace(thermal_conversion.api_arguments(settings)['settings'], strip_location=private)


def palette_colors(key, frame):
    """A palette (a key as the viewer offers them: DJI's from the frames, or the tiler's) as encoded colours"""
    from .raster.tiler import colormap_entries
    from .api import DJI_PREFIX, VIEWER_COLORMAPS, encoded, frame_palettes
    if key.startswith(DJI_PREFIX):
        lut = frame_palettes(frame, os.stat(frame).st_mtime_ns).get(key[len(DJI_PREFIX):])
        if lut:
            return encoded(lut)
    elif key in VIEWER_COLORMAPS:
        return colormap_entries([key])[0]['color_map']
    raise ExportError("Not a palette: " + key)


def default_palette(conversion):
    """The palette when none is asked: the preferences', else the conversion's own, else ironbow"""
    from .api import DJI_PREFIX, app_palette
    preferred = app_palette()
    if preferred:
        return preferred
    name = (conversion.options or {}).get('palette') if conversion is not None else None
    return DJI_PREFIX + name if name else 'ironbow'


def auto_range(values):
    v = values[np.isfinite(values)]
    if not v.size:
        return 0.0, 1.0
    low, high = (float(p) for p in np.percentile(v, AUTO_PERCENTILES))
    return (low, high) if high > low else (low - 0.5, low + 0.5)


def shared_view(view, samples):
    """The view's range (the one asked, else AUTO_PERCENTILES of the frames' samples) and the equalization over the
    samples when asked: (range, curve or None)"""
    values = np.concatenate([s.ravel() for s in samples]) if samples else np.zeros(0)
    value_range = view['range'] or auto_range(values)
    curve = None
    if view['adjust']['equalize']:
        curve = thermal_measure.equalization(thermal_measure.value_histogram(values, value_range), *value_range)
    return value_range, curve


def coloured(values, view, colors, value_range, curve):
    shares = thermal_measure.curve_shares(*value_range, view['adjust'], curve)
    return colouring.colour(values, colors, value_range, shares, view['adjust']['sharpen'], view['isotherm'])


def png_bytes(rgba):
    from PIL import Image
    out = io.BytesIO()
    Image.fromarray(rgba).save(out, 'PNG')       # no metadata: a PNG the app makes holds no location
    return out.getvalue()


def tiff_bytes(path, settings, offset_c, private):
    """The frame's temperatures as dji-thermal-cli writes them in a conversion (temp_c/temp_f TIFF)"""
    from dji_thermal_cli import core
    s = cli_settings(settings, private)
    product = 'temp_' + settings['unit'].lower()
    src = Path(path)
    with tempfile.TemporaryDirectory() as tmp:
        r = core.process_file(src, Path(tmp), src.parent, s.overrides(), None, None, None, ((product, 'tiff'),),
                              'deflate', s.adjustments(), offset_c or 0.0)
        if not r.ok or not r.outputs:
            raise ExportError(r.reason or "dji-thermal-cli wrote no TIFF")
        return Path(r.outputs[0]).read_bytes()


def rjpeg_bytes(path, settings, private, picture):
    from dji_thermal_cli import api
    try:
        return api.rjpeg_copy(path, cli_settings(settings, private), picture)
    except api.RJpegCopyError as e:
        raise ExportError(str(e)) from None


def private_copy(path):
    """An original without its location and personal information, still radiometric (a visual JPEG too)"""
    from dji_thermal_cli import rjpeg
    try:
        return rjpeg.copy(Path(path).read_bytes(), private=True)
    except (rjpeg.CopyError, ValueError) as e:
        raise ExportError("Its private copy could not be made: {}".format(e)) from None


def stem(rel):
    return os.path.splitext(rel)[0]


def visual_pairs(dataset, frames):
    """The visual images taken with these thermal frames: [(visual path, its thermal frame)], DJI's names telling which
    (the same folder and capture index: DJI_<time>_<index>_V.JPG beside _T)"""
    from .thermal_analysis import is_visual

    def key(rel):
        m = re.search(r'_(\d+)_[A-Z]\.jpe?g$', rel, re.IGNORECASE)
        return (os.path.dirname(rel), m.group(1)) if m else None
    wanted = {key(f): f for f in frames}
    return [(r['path'], wanted[key(r['path'])]) for r in (dataset.analysis or {}).get('files') or []
            if is_visual(r) and key(r['path']) in wanted]


def frame_file(dataset, conversion, request, rel, unit, shared=None):
    """One frame exported as asked: (its name in the export, its bytes). shared: the range and curve of several frames"""
    fmt, view = request['format'], request['view']
    path = frame_path(dataset, rel)
    if fmt == 'original':
        return rel, Path(path).read_bytes()
    if fmt == 'original_private':
        return rel, private_copy(path)
    settings = frame_settings(conversion, request['changes'], unit)
    private = fmt.endswith('_private')
    if fmt in ('tiff', 'tiff_private'):
        return '{}_temp_{}.tiff'.format(stem(rel), settings['unit'].lower()), \
            tiff_bytes(path, settings, frame_offset(conversion, rel), private)
    picture = None
    if fmt == 'png' or request['picture'] == 'view':
        values = frame_values(dataset, conversion, rel, request['changes'], unit)
        if shared is None:
            value_range = view['range'] or auto_range(values)
            curve = thermal_measure.equalization(thermal_measure.value_histogram(values, value_range), *value_range) \
                if view['adjust']['equalize'] else None
        else:
            value_range, curve = shared
        colors = palette_colors(view['palette'] or default_palette(conversion), path)
        rgba = coloured(values, view, colors, value_range, curve)
        if fmt == 'png':
            return stem(rel) + '.png', png_bytes(rgba)
        picture = np.ascontiguousarray(rgba[..., :3])
    return stem(rel) + '_rjpeg.jpg', rjpeg_bytes(path, settings, private, picture)


def needs_shared_view(request):
    return request['format'] == 'png' or (request['format'] in ('rjpeg', 'rjpeg_private') and request['picture'] == 'view')


def frames_export(dataset, conversion, request, unit):
    """
    The export's files: (name of the download, [(name, bytes)] for one file, or a generator of zip bytes). One frame
    is made at once (an error raised as ExportError); several are each made as the zip reaches them, and those that
    can't be made are listed in NOTES_FILE.
    """
    frames, fmt = request['frames'], request['format']
    base = '{}-{}'.format(dataset.name, fmt.replace('_', '-'))
    if len(frames) == 1 and not request['visual']:
        name, data = frame_file(dataset, conversion, request, frames[0], unit)
        return os.path.basename(name), data

    def stream():
        from zipstream import ZipStream
        zs = ZipStream(compress_type=zipstream_stored(), sized=False)
        zs.comment = "Generated by dji-thermal-ui"
        notes = []
        shared = None
        if needs_shared_view(request) and (request['view']['range'] is None or request['view']['adjust']['equalize']):
            samples = []
            for rel in frames:
                try:
                    values = frame_values(dataset, conversion, rel, request['changes'], unit)
                    samples.append(np.asarray(values[::SAMPLE_STEP, ::SAMPLE_STEP], dtype=np.float32))
                except ExportError:
                    pass        # noted when the frame itself is made
            shared = shared_view(request['view'], samples)
        elif needs_shared_view(request):
            shared = (request['view']['range'], None)
        for rel in frames:
            try:
                name, data = frame_file(dataset, conversion, request, rel, unit, shared)
            except ExportError as e:
                notes.append("{}: {}".format(rel, e))
                continue
            zs.add(data, name)
            yield from zs.all_files()
        if request['visual']:
            for rel, _thermal in visual_pairs(dataset, frames):
                try:
                    path = frame_path(dataset, rel)
                    data = private_copy(path) if fmt == 'original_private' else Path(path).read_bytes()
                except ExportError as e:
                    notes.append("{}: {}".format(rel, e))
                    continue
                zs.add(data, rel)
                yield from zs.all_files()
        if notes:
            zs.add("Not exported:\n" + "\n".join(notes) + "\n", NOTES_FILE)
        yield from zs.finalize()
    return base + '.zip', stream()


def zipstream_stored():
    """Frames are compressed already (JPEG, Deflate TIFF, PNG): stored as they are"""
    from zipfile import ZIP_STORED
    return ZIP_STORED


# --- the mosaics ----------------------------------------------------------------------------------------------------

def private_mosaic(path, kept_dir):
    """The mosaic's GeoTIFF without its georeference and dji-thermal-cli's record (which places its frames), as
    dji-thermal-cli writes a mosaic with --strip-location: written once beside the viewer's files and kept"""
    import warnings

    import rasterio
    from rasterio.errors import NotGeoreferencedWarning
    os.makedirs(kept_dir, exist_ok=True)
    out = os.path.join(kept_dir, 'private-' + os.path.basename(path))
    if os.path.isfile(out) and os.stat(out).st_mtime_ns >= os.stat(path).st_mtime_ns:
        return out
    with rasterio.open(path) as src:
        profile = dict(driver='GTiff', width=src.width, height=src.height, count=src.count, dtype=src.dtypes[0],
                       nodata=src.nodata, compress='deflate', tiled=True)
        tmp = out + '.part'
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', NotGeoreferencedWarning)
            with rasterio.open(tmp, 'w', **profile) as dst:
                for i in range(1, src.count + 1):
                    dst.set_band_description(i, src.descriptions[i - 1] or '')
                for _, window in src.block_windows(1):
                    dst.write(src.read(window=window), window=window)
    os.replace(tmp, out)
    return out


def png_chunk(kind, data):
    return (len(data).to_bytes(4, 'big') + kind + data +
            (zlib.crc32(kind + data) & 0xFFFFFFFF).to_bytes(4, 'big'))


def png_stream(width, height, strips, channels=4):
    """A PNG written as its rows come (strips: (rows, width, channels) uint8 arrays, top to bottom), never held whole"""
    yield b'\x89PNG\r\n\x1a\n'
    yield png_chunk(b'IHDR', width.to_bytes(4, 'big') + height.to_bytes(4, 'big') +
                    bytes([8, 6 if channels == 4 else 2, 0, 0, 0]))
    z = zlib.compressobj(6)
    for strip in strips:
        rows = np.concatenate([np.zeros((strip.shape[0], 1), np.uint8), strip.reshape(strip.shape[0], -1)], axis=1)
        data = z.compress(rows.tobytes())
        if data:
            yield png_chunk(b'IDAT', data)
    yield png_chunk(b'IDAT', z.flush())
    yield png_chunk(b'IEND', b'')


def mosaic_png(conversion, path, band, request, colors, value_range, curve):
    """A mosaic tab coloured at full resolution, as a PNG streamed strip by strip (clear where it has no data)"""
    import rasterio
    from rasterio.windows import Window
    view, correction = request['view'], request['correction']
    unit = (conversion.mosaics or {}).get('unit') or 'C'
    with rasterio.open(path) as src:
        width, height = src.width, src.height
    index = request['tab'] == 'source_frame'
    shares = None if index else thermal_measure.curve_shares(*value_range, view['adjust'], curve)

    def strips():
        with rasterio.open(path) as src:
            for first in range(0, height, STRIP_ROWS):
                stop = min(first + STRIP_ROWS, height)
                top, bottom = max(0, first - colouring.MARGIN), min(height, stop + colouring.MARGIN)
                read = src.read(band, window=Window(0, top, width, bottom - top), masked=True)
                values = mosaic_band_values(read.astype(np.float64).filled(np.nan),
                                                thermal_mosaics.temperatures(request['tab'], band), unit, correction)
                rows = (first - top, stop - top)
                if index:
                    yield colouring.colour(values, colors, index=True, rows=rows)
                else:
                    yield colouring.colour(values, colors, value_range, shares, view['adjust']['sharpen'],
                                           view['isotherm'], rows=rows)
    return png_stream(width, height, strips())


def mosaic_band_values(values, temperatures, unit, correction):
    """A mosaic band's values as the viewer's tiles have them (mosaic_values): temperatures without the no-data
    marker and corrected as asked, NaN where there are none"""
    if not temperatures:
        return values
    values = thermal_measure.no_data(values, unit)
    return thermal_measure.corrected(values, unit, correction) if correction else values


def stats_range(stats):
    """The viewer's range when none is given (defaultRange in viewer/view.ts): the tab's percentiles, to a tenth"""
    p = (stats or {}).get('percentiles') or []
    if len(p) < 2:
        return 0.0, 1.0
    low, high = np.floor(p[0] * 10) / 10, np.ceil(p[1] * 10) / 10
    return (float(low), float(high)) if high > low else (float(low), float(low) + 1)


def mosaic_export(conversion, request, colors=None, curve=None):
    """
    A mosaic exported as asked: (name of the download, a path to send or a generator of bytes). colors: the palette
    (or the source frames' colours), curve: the equalization over the view's range, for a PNG
    """
    tab, fmt, view = request['tab'], request['format'], request['view']
    found = thermal_mosaics.tab_raster(conversion, tab)
    visual = tab == thermal_mosaics.VISUAL
    if visual:
        v = (conversion.mosaics or {}).get(thermal_mosaics.VISUAL) or {}
        tif = next((f for f in v.get('files') or [] if f.endswith('.tif')), None)
        path, band = (os.path.join(conversion.data_dir(), tif) if tif else None), None
    elif found:
        path, band = found
    else:
        path = band = None
    if not path or not os.path.isfile(path):
        raise ExportError("The mosaic was not built")
    base = '{}-{}-{}'.format(conversion.dataset.name, conversion.name, tab.replace('_', '-'))
    if fmt == 'tiff':
        return base + '.tif', path
    if fmt == 'tiff_private':
        kept_dir = os.path.join(conversion.data_dir(), thermal_mosaics.VIEWER_DIR, 'private')
        return base + '-private.tif', private_mosaic(path, kept_dir)
    if visual:
        return base + '.png', visual_png(path)
    return base + '.png', mosaic_png(conversion, path, band, request, colors, view['range'], curve)


def visual_png(path):
    """The visual mosaic (red, green, blue, alpha) as a PNG streamed strip by strip"""
    import rasterio
    from rasterio.windows import Window
    with rasterio.open(path) as src:
        width, height = src.width, src.height

    def strips():
        with rasterio.open(path) as src:
            for first in range(0, height, STRIP_ROWS):
                rows = min(STRIP_ROWS, height - first)
                yield np.moveaxis(src.read(window=Window(0, first, width, rows)), 0, -1).astype(np.uint8)
    return png_stream(width, height, strips())
