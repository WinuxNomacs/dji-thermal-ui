"""
The cameras of a WebODM task (its shots.geojson and cameras.json): where each photo was taken from and how its lens
saw, enough to find a spot of WebODM's orthophoto in every photo of the flight that saw it, as a mosaic's frame models
do for the source frames window (thermal_sources). WebODM's orthophoto doesn't say which photo each pixel came from:
the most nadir one that saw it is taken as the one used.

A point is projected at the height of the dataset's DSM where it has one, else of the ground under the photos (their
positions less their height above it, as the drone recorded it). The cameras are kept in the dataset's
webodm/cameras.json with the task they came from: brought with an import, or fetched from WebODM the first time they
are needed. A photo's pixels are a column and a row with pixel centres at whole numbers, as OpenSfM's and
dji-thermal-cli's are.
"""
import json
import math
import os
import threading
from collections import OrderedDict

import numpy as np

from . import thermal_mosaics, webodm

CAMERAS_FILE = 'cameras.json'                   # in the dataset's webodm folder
ASSETS = ('shots.geojson', 'cameras.json')      # a task's cameras, as WebODM names them
LENSES = ('brown', 'perspective')               # OpenSfM's projections read here
EDGE_POINTS = 8             # a photo's footprint: this many points along each edge
DSM_SIZE = 2048             # the DSM's heights read at most this many pixels across
UNDISTORT_STEPS = 20
FOV_MARGIN = 1.05           # a point is seen within the photo's corners' angle off its axis, and this much more
KEPT = 8                    # models kept in memory, the least recently used dropped first

_kept = OrderedDict()
_lock = threading.Lock()


class CamerasError(Exception):
    """Why a task's cameras can't be had or read"""


def check(shots, cameras):
    """A task's shots.geojson and cameras.json, as read: ([shot], {camera id: lens}); CamerasError for anything else.
    A shot is {filename, camera, lens (its key in cameras.json: OpenSfM writes the shot's camera as "v2 " and it),
    width, height, translation (its position in UTM), rotation (world to camera, as an axis and angle), lonlat (its
    position, or None)}"""
    if not isinstance(shots, dict) or not isinstance(shots.get('features'), list):
        raise CamerasError("shots.geojson is not the task's shots (a GeoJSON FeatureCollection)")
    if not isinstance(cameras, dict) or not cameras:
        raise CamerasError("cameras.json is not the task's cameras")
    lenses = {}
    for key, c in cameras.items():
        if not isinstance(c, dict):
            raise CamerasError("cameras.json is not the task's cameras")
        kind = c.get('projection_type')
        if kind not in LENSES:
            raise CamerasError("The camera {} has a lens WebODM calls {}: only {} are read".format(
                key, kind, " and ".join(LENSES)))
        try:
            lenses[key] = {'kind': kind, 'width': int(c['width']), 'height': int(c['height']),
                           'fx': float(c['focal_x'] if kind == 'brown' else c['focal']),
                           'fy': float(c['focal_y'] if kind == 'brown' else c['focal']),
                           'cx': float(c.get('c_x') or 0.0), 'cy': float(c.get('c_y') or 0.0),
                           'k': [float(c.get(k) or 0.0) for k in ('k1', 'k2', 'k3')],
                           'p': [float(c.get(k) or 0.0) for k in ('p1', 'p2')]}
        except (KeyError, TypeError, ValueError):
            raise CamerasError("The camera {} in cameras.json lacks its size or focal length".format(key)) from None
    out = []
    for f in shots['features']:
        p = (f or {}).get('properties') or {}
        try:
            shot = {'filename': str(p['filename']), 'camera': str(p['camera']),
                    'translation': [float(v) for v in p['translation']][:3],
                    'rotation': [float(v) for v in p['rotation']][:3]}
        except (KeyError, TypeError, ValueError):
            raise CamerasError("A shot in shots.geojson lacks its file name, camera, position or rotation") from None
        if len(shot['translation']) < 3 or len(shot['rotation']) < 3:
            raise CamerasError("A shot in shots.geojson lacks its file name, camera, position or rotation")
        shot['lens'] = next((k for k in lenses if shot['camera'] in (k, 'v2 ' + k)), None)
        if shot['lens'] is None:
            raise CamerasError("The shot {} has a camera cameras.json doesn't hold".format(shot['filename']))
        lens = lenses[shot['lens']]
        coords = ((f.get('geometry') or {}).get('coordinates') or [])[:2]
        shot['lonlat'] = [float(v) for v in coords] if len(coords) == 2 else None
        shot['width'], shot['height'] = int(p.get('width') or lens['width']), int(p.get('height') or lens['height'])
        out.append(shot)
    if not out:
        raise CamerasError("shots.geojson holds no shots")
    return out, lenses


