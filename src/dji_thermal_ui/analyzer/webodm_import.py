"""A dataset imported from WebODM: the Import from WebODM dialog's browser (a project's completed tasks, with a
preview of each orthophoto and whether it lies over the flight), then the orthophoto (and its DSM) brought into a
dataset of its own.

WebODM pictures a colour orthophoto itself (its tasks' thumbnail); one of temperatures, a single band it won't
picture, is coloured here from its tiler's grey tiles, stretched over the values most of it holds."""

import io
import logging
import math
import os
import shutil
import threading
import time
import uuid
from collections import OrderedDict

import numpy as np
from django.utils import timezone

from . import colouring, exports, jobs, thermal_mosaics, webodm, webodm_tasks
from .thermal_analysis import clean

logger = logging.getLogger(__name__)

PREVIEW_SIZES = (256, 640)      # px across: a task's card, the chosen task
PREVIEWS_KEPT = 300             # previews kept in memory, the least recently used dropped first
PREVIEW_TILES = 2               # at most this many tiles across and down make a coloured preview
TILE_PX = 256
OVER_MARGIN = 0.0005            # degrees (about 50 m) added around the flight's photos when asking what lies over it
DEFAULT_PALETTE = 'ironbow'
IMPORT_DIR = 'import'           # in the dataset's folder: the files as they came, until they are read
PROGRESS_SECONDS = 1.0
DOWNLOAD_SHARE = 0.8            # of the progress, the downloads (the rest reading them)

_previews = OrderedDict()       # (WebODM's address, project, task, size) -> JPEG
_lock = threading.Lock()


def asset_names(task):
    """The orthophoto and DSM a WebODM task has: {'orthophoto': bool, 'dsm': bool}"""
    assets = task.get('available_assets') or []
    return {'orthophoto': 'orthophoto.tif' in assets, 'dsm': 'dsm.tif' in assets}


def flight_box(analysis):
    """Where a flight's photos (thermal and visual) were taken: (west, south, east, north), or None without a
    position"""
    points = [(r['lon'], r['lat']) for r in (analysis or {}).get('files') or []
              if r.get('lon') is not None and r.get('lat') is not None]
    if not points:
        return None
    lons, lats = [p[0] for p in points], [p[1] for p in points]
    return min(lons) - OVER_MARGIN, min(lats) - OVER_MARGIN, max(lons) + OVER_MARGIN, max(lats) + OVER_MARGIN


def overlaps(extent, box):
    """Whether a task's extent (WebODM's, west, south, east, north in degrees) meets a box"""
    if not box or not isinstance(extent, (list, tuple)) or len(extent) != 4:
        return False
    try:
        w, s, e, n = (float(v) for v in extent)
    except (TypeError, ValueError):
        return False
    return w <= box[2] and e >= box[0] and s <= box[3] and n >= box[1]


def ready_tasks(tasks, analysis):
    """A project's tasks that can be imported (completed, with an orthophoto), those over the flight first, the
    newest first within each; and how many others the project has: ([{id, name, created_at, images, processing_ms,
    dsm, extent, over}], others)"""
    box = flight_box(analysis)
    ready = []
    for t in tasks:
        if webodm.TASK_STATUSES.get(t.get('status')) != 'completed' or not asset_names(t)['orthophoto']:
            continue
        extent = t.get('extent') if isinstance(t.get('extent'), list) else None
        ready.append({'id': str(t.get('id')), 'name': t.get('name') or "", 'created_at': t.get('created_at'),
                      'images': t.get('images_count') or 0, 'processing_ms': t.get('processing_time'),
                      'dsm': asset_names(t)['dsm'], 'extent': extent, 'over': overlaps(extent, box)})
    ready.sort(key=lambda t: not t['over'])         # stable: WebODM's order, the newest first, within each
    return ready, len(tasks) - len(ready)


def preview(client, project, task, size, palette=None):
    """A JPEG of a task's orthophoto at most size px across: WebODM's own picture of a colour one, else its
    temperatures coloured with palette (the app's default palette when none); kept in memory"""
    key = (client.url, project, task, size)
    with _lock:
        if key in _previews:
            _previews.move_to_end(key)
            return _previews[key]
    try:
        jpeg = client.thumbnail(project, task, size)
    except webodm.WebODMError as e:
        if e.status != 404:
            raise
        jpeg = coloured(client, project, task, size, palette or DEFAULT_PALETTE)
    with _lock:
        _previews[key] = jpeg
        while len(_previews) > PREVIEWS_KEPT:
            _previews.popitem(last=False)
    return jpeg


