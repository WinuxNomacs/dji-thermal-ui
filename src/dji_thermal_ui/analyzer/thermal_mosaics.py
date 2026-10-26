"""
A conversion's mosaics: dji-thermal-cli's make_mosaic over the dataset's nadir frames, as converted and harmonized
(normalized), with the conversion's settings. Built by the conversion's job after the images (thermal_conversion.convert)
or later on their own (build_mosaics), and shown in the viewer, whose tiles and readout read them here.

Files, in the conversion's folder:
    mosaics/<kind>/mosaic_temp_<unit>.tif (+ .json), mosaic_preview.png    as dji-thermal-cli writes them (downloads)
    viewer/<kind>.tif (+ .json)    a georeferenced copy for the map, only when the conversion strips the location (the
                                   downloads are then stripped); never downloaded
    viewer/palettes.json           DJI's palettes, read from one of the frames
"""
import json
import os
import shutil
import time
import warnings
from pathlib import Path

from django.conf import settings as django_settings

from .thermal_analysis import Canceled, clean, relative, PROGRESS_INTERVAL
from .thermal_conversion import api_arguments, mosaic_stage, stage_fraction, stage_key

# The mosaics built: (kind, normalized)
KINDS = (('as_converted', False), ('harmonized', True))
# The viewer's tabs: (tab, kind whose file it reads, band)
TABS = (('as_converted', 'as_converted', 1), ('harmonized', 'harmonized', 1),
        ('source_frame', 'as_converted', 2), ('view_angle', 'as_converted', 3))
MOSAICS_DIR = 'mosaics'
VIEWER_DIR = 'viewer'       # served by the app only: left out of the downloads
PALETTES_FILE = 'palettes.json'
PERCENTILES = (2, 98)
ABSOLUTE_ZERO = {'C': -273.15, 'F': -459.67, 'K': 0.0}
# dji-thermal-cli's mosaic default (nadir frames), unless the conversion sets its own pitch limit
DEFAULT_MAX_PITCH = -80.0
# Long per-pair or per-frame lists of the report, left out of what is kept (the JSON sidecar has them all)
REPORT_DETAIL = ('pairs_detail', 'frames', 'per_frame')


def tab_raster(conversion_dir, mosaics, tab):
    """(path of the GeoTIFF a viewer tab reads, its band), or None when that mosaic was not built"""
    for name, kind, band in TABS:
        if name == tab:
            m = (mosaics.get('kinds') or {}).get(kind)
            if not m or not m.get('raster'):
                return None
            return os.path.join(conversion_dir, m['raster']), band
    return None


def low_value(unit):
    """Temperatures at or below this are dji-thermal-cli's no-data marker (absolute zero), not measurements"""
    return ABSOLUTE_ZERO.get(unit, ABSOLUTE_ZERO['C']) + 1


def band_stats(values):
    """min, max and the PERCENTILES of the finite values of an array, or None when there are none"""
    import numpy as np
    v = values[np.isfinite(values)]
    if v.size == 0:
        return None
    low, high = (float(p) for p in np.percentile(v, PERCENTILES))
    return {'min': float(v.min()), 'max': float(v.max()), 'percentiles': [low, high]}


def open_raster(path):
    """rio-tiler's Reader of a mosaic. The mosaics have no overviews, which only matters to the tiles of very large
    ones: rio-tiler's warning about it is not shown"""
    from rio_tiler.errors import NoOverviewWarning
    from rio_tiler.io import Reader
    with warnings.catch_warnings():
        warnings.simplefilter('ignore', NoOverviewWarning)
        return Reader(path)


def raster_info(path, unit):
    """Where a mosaic is (lon/lat bounds, zooms) and the range of its temperature and view angle bands"""
    import numpy as np
    from rio_tiler.constants import WGS84_CRS
    with open_raster(path) as src:
        west, south, east, north = src.get_geographic_bounds(WGS84_CRS)
        info = {'bounds': [west, south, east, north], 'minzoom': src.minzoom, 'maxzoom': src.maxzoom}
        temperature = src.dataset.read(1)
        temperature = np.where(temperature > low_value(unit), temperature, np.nan)
        info['temperature'] = band_stats(temperature)
        info['view_angle'] = band_stats(src.dataset.read(3))
    return info


def trimmed(value):
    """dji-thermal-cli's mosaic report without its long per-pair and per-frame lists"""
    if isinstance(value, dict):
        return {k: trimmed(v) for k, v in value.items() if k not in REPORT_DETAIL}
    if isinstance(value, list) and len(value) > 20:
        return None
    return value


def dji_palettes(jpegs):
    """DJI's palettes {name: [[r, g, b] x 256]} as the first R-JPEG that has them holds them, or {}"""
    from dji_thermal_cli import api, tsdk
    for path in jpegs:
        try:
            lut = tsdk.open(path.read_bytes()).get_pseudo_color_lut()     # (3, palettes, 256)
        except Exception:
            continue
        return {name: lut[:, i, :].T.astype(int).tolist()
                for i, name in enumerate(api.PALETTES) if i < lut.shape[1]}
    return {}


def remove(conversion):
    """Removes a conversion's mosaics and the viewer's files"""
    for d in (MOSAICS_DIR, VIEWER_DIR):
        shutil.rmtree(os.path.join(conversion.data_dir(), d), ignore_errors=True)