def path_of(conversion):
    return os.path.join(conversion.data_dir(), thermal_mosaics.WEBODM, CAMERAS_FILE)


def write(conversion, source, shots, cameras):
    """Keeps a task's cameras (source: the task they came from, source_of's key) in the dataset's folder, checked"""
    check(shots, cameras)
    path = path_of(conversion)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    part = path + '.part'
    with open(part, 'w', encoding='utf-8') as f:
        json.dump({'source': source, 'shots': shots, 'cameras': cameras}, f)
    os.replace(part, path)


def source_of(conversion):
    """Where the dataset's orthophoto came from, for its cameras: (key, (project, task) in WebODM or None); key None
    when it has none (no orthophoto from WebODM)"""
    imported = (conversion.options or {}).get('imported') or {}
    if imported.get('from') == 'webodm' and imported.get('task'):
        return 'task:' + imported['task'], (int(imported['project']), imported['task'])
    if imported:
        return 'file', None
    from .models import WebODMTask
    pk = (conversion.orthophoto or {}).get('task')
    task = WebODMTask.objects.filter(pk=pk, conversion=conversion).first() if pk else None
    if task is None or task.project_id is None or not task.task_id:
        return None, None
    return 'task:' + task.task_id, (task.project_id, task.task_id)


def fetch(client, project, task, folder):
    """A task's cameras from WebODM: (shots, cameras), as read; WebODMError when they can't be had"""
    out = []
    for asset in ASSETS:
        part = os.path.join(folder, asset + '.part')
        try:
            client.download(project, task, asset, part)
            with open(part, encoding='utf-8') as f:
                out.append(json.load(f))
        except ValueError:
            raise webodm.WebODMError("WebODM's {} for the task is not JSON".format(asset)) from None
        finally:
            if os.path.exists(part):
                os.remove(part)
    return tuple(out)


def kept(conversion):
    """The dataset's cameras for the orthophoto shown, fetched from WebODM when they aren't kept yet (or were another
    task's): {source, shots, cameras}, or None when there are none to be had (an orthophoto from a file without them);
    CamerasError when WebODM can't give them"""
    key, task = source_of(conversion)
    if key is None:
        return None
    path = path_of(conversion)
    try:
        with open(path, encoding='utf-8') as f:
            found = json.load(f)
        if found.get('source') == key:
            return found
    except (OSError, ValueError):
        pass
    if task is None:
        return None
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        shots, cameras = fetch(webodm.Client.from_config(), task[0], task[1], os.path.dirname(path))
        write(conversion, key, shots, cameras)
    except webodm.WebODMError as e:
        raise CamerasError("WebODM couldn't give the task's cameras: {}".format(e)) from None
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def models(conversion):
    """The cameras of the dataset's orthophoto as frame models (Cameras), or None when it has none; CamerasError when
    they can't be had"""
    found = kept(conversion)
    if found is None:
        return None
    path = path_of(conversion)
    dsm = (conversion.dsm or {}).get('raster')
    dsm = os.path.join(conversion.data_dir(), dsm) if dsm else None
    rows = (conversion.dataset.analysis or {}).get('files') or []
    key = (path, os.stat(path).st_mtime_ns, dsm, os.stat(dsm).st_mtime_ns if dsm and os.path.exists(dsm) else None,
           conversion.dataset_id, len(rows))
    with _lock:
        if key in _kept:
            _kept.move_to_end(key)
            return _kept[key]
    shots, lenses = check(found['shots'], found['cameras'])
    made = Cameras(shots, lenses, rows, dsm if dsm and os.path.exists(dsm) else None)
    with _lock:
        _kept[key] = made
        while len(_kept) > KEPT:
            _kept.popitem(last=False)
    return made