def mercator(lon, lat, z):
    """A position as pixels of the world at zoom z (Web Mercator, as the tiles are)"""
    n = TILE_PX * 2 ** z
    lat = max(min(lat, 85.0511), -85.0511)
    x = (lon + 180) / 360 * n
    y = (1 - math.log(math.tan(math.radians(lat)) + 1 / math.cos(math.radians(lat))) / math.pi) / 2 * n
    return x, y


def preview_zoom(bounds):
    """The deepest zoom at which bounds (west, south, east, north) spans at most PREVIEW_TILES tiles each way"""
    for z in range(22, -1, -1):
        x0, y0 = mercator(bounds[0], bounds[3], z)
        x1, y1 = mercator(bounds[2], bounds[1], z)
        if (math.floor(x1 / TILE_PX) - math.floor(x0 / TILE_PX) < PREVIEW_TILES and
                math.floor(y1 / TILE_PX) - math.floor(y0 / TILE_PX) < PREVIEW_TILES):
            return z
    return 0


def coloured(client, project, task, size, palette):
    """A single-band orthophoto as a JPEG at most size px across: WebODM's grey tiles over the values between its
    2nd and 98th percentiles, coloured with palette, on white where it has no data"""
    from PIL import Image
    meta = client.metadata(project, task)
    bounds = meta.get('bounds')
    stats = next(iter((meta.get('statistics') or {}).values()), None)
    if not (isinstance(bounds, list) and len(bounds) == 4 and isinstance(stats, dict)):
        raise webodm.WebODMError("WebODM gave no bounds or statistics for the task's orthophoto")
    low, high = (stats.get('percentiles') or [stats.get('min'), stats.get('max')])[:2]
    if not all(isinstance(v, (int, float)) and math.isfinite(v) for v in (low, high)):
        raise webodm.WebODMError("WebODM gave no statistics for the task's orthophoto")
    if high <= low:
        high = low + 1
    z = preview_zoom(bounds)
    x0, y0 = mercator(bounds[0], bounds[3], z)
    x1, y1 = mercator(bounds[2], bounds[1], z)
    tx0, ty0, tx1, ty1 = (math.floor(v / TILE_PX) for v in (x0, y0, x1, y1))
    sheet = Image.new('LA', ((tx1 - tx0 + 1) * TILE_PX, (ty1 - ty0 + 1) * TILE_PX))
    for ty in range(ty0, ty1 + 1):
        for tx in range(tx0, tx1 + 1):
            try:
                png = client.tile(project, task, z, tx, ty, (low, high))
            except webodm.WebODMError as e:
                if e.status == 404:             # a tile outside the orthophoto
                    continue
                raise
            with Image.open(io.BytesIO(png)) as tile:
                sheet.paste(tile.convert('LA'), ((tx - tx0) * TILE_PX, (ty - ty0) * TILE_PX))
    left, top = int(x0 - tx0 * TILE_PX), int(y0 - ty0 * TILE_PX)
    crop = sheet.crop((left, top, max(left + 1, int(math.ceil(x1 - tx0 * TILE_PX))),
                       max(top + 1, int(math.ceil(y1 - ty0 * TILE_PX)))))
    crop.thumbnail((size, size))
    grey = np.asarray(crop, dtype='float32')
    values = np.where(grey[..., 1] > 0, grey[..., 0], np.nan)
    rgba = colouring.colour(values, exports.palette_colors(palette, None), (0.0, 255.0))
    rgb = np.where(np.isnan(values)[..., None], 255, rgba[..., :3]).astype('uint8')
    out = io.BytesIO()
    Image.fromarray(np.ascontiguousarray(rgb)).save(out, 'JPEG', quality=85)
    return out.getvalue()


# The import: a dataset (conversion) of its own, made while its files come ('converting', as a conversion is while its
# images are, so that its cancel and a job that stopped are handled as a conversion's), then ready with the
# orthophoto as its WebODM tab (temperatures) or its visual mosaic (colours), and the DSM as its Heights tab


class Stopped(Exception):
    """The import's run is no longer its own: canceled, or its dataset deleted"""