def build(conversion, run):
    """
    Builds a conversion's mosaics into its folder: {'kinds': {kind: ...}, 'frames': [names], 'unit', 'stripped'}.
    Raises Canceled when the run is no longer wanted (checked at each progress write), MosaicError when no mosaic can
    be made, and whatever else goes wrong.
    """
    from dji_thermal_cli import api
    from dji_thermal_cli import mosaic as dji_mosaic

    dataset = conversion.dataset
    root, out_dir = dataset.images_dir(), conversion.data_dir()
    if not os.path.isdir(root):
        raise Exception("The folder {} does not exist".format(root)
                        if dataset.source == 'folder' else "The dataset has no images")
    remove(conversion)
    os.makedirs(os.path.join(out_dir, VIEWER_DIR), exist_ok=True)

    options = conversion.options or {}
    args = api_arguments(options)
    settings, unit = args['settings'], options.get('unit') or 'C'
    stripped = bool(options.get('strip_location'))
    max_pitch = options.get('max_pitch')
    max_pitch = DEFAULT_MAX_PITCH if max_pitch is None else max_pitch

    jpegs = api.scan(root).jpegs
    with open(os.path.join(out_dir, VIEWER_DIR, PALETTES_FILE), 'w') as f:
        json.dump(dji_palettes(jpegs), f)

    state = {'written': time.time(), 'value': 0.0, 'stage': None}

    def write_progress(value, now=False, stage=None):
        """Writes the progress (at most every PROGRESS_INTERVAL, unless now) and the stage, and stops when the run is
        gone. The progress only moves forward"""
        state['value'] = max(state['value'], value)
        t = time.time()
        if now or t - state['written'] >= PROGRESS_INTERVAL:
            state['written'] = t
            if not run.update(mosaic_progress=min(0.99, state['value']), stage=stage or {}):
                raise Canceled()

    # Both mosaics are one run of stages (dji-thermal-cli's "mosaic" events), each step counting the same in the
    # progress; a cancel takes effect at the next write
    def progress(event):
        if event.kind == 'mosaic':
            key = stage_key(event)
            write_progress(stage_fraction(event.data), now=key != state['stage'], stage=mosaic_stage(event))
            state['stage'] = key

    write_progress(0, now=True)
    kind_dirs = {kind: os.path.join(out_dir, MOSAICS_DIR, kind) for kind, _ in KINDS}
    # The harmonized mosaic, and the as converted one from the same layout (aligned once)
    harmonized = api.make_mosaic(root, kind_dirs['harmonized'], settings,
                                 api.MosaicOptions(max_pitch=max_pitch, normalize=True, units=(unit,)),
                                 compression=args['compression'], jobs=django_settings.THERMAL_PROCESSES,
                                 progress=progress,
                                 as_converted_dir=kind_dirs['as_converted'])
    reports = {'as_converted': harmonized.as_converted, 'harmonized': harmonized}
    kinds, frames = {}, []
    for kind, _ in KINDS:
        report, kind_dir = reports[kind], kind_dirs[kind]
        tif = report.files[0][0]
        if stripped:
            # The downloads stay as dji-thermal-cli strips them; the map reads a located copy only the app serves
            tif, _ = dji_mosaic.write(report.mosaic, Path(out_dir, VIEWER_DIR, kind + '.tif'),
                                      args['compression'], unit, located=True)
        m = report.mosaic
        if not frames:
            frames = [row.get('file', '') for row in sorted(m.frames, key=lambda r: r.get('index', 0))]
        kinds[kind] = dict(raster_info(str(tif), unit), **{
            'raster': relative(tif, out_dir),
            'files': sorted(relative(os.path.join(kind_dir, f), out_dir) for f in os.listdir(kind_dir)),
            'frames': report.frames, 'oblique': report.oblique, 'unusable': report.unusable,
            'not_thermal': report.not_thermal, 'gsd_m': m.grid.gsd, 'width': m.grid.width, 'height': m.grid.height,
            'palette': report.palette, 'preview_range_c': list(report.preview_range_c),
            'normalization': list(report.normalize_ambient_c) if report.normalize_ambient_c else None,
            'report': trimmed(m.report),
        })
    return clean({'kinds': kinds, 'frames': frames, 'unit': unit, 'stripped': stripped})


def build_mosaics(conversion_id, run_id):
    """Builds a ready conversion's mosaics on their own (the conversion's "Build mosaics")"""
    from .models import ThermalConversion

    run = ThermalConversion.objects.filter(pk=conversion_id, run_id=run_id)
    conversion = run.select_related('dataset').first()
    if conversion is None:
        return {'canceled': True}
    return finish(conversion, run)


def finish(conversion, run):
    """Builds the mosaics and records the outcome on the conversion (only while its run is still this one)"""
    try:
        mosaics = build(conversion, run)
    except Canceled:
        return {'canceled': True}
    except Exception as e:
        # Nothing of a failed build is kept: it is not shown, and would only take up space
        remove(conversion)
        conversion.update_size()
        run.update(mosaic_status='failed', mosaic_error=str(e), mosaic_progress=0, stage={}, run_id="",
                   file_count=conversion.file_count, size=conversion.size)
        return {'error': str(e)}
    conversion.update_size()
    run.update(mosaic_status='ready', mosaic_error="", mosaic_progress=1.0, stage={}, mosaics=mosaics, run_id="",
               file_count=conversion.file_count, size=conversion.size)
    return {'mosaics': list(mosaics['kinds'])}