def matched(shots, rows):
    """Each shot's file of the flight (its analysis' path), or None: the same name, or the name a TIFF sent from here
    was given after it (DJI_…_T_temp_c.tiff is DJI_…_T.JPG), ignoring case"""
    names = {}
    for r in rows:
        stem = os.path.splitext(os.path.basename(r.get('path') or ""))[0].casefold()
        names.setdefault(stem, r)
    out = []
    for s in shots:
        stem = os.path.splitext(os.path.basename(s['filename']))[0].casefold()
        while stem not in names and '_' in stem:
            stem = stem.rsplit('_', 1)[0]
        out.append(names.get(stem))
    return out


def rotation(r):
    """The rotation matrix of an axis and angle (Rodrigues)"""
    r = np.asarray(r, float)
    theta = np.linalg.norm(r)
    if theta < 1e-12:
        return np.eye(3)
    k = r / theta
    K = np.array([[0, -k[2], k[1]], [k[2], 0, -k[0]], [-k[1], k[0], 0]])
    return np.eye(3) + math.sin(theta) * K + (1 - math.cos(theta)) * K @ K


def distort(lens, x, y):
    """Normalized camera coordinates through the lens: OpenSfM's normalized image coordinates"""
    r2 = x * x + y * y
    k1, k2, k3 = lens['k']
    radial = 1 + r2 * (k1 + r2 * (k2 + r2 * k3))
    p1, p2 = lens['p']
    xd = x * radial + 2 * p1 * x * y + p2 * (r2 + 2 * x * x)
    yd = y * radial + p1 * (r2 + 2 * y * y) + 2 * p2 * x * y
    return lens['fx'] * xd + lens['cx'], lens['fy'] * yd + lens['cy']


def undistort(lens, u, v):
    """OpenSfM's normalized image coordinates back to normalized camera coordinates (distort's inverse, iterated)"""
    xd, yd = (u - lens['cx']) / lens['fx'], (v - lens['cy']) / lens['fy']
    x, y = xd, yd
    k1, k2, k3 = lens['k']
    p1, p2 = lens['p']
    for _ in range(UNDISTORT_STEPS):
        r2 = x * x + y * y
        radial = 1 + r2 * (k1 + r2 * (k2 + r2 * k3))
        x = (xd - 2 * p1 * x * y - p2 * (r2 + 2 * x * x)) / radial
        y = (yd - p1 * (r2 + 2 * y * y) - 2 * p2 * x * y) / radial
    return x, y


def to_pixels(u, v, width, height):
    size = max(width, height)
    return u * size - 0.5 + width / 2.0, v * size - 0.5 + height / 2.0


def from_pixels(px, py, width, height):
    size = max(width, height)
    return (px + 0.5 - width / 2.0) / size, (py + 0.5 - height / 2.0) / size