def start(dataset, name, imported, unit, files=None):
    """A dataset imported into a flight, its job queued on the uploads worker (it downloads); imported: where it
    comes from ({from: 'webodm', url, project, project_name, task, task_name, dsm, created_at, images,
    processing_ms} or {from: 'file', file, dsm_file}); files: the uploaded files of one from a file,
    {'orthophoto': file, 'dsm': file}, kept in its IMPORT_DIR for the job"""
    from .models import ThermalConversion
    conversion = ThermalConversion.objects.create(
        dataset=dataset, name=name, options={'imported': imported, 'unit': unit}, status='converting',
        stage={'stage': 'download' if imported['from'] == 'webodm' else 'read'}, run_id=uuid.uuid4().hex)
    folder = import_dir(conversion)
    os.makedirs(folder, exist_ok=True)
    for asset, f in (files or {}).items():
        dst = os.path.join(folder, asset + '.tif')
        if hasattr(f, 'temporary_file_path'):
            shutil.copyfile(f.temporary_file_path(), dst)       # a large upload is a temporary file already
        else:
            with open(dst, 'wb') as out:
                for chunk in f.chunks():
                    out.write(chunk)
    jobs.submit(run_import, conversion.pk, conversion.run_id, jobs.UPLOADS)
    conversion.refresh_from_db()
    return conversion


def import_dir(conversion):
    return os.path.join(conversion.data_dir(), IMPORT_DIR)


def current(pk, run_id, **fields):
    """Writes fields to the dataset while the run is still its own; Stopped when it is not"""
    from .models import ThermalConversion
    q = ThermalConversion.objects.filter(pk=pk, run_id=run_id, status='converting')
    if not (q.update(**fields) if fields else q.exists()):
        raise Stopped()


def orthophoto_kind(path):
    """What an orthophoto holds: 'thermal' (one band of floating point values, besides its alpha) or 'visual'
    (three of bytes); ValueError for anything else"""
    import rasterio
    from rasterio.enums import ColorInterp
    try:
        src = rasterio.open(path)
    except rasterio.errors.RasterioIOError:
        raise ValueError("The orthophoto is not a GeoTIFF that can be read") from None
    with src:
        if src.crs is None:
            raise ValueError("The orthophoto is not georeferenced")
        values = [i for i, c in enumerate(src.colorinterp) if c != ColorInterp.alpha]
        if len(values) == 1 and np.issubdtype(np.dtype(src.dtypes[values[0]]), np.floating):
            return 'thermal'
        if len(values) >= 3 and all(src.dtypes[i] == 'uint8' for i in values[:3]):
            return 'visual'
    raise ValueError("The orthophoto holds neither temperatures (one band of values) nor colours (red, green and "
                     "blue bytes)")


def visual(src_path, conversion):
    """A colour orthophoto kept as the dataset's visual mosaic: moved to its folder (the download) and copied for
    the map's tiles; what the dataset keeps of it, as a visual-only conversion's mosaics are"""
    from rio_tiler.constants import WGS84_CRS
    out_dir = conversion.data_dir()
    folder = os.path.join(out_dir, thermal_mosaics.MOSAICS_DIR, thermal_mosaics.VISUAL)
    os.makedirs(folder, exist_ok=True)
    os.makedirs(os.path.join(out_dir, thermal_mosaics.VIEWER_DIR), exist_ok=True)
    kept = os.path.join(folder, 'orthophoto.tif')
    os.replace(src_path, kept)
    tif = thermal_mosaics.map_copy(kept, os.path.join(out_dir, thermal_mosaics.VIEWER_DIR,
                                                      thermal_mosaics.VISUAL + '.tif'))
    with thermal_mosaics.open_raster(tif) as src:
        west, south, east, north = src.get_geographic_bounds(WGS84_CRS)
        zooms = {'minzoom': src.minzoom, 'maxzoom': src.maxzoom}
        res = src.dataset.res
        width, height = src.dataset.width, src.dataset.height
        metres = src.dataset.crs.is_projected
    rel = thermal_mosaics.relative
    return clean({'kinds': {}, 'frames': [], 'stripped': False, 'visual_only': True, 'imported': True,
                  thermal_mosaics.VISUAL: dict(zooms, bounds=[west, south, east, north], raster=rel(tif, out_dir),
                                               files=[rel(kept, out_dir)], frames=0, skipped=0,
                                               gsd_m=float(res[0]) if metres else None, width=width, height=height)})


def run_import(pk, run_id):
    """The import's job: the files downloaded from WebODM (or as uploaded), the orthophoto read as temperatures or
    colours, the DSM as heights; the dataset ready, or failed with what went wrong"""
    from .models import ThermalConversion
    try:
        conversion = ThermalConversion.objects.select_related('dataset').get(pk=pk, run_id=run_id)
    except ThermalConversion.DoesNotExist:
        return
    imported = (conversion.options or {}).get('imported') or {}
    unit = (conversion.options or {}).get('unit') or 'C'
    folder = import_dir(conversion)
    written = [0.0]
    try:
        os.makedirs(folder, exist_ok=True)
        if imported.get('from') == 'webodm':
            client = webodm.Client.from_config()
            wanted = [('orthophoto', webodm_tasks.ASSETS['orthophoto'])]
            if imported.get('dsm'):
                wanted.append(('dsm', webodm_tasks.ASSETS['dsm']))
            for i, (asset, name) in enumerate(wanted):
                def progress(done, total, i=i):
                    now = time.monotonic()
                    if total and now - written[0] >= PROGRESS_SECONDS:
                        written[0] = now
                        current(pk, run_id, progress=(i + done / total) / len(wanted) * DOWNLOAD_SHARE,
                                stage={'stage': 'download', 'asset': asset})
                    else:
                        current(pk, run_id)
                current(pk, run_id, stage={'stage': 'download', 'asset': asset})
                client.download(int(imported['project']), imported['task'], name,
                                os.path.join(folder, asset + '.tif'), progress)
        orthophoto = os.path.join(folder, 'orthophoto.tif')
        dsm_part = os.path.join(folder, 'dsm.tif')
        current(pk, run_id, progress=DOWNLOAD_SHARE, stage={'stage': 'read', 'asset': 'orthophoto'})
        kind = orthophoto_kind(orthophoto)
        fields = {'mosaics': {}, 'orthophoto': {}, 'dsm': {}}
        when = timezone.now().isoformat()
        source = {'task': None, 'task_name': imported.get('task_name') or imported.get('file') or "",
                  'downloaded_at': when}
        if kind == 'thermal':
            out = webodm_tasks.orthophoto_folder(conversion)
            os.makedirs(out, exist_ok=True)
            made = os.path.join(out, 'orthophoto.tif')
            info = thermal_mosaics.orthophoto(orthophoto, made, unit)
            fields['orthophoto'] = dict(info, unit=unit, raster=thermal_mosaics.WEBODM + '/orthophoto.tif', **source)
            os.remove(orthophoto)
        else:
            fields['mosaics'] = visual(orthophoto, conversion)
        current(pk, run_id)
        if os.path.exists(dsm_part):
            current(pk, run_id, stage={'stage': 'read', 'asset': 'dsm'})
            fields['dsm'] = dict(read_dsm(conversion, dsm_part), **source)
    except Stopped:
        shutil.rmtree(folder, ignore_errors=True)
        return
    except Exception as e:
        known = isinstance(e, (webodm.WebODMError, ValueError))
        if not known:
            logger.exception("The import of dataset %s failed", pk)
        shutil.rmtree(folder, ignore_errors=True)
        thermal_mosaics.remove(conversion)
        shutil.rmtree(webodm_tasks.orthophoto_folder(conversion), ignore_errors=True)
        ThermalConversion.objects.filter(pk=pk, run_id=run_id).update(
            status='failed', run_id="", progress=0, stage={}, finished_at=timezone.now(),
            error=str(e) if known else "The import failed: {}".format(e))
        webodm_tasks.update_size(pk)
        return
    shutil.rmtree(folder, ignore_errors=True)
    done = ThermalConversion.objects.filter(pk=pk, run_id=run_id).update(
        status='ready', run_id="", progress=1.0, stage={}, error="", finished_at=timezone.now(),
        results={'files': [], 'converted': 0, 'skipped': 0, 'imported': kind},
        mosaic_status='ready', **fields)
    if done:
        webodm_tasks.update_size(pk)


def read_dsm(conversion, src_path):
    """A DSM imported with the orthophoto, kept as it came beside the Heights tab's copy (as a WebODM task's DSM
    brought back is); not used to project mosaics (the dataset has none)"""
    from dji_thermal_cli import mosaic as dji_mosaic
    from pathlib import Path
    dsm = dji_mosaic.read_dsm(Path(src_path))
    if not np.isfinite(dsm.z).any():
        raise ValueError("The DSM holds no heights")
    rows, cols = dsm.z.shape
    out = webodm_tasks.orthophoto_folder(conversion)
    os.makedirs(out, exist_ok=True)
    name = 'dsm.tif'
    shown = thermal_mosaics.heights(src_path, os.path.join(out, webodm_tasks.heights_name(name)))
    os.replace(src_path, os.path.join(out, name))
    return dict(shown, width=cols, height=rows, pixel_m=round(dsm.pixel_m(), 4), use=False,
                height_cell=webodm_tasks.DSM_CELL, raster=thermal_mosaics.WEBODM + '/' + name,
                heights_raster=thermal_mosaics.WEBODM + '/' + webodm_tasks.heights_name(name))