def utm_epsg(shots):
    """The UTM zone the shots' positions are in: the one their lon/lat lands on their position in"""
    from pyproj import Transformer
    placed = [s for s in shots if s['lonlat']]
    if not placed:
        raise CamerasError("shots.geojson doesn't say where its shots are")
    s = placed[0]
    lon, lat = s['lonlat']
    zone = int((lon + 180) // 6) % 60 + 1
    best = None
    for z in (zone, zone % 60 + 1, (zone - 2) % 60 + 1):
        for epsg in (32600 + z, 32700 + z):
            e, n = Transformer.from_crs("EPSG:4326", "EPSG:%d" % epsg, always_xy=True).transform(lon, lat)
            off = math.hypot(e - s['translation'][0], n - s['translation'][1])
            if best is None or off < best[0]:
                best = (off, epsg)
    if best[0] > 10:
        raise CamerasError("The shots' positions are not in UTM")
    return best[1]


class Heights:
    """The DSM's heights (read at most DSM_SIZE pixels across), or the ground's alone, at UTM points"""

    def __init__(self, dsm, epsg, ground):
        self.ground = ground
        self.z = None
        if dsm is None:
            return
        import rasterio
        from pyproj import Transformer
        from rasterio.enums import Resampling
        with rasterio.open(dsm) as src:
            scale = max(1.0, max(src.width, src.height) / float(DSM_SIZE))
            shape = (max(1, int(round(src.height / scale))), max(1, int(round(src.width / scale))))
            z = src.read(1, out_shape=shape, resampling=Resampling.average, masked=True)
            self.z = np.where(np.ma.getmaskarray(z), np.nan, z.filled(np.nan)).astype(float)
            self.inverse = ~(src.transform @ src.transform.scale(src.width / float(shape[1]),
                                                                  src.height / float(shape[0])))
            same = src.crs is not None and src.crs.to_epsg() == epsg
            self.to_dsm = None if same else Transformer.from_crs("EPSG:%d" % epsg, src.crs, always_xy=True)
        if self.ground is None and np.isfinite(self.z).any():
            self.ground = float(np.nanmedian(self.z))

    def at(self, e, n):
        e, n = np.atleast_1d(np.asarray(e, float)), np.atleast_1d(np.asarray(n, float))
        out = np.full(e.shape, np.nan if self.ground is None else self.ground)
        if self.z is None:
            return out
        x, y = (e, n) if self.to_dsm is None else self.to_dsm.transform(e, n)
        col, row = self.inverse @ (np.asarray(x), np.asarray(y))
        col, row = np.floor(col), np.floor(row)
        inside = np.isfinite(col) & np.isfinite(row) & (row >= 0) & (col >= 0) & \
            (row < self.z.shape[0]) & (col < self.z.shape[1])
        z = np.full(e.shape, np.nan)
        z[inside] = self.z[row[inside].astype(int), col[inside].astype(int)]
        return np.where(np.isfinite(z), z, out)


class Cameras:
    """A WebODM task's cameras as the source frames window reads a mosaic's frame models (thermal_sources): the
    flight's files they took (files), their footprints in lon/lat, and each one's pixel and view angle at points; the
    pixels are the file's own, where WebODM was given it smaller. Shots of files the flight doesn't hold are left
    out."""

    def __init__(self, shots, lenses, rows, dsm=None):
        from pyproj import Transformer
        epsg = utm_epsg(shots)
        self.to_utm = Transformer.from_crs("EPSG:4326", "EPSG:%d" % epsg, always_xy=True)
        self.to_lonlat = Transformer.from_crs("EPSG:%d" % epsg, "EPSG:4326", always_xy=True)
        found = [(s, r) for s, r in zip(shots, matched(shots, rows)) if r is not None]
        # The ground under the photos: their positions less their height above where they took off
        above = [s['translation'][2] - r['alt'] for s, r in found if isinstance(r.get('alt'), (int, float))]
        self.heights = Heights(dsm, epsg, float(np.median(above)) if above else None)
        if self.heights.ground is None:
            raise CamerasError("Neither a DSM nor the photos' heights say where the ground is")
        self.files, self.sizes, self._shots = [], {}, []
        for s, r in found:
            lens = lenses[s['lens']]
            width, height = int(r.get('width') or s['width']), int(r.get('height') or s['height'])
            corners_u, corners_v = from_pixels(np.array([-0.5, s['width'] - 0.5]), np.array([-0.5, s['height'] - 0.5]),
                                               s['width'], s['height'])
            cx, cy = undistort(lens, *np.meshgrid(corners_u, corners_v))
            self._shots.append({'c': np.asarray(s['translation'], float), 'r': rotation(s['rotation']), 'lens': lens,
                                'w': s['width'], 'h': s['height'], 'sx': width / s['width'], 'sy': height / s['height'],
                                'r2': float(np.max(cx * cx + cy * cy)) * FOV_MARGIN ** 2})
            self.files.append(r['path'])
            self.sizes[r['path']] = (width, height)
        self.files = tuple(self.files)
        self.footprints = tuple(self._footprint(s) for s in self._shots)

    def _footprint(self, s):
        """Where a photo's edges meet the ground, under it, as lon/lat"""
        w, h, t = s['w'], s['h'], np.linspace(0, 1, EDGE_POINTS, endpoint=False)
        left, top, right, bottom = -0.5, -0.5, w - 0.5, h - 0.5
        px = np.concatenate([left + t * w, np.full_like(t, right), right - t * w, np.full_like(t, left)])
        py = np.concatenate([np.full_like(t, top), top + t * h, np.full_like(t, bottom), bottom - t * h])
        x, y = undistort(s['lens'], *from_pixels(px, py, w, h))
        rays = np.column_stack([x, y, np.ones_like(x)]) @ s['r']        # camera to world: R transposed
        drop = max(float(s['c'][2] - self.heights.at([s['c'][0]], [s['c'][1]])[0]), 1.0)
        # A ray that meets the ground no nearer than ten times the photo's height above it (or never) is cut there
        far = 10 * drop / np.linalg.norm(rays[:, :2], axis=1).clip(1e-9)
        with np.errstate(divide='ignore'):
            reach = np.where(rays[:, 2] < -1e-6, np.minimum(drop / -rays[:, 2], far), far)
        e, n = s['c'][0] + rays[:, 0] * reach, s['c'][1] + rays[:, 1] * reach
        lon, lat = self.to_lonlat.transform(e, n)
        return np.column_stack([lon, lat])

    def _see(self, lon, lat):
        """For points lon/lat: each photo's pixel (of its file), angle off nadir and whether it saw them"""
        lon, lat = np.atleast_1d(np.asarray(lon, float)), np.atleast_1d(np.asarray(lat, float))
        e, n = self.to_utm.transform(lon, lat)
        e, n = np.asarray(e, float), np.asarray(n, float)
        points = np.column_stack([e, n, self.heights.at(e, n)])
        shape = (len(self._shots), e.size)
        u, v, angle = np.full(shape, np.nan), np.full(shape, np.nan), np.full(shape, np.nan)
        for k, s in enumerate(self._shots):
            d = points - s['c']
            cam = d @ s['r'].T
            with np.errstate(divide='ignore', invalid='ignore'):
                x, y = cam[:, 0] / cam[:, 2], cam[:, 1] / cam[:, 2]
                pu, pv = to_pixels(*distort(s['lens'], x, y), s['w'], s['h'])
                a = np.degrees(np.arccos(np.clip(-d[:, 2] / np.linalg.norm(d, axis=1), -1, 1)))
            seen = (cam[:, 2] > 0) & (x * x + y * y <= s['r2']) & \
                (pu >= -0.5) & (pu < s['w'] - 0.5) & (pv >= -0.5) & (pv < s['h'] - 0.5)
            u[k] = np.where(seen, (pu + 0.5) * s['sx'] - 0.5, np.nan)
            v[k] = np.where(seen, (pv + 0.5) * s['sy'] - 0.5, np.nan)
            angle[k] = np.where(seen, a, np.nan)
        return u, v, angle

    def pixels(self, lon, lat):
        """Each photo's pixel for points lon/lat: (photos, points, 2), NaN where it did not see the point"""
        u, v, _ = self._see(lon, lat)
        return np.stack([u, v], axis=-1)

    def view_angles(self, lon, lat):
        """The angle off nadir each photo saw points lon/lat at, in degrees: (photos, points), NaN where unseen"""
        return self._see(lon, lat)[2]
