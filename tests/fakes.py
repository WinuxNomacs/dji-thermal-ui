"""What the API tests make datasets, conversions and mosaics from: dji-thermal-cli's calls faked (copied from LuxODM's
app/tests/test_thermal_analyzer_plugin.py, commit a2a81052), a small JPEG, and helpers making datasets through the API.
"""

import io
import math
import os
import struct
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from django.core.files.uploadedfile import SimpleUploadedFile

from dji_thermal_ui.analyzer.models import ThermalConversion, ThermalDataset

DATASETS = "/api/datasets"
CONVERSIONS = "/api/conversions"
PREFERENCES = "/api/preferences"


def jpeg_bytes():
    """A small JPEG that is not an R-JPEG"""
    from PIL import Image
    buf = io.BytesIO()
    Image.new('RGB', (8, 8), (120, 60, 30)).save(buf, 'JPEG')
    return buf.getvalue()


JPEG = jpeg_bytes()


# --- a DJI drone's MP4, as the Matrice 4T writes it: a video track, a "DJI meta" track and a cover ---

def _box(kind, *parts):
    data = b''.join(parts)
    return (8 + len(data)).to_bytes(4, 'big') + kind + data


def _full_box(kind, *parts, version=0):
    return _box(kind, bytes([version, 0, 0, 0]), *parts)


def _pb(fields):
    """A protobuf message from {field: value}: ints as varints, floats as fixed32, (x,) as a double, text, bytes and
    dicts as length-delimited"""
    def varint(v):
        v &= (1 << 64) - 1
        out = b''
        while True:
            out += bytes([(v & 0x7f) | (0x80 if v > 0x7f else 0)])
            v >>= 7
            if not v:
                return out
    out = b''
    for k, v in fields.items():
        if isinstance(v, tuple):
            out += varint(k << 3 | 1) + struct.pack('<d', v[0])
        elif isinstance(v, float):
            out += varint(k << 3 | 5) + struct.pack('<f', v)
        elif isinstance(v, int):
            out += varint(k << 3) + varint(v)
        else:
            v = _pb(v) if isinstance(v, dict) else v.encode() if isinstance(v, str) else v
            out += varint(k << 3 | 2) + varint(len(v)) + v
    return out


def video_frame_meta(i, lat=42.1, lon=-88.07, pitch=-450, yaw=364):
    """One frame of DJI's metadata: the aircraft 0.00001° further north each frame, 15.2 m above take-off; the gimbal
    at pitch and yaw (tenths of a degree, 0 left out as protobuf does)"""
    gimbal = {k: v for k, v in ((1, pitch), (3, yaw)) if v}
    return {3: {1: {2: 1000000 + 33333 * i},
                3: {2: {1: 1.2, 2: -0.5}, 3: {3: -270},
                    4: {1: {2: (math.radians(lat + i * 1e-5),), 3: (math.radians(lon),)}, 2: 222800},
                    5: {1: 15200.0}},
                4: {3: gimbal}}}


def dji_video(frames=3, meta=True, cover=True, width=640, height=512):
    """The bytes of a DJI MP4 of so many frames at 30 fps (frames not decodable: only their sizes are read)"""
    video_samples = [b'\0' * 10] * frames
    meta_samples = []
    if meta:
        meta_samples = [_pb({**({1: {1: {5: "SN1", 10: "DJI DJI Matrice 4T"}}} if i == 0 else {}),
                             **video_frame_meta(i, pitch=0 if i == 0 else -450)}) for i in range(frames)]
    head = _box(b'ftyp', b'isom', b'\0\0\2\0', b'isomiso2avc1mp41')
    mdat_start = len(head) + 8
    samples = video_samples + meta_samples
    offsets = [mdat_start + sum(len(x) for x in samples[:i]) for i in range(len(samples))]
    mdat = _box(b'mdat', *samples)

    def stbl(entry, sizes, firsts):
        return _box(b'stbl',
                    _full_box(b'stsd', struct.pack('>I', 1), entry),
                    _full_box(b'stts', struct.pack('>III', 1, len(sizes), 1000)),
                    _full_box(b'stsc', struct.pack('>IIII', 1, 1, 1, 1)),
                    _full_box(b'stsz', struct.pack('>II', 0, len(sizes)), *(struct.pack('>I', n) for n in sizes)),
                    _full_box(b'stco', struct.pack('>I', len(firsts)), *(struct.pack('>I', o) for o in firsts)))

    def trak(handler, name, entry, sizes, firsts):
        return _box(b'trak', _box(b'mdia',
                    _full_box(b'mdhd', struct.pack('>IIII', 0, 0, 30000, 1000 * len(sizes)), b'\x55\xc4\0\0'),
                    _full_box(b'hdlr', b'\0' * 4, handler, b'\0' * 12, name.encode() + b'\0'),
                    _box(b'minf', stbl(entry, sizes, firsts))))

    avc1 = _box(b'avc1', b'\0' * 6, struct.pack('>H', 1), b'\0' * 16, struct.pack('>HH', width, height), b'\0' * 50)
    traks = [trak(b'vide', "VideoHandler", avc1, [len(x) for x in video_samples], offsets[:frames])]
    if meta:
        traks.append(trak(b'meta', "DJI meta", _box(b'djmd', b'\0' * 8), [len(x) for x in meta_samples],
                          offsets[frames:]))
    created = 0xe706b79e    # 2026-10-27T20:18:38Z, in seconds since 1904
    mvhd = _full_box(b'mvhd', struct.pack('>IIII', created, created, 30000, 1000 * frames), b'\0' * 80)
    udta = []
    if cover:
        udta = [_box(b'udta', _full_box(b'meta', _full_box(b'hdlr', b'\0' * 4, b'mdirappl', b'\0' * 9),
                                         _box(b'ilst', _box(b'covr', _box(b'data', b'\0\0\0\x0d\0\0\0\0', JPEG)))))]
    return head + mdat + _box(b'moov', mvhd, *traks, *udta)


def video_file(path, **kw):
    """A DJI MP4 written at path (dji_video's arguments)"""
    os.makedirs(os.path.dirname(str(path)) or '.', exist_ok=True)
    with open(path, 'wb') as out:
        out.write(dji_video(**kw))
    return str(path)


def fake_process(path, output_dir, jobs=None, progress=None, **kw):
    """dji-thermal-cli's api.process for the images of a dataset: a temperature TIFF per image, as it writes them"""
    results = []
    for src in sorted(Path(path).rglob('*.JPG')):
        out = Path(output_dir) / src.relative_to(path).parent / (src.stem + '_temp_c.tiff')
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(b'II*' + b'0' * 997)
        results.append(SimpleNamespace(src=src, ok=True, reason=None, outputs=[out], notes=['emissivity 0.95'],
                                       distance=21.4, distance_source='lrf'))
        if progress:
            progress(SimpleNamespace(kind='file'))
    return SimpleNamespace(results=results, normalization=None)


# Where the fake mosaics are: a 64 x 64 px UTM grid at 5 cm, near the M4T flight
MOSAIC_ORIGIN = (399000.0, 4661700.0)


def fake_rjpeg(data):
    """An R-JPEG as dji-thermal-cli's tsdk opens it, with DJI's colour tables (3, palettes, 256): palette n goes from
    blue to red"""
    import numpy as np
    from dji_thermal_cli import api as dji_api
    ramp = np.arange(256)
    lut = np.stack([np.tile(ramp, (len(dji_api.PALETTES), 1)), np.zeros((len(dji_api.PALETTES), 256), int),
                    np.tile(255 - ramp, (len(dji_api.PALETTES), 1))])
    return SimpleNamespace(get_pseudo_color_lut=lambda: lut)


def write_mosaic(path, normalize=False, source_pixel=True):
    """A mosaic GeoTIFF as dji-thermal-cli writes it: temperature (no data in a corner, -273.15 where replaced),
    source frame (left half frame 0, right half frame 1), view angle and, unless not source_pixel (before 1.4.0), the
    source frame's pixel bands (column = the mosaic's column + 100, row = its row + 200), NaN for no data"""
    import numpy as np
    import rasterio
    from rasterio.transform import from_origin
    temperature = np.tile(np.linspace(10, 30, 64, dtype=np.float32), (64, 1)) + (0.5 if normalize else 0)
    temperature[:8, :8] = np.nan
    temperature[60:, 60:] = -273.15
    source = np.zeros((64, 64), np.float32)
    source[:, 32:] = 1
    source[:8, :8] = np.nan
    angle = np.full((64, 64), 4.0, np.float32)
    angle[:8, :8] = np.nan
    bands = [temperature, source, angle]
    if source_pixel:
        rows, cols = np.indices((64, 64), dtype=np.float32)
        bands += [cols + 100, rows + 200]
        for band in bands[3:]:
            band[:8, :8] = np.nan
    path.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(path, 'w', driver='GTiff', width=64, height=64, count=len(bands), dtype='float32',
                       crs='EPSG:32616', transform=from_origin(MOSAIC_ORIGIN[0], MOSAIC_ORIGIN[1], 0.05, 0.05),
                       nodata=float('nan')) as dst:
        dst.write(np.stack(bands))
    path.with_suffix('.json').write_text('{}')
    return path


def mosaic_events(normalize=False, written=True, frames=2):
    """dji-thermal-cli's "mosaic" events, stage by stage: normalizing first reads the ambient temperatures, a mosaic
    built also checks its alignment and writes its files; aligning is a round of pairs, then its solve"""
    stages = ([('ambient', None, frames, 'files')] if normalize else []) + [
        ('frames', None, frames, 'files'), ('align', 1, 1, 'pairs'), ('align', 1, 40, 'solve steps'),
        ('composite', None, frames, 'frames')] + \
        ([('check', None, 1, 'pairs'), ('write', None, 2, 'files')] if written else [])
    events = []
    for step, (stage, round_, total, unit) in enumerate(stages, 1):
        for done in (0, total):
            data = {'stage': stage, 'step': step, 'steps': len(stages), 'done': done, 'total': total, 'unit': unit}
            if round_:
                data.update(round=round_, rounds=1)
            events.append(SimpleNamespace(kind='mosaic', data=data))
    return events


def fake_make_mosaic(path, output_dir, settings=None, options=None, compression='deflate', jobs=None, progress=None,
                     as_converted_dir=None):
    """dji-thermal-cli's make_mosaic: its stages, then the GeoTIFF, its sidecar and preview, and its report; with
    as_converted_dir, the mosaic as converted there too (its report's as_converted)"""
    for event in mosaic_events(options.normalize) if progress else ():
        progress(event)
    result = fake_mosaic(Path(output_dir), options.units[0], options.normalize)
    if as_converted_dir is not None:
        result.as_converted = fake_mosaic(Path(as_converted_dir), options.units[0], False)
    # The visual mosaic, beside the harmonized one, when asked for and the dataset has visual frames (both mosaics
    # then have frame models)
    if options.visual and any(Path(path).rglob('*_V.JPG')):
        for m in (result, result.as_converted):
            if m is not None:
                write_frame_models(m.files[0][1], THERMAL_MODELS)
        result.visual = fake_visual(Path(output_dir))
    elif options.visual:
        result.visual_note = "no visual frames (JPEGs with a DJI camera pose that are not thermal)"
    return result


VISUAL_FILES = ('100MEDIA/DJI_0001_V.JPG', '100MEDIA/DJI_0002_V.JPG')
# Both frames' cameras 30 m above the middle of the mosaic, looking down with the image's top to the north:
# NED -> the camera's (forward, right, down)
NADIR = [[0.0, 0.0, 1.0], [0.0, 1.0, 0.0], [-1.0, 0.0, 0.0]]
# (file, width, height, focal, camera's move from the middle (east, north, up) in metres, its turn about down in
# radians): the thermal frames, then the visual ones (wider, turned a little, exposed a little later)
THERMAL_MODELS = [('100MEDIA/DJI_0001_T.JPG', 640, 512, 1000.0, (0, 0, 0), 0.0),
                  ('100MEDIA/DJI_0002_T.JPG', 640, 512, 1000.0, (0.4, 0, 0), 0.0)]
VISUAL_MODELS = [('100MEDIA/DJI_0001_V.JPG', 4032, 3024, 2900.0, (0.3, -0.2, 0.1), 0.004),
                 ('100MEDIA/DJI_0002_V.JPG', 4032, 3024, 2900.0, (0.7, -0.2, 0.1), 0.004)]


def frame_models(models):
    """Frame models as dji-thermal-cli's sidecars have them, for the fake mosaic's place and frames"""
    import numpy as np
    from pyproj import Transformer
    to_lonlat = Transformer.from_crs('EPSG:32616', 'EPSG:4326', always_xy=True)
    centre = np.array(MOSAIC_ORIGIN) + [1.6, -1.6]
    frames = []
    for k, (name, w, h, f, (east, north, up), turn) in enumerate(models):
        c, s = np.cos(turn), np.sin(turn)
        ned = np.array(NADIR) @ np.array([[c, s, 0], [-s, c, 0], [0, 0, 1]])
        camera = centre + [east, north]
        corners = camera + np.array([[-12, 10], [12, 10], [12, -10], [-12, -10]])
        frames.append({'index': k, 'file': name, 'width': w, 'height': h, 'focal_px': f,
                       'principal_point_px': [(w - 1) / 2, (h - 1) / 2], 'camera_utm': camera.tolist(),
                       'height_m': 30.0 + up, 'local_to_utm': [[1.0, 0.0], [0.0, 1.0]], 'ned_to_camera': ned.tolist(),
                       'alignment_shift_m': [0.0, 0.0], 'alignment_rotation_rad': 0.0,
                       'footprint_lonlat': np.column_stack(to_lonlat.transform(*corners.T)).tolist()})
    return {'version': 1, 'crs': 'EPSG:32616', 'surface': None, 'frames': frames}


def write_frame_models(sidecar, models, **info):
    import json
    Path(sidecar).write_text(json.dumps(dict(info, frame_models=frame_models(models))))


def fake_visual(out):
    """The files and report of make_mosaic's visual mosaic: 4 bands (red, green, blue, alpha; no frame in a corner)
    on the thermal mosaic's grid"""
    import numpy as np
    import rasterio
    from rasterio.transform import from_origin
    tif = out / 'mosaic_visual.tif'
    rgba = np.zeros((4, 64, 64), np.uint8)
    rgba[0], rgba[1], rgba[2], rgba[3] = 200, np.arange(64, dtype=np.uint8)[None, :] * 4, 40, 255
    rgba[:, :8, :8] = 0
    with rasterio.open(tif, 'w', driver='GTiff', width=64, height=64, count=4, dtype='uint8', crs='EPSG:32616',
                       transform=from_origin(MOSAIC_ORIGIN[0], MOSAIC_ORIGIN[1], 0.05, 0.05)) as dst:
        dst.write(rgba)
    frames = [{'index': k, 'file': v, 'thermal_file': t[0]} for k, (v, t) in enumerate(zip(VISUAL_FILES, THERMAL_MODELS))]
    write_frame_models(tif.with_suffix('.json'), VISUAL_MODELS, frames=frames)
    (out / 'mosaic_visual_preview.png').write_bytes(b'\x89PNG' + b'0' * 96)
    report = {'frames_used': 2, 'frames_contributing': 2, 'pairing': 'exposure time',
              'thermal_frames_without_visual': [], 'visual_frames_unused': ['100MEDIA/DJI_0003_V.JPG'],
              'camera_offset': {'applied': True, 'pairs_measured': 5, 'pairs_used': 5,
                                'boresight_deg': {'pitch': 0.25, 'yaw': -0.29}, 'offset_before_m': {'median': 0.1},
                                'residual_m': {'median': 0.026, 'p90': 0.045}}}
    return SimpleNamespace(mosaic=SimpleNamespace(grid=SimpleNamespace(gsd=0.05, width=64, height=64), report=report,
                                                  frames=frames),
                           file=tif, sidecar=tif.with_suffix('.json'), preview=out / 'mosaic_visual_preview.png',
                           preview_reduction=1, frames=2, skipped=0)


def fake_mosaic(out, unit, normalize):
    """The files and report of one of make_mosaic's mosaics"""
    tif = write_mosaic(out / 'mosaic_temp_{}.tif'.format(unit.lower()), normalize)
    (out / 'mosaic_preview.png').write_bytes(b'\x89PNG' + b'0' * 96)
    frames = [{'index': 1, 'file': '100MEDIA/DJI_0002_T.JPG'}, {'index': 0, 'file': '100MEDIA/DJI_0001_T.JPG'}]
    report = {'frames_used': 2, 'radiometric_seams': {'pixels': 100, 'median_abs_c': 0.3, 'p95_abs_c': 2.7},
              'misalignment': {'pairs': 1, 'median_m': 0.08, 'p90_m': 0.4, 'pairs_detail': [{'frames': [0, 1]}]},
              'heights': {'method': 'parallax between overlapping frames', 'cell_m': 1.3, 'cells': 4,
                          'observed_cells': 3, 'range_m': [-0.2, 5.1]}}
    return SimpleNamespace(mosaic=SimpleNamespace(frames=frames, grid=SimpleNamespace(gsd=0.05, width=64, height=64),
                                                  report=report),
                           files=[(tif, tif.with_suffix('.json'))], preview=out / 'mosaic_preview.png',
                           palette='ironred', preview_range_c=(10.0, 30.0), frames=2, oblique=0, unusable=0,
                           not_thermal=0, normalize_ambient_c=(27.1, 27.2) if normalize else None, as_converted=None,
                           visual=None, visual_note="")


def mosaic_temperature(col):
    """The fake mosaic's temperature in a column (as converted)"""
    return 10 + 20 * col / 63


def mosaic_lonlat(col, row):
    """Where a point of the fake mosaic's grid is (col, row in pixels from its top left corner), as lon, lat"""
    from pyproj import Transformer
    return list(Transformer.from_crs('EPSG:32616', 'EPSG:4326', always_xy=True).transform(
        MOSAIC_ORIGIN[0] + col * 0.05, MOSAIC_ORIGIN[1] - row * 0.05))


def mosaic_square(c0, r0, c1, r1):
    """A polygon over the fake mosaic's pixels c0..c1-1, r0..r1-1 (lon/lat), inset a little so that it touches no
    neighbouring pixel"""
    e = 0.2
    corners = [(c0 + e, r0 + e), (c1 - e, r0 + e), (c1 - e, r1 - e), (c0 + e, r1 - e), (c0 + e, r0 + e)]
    return {'type': 'Polygon', 'coordinates': [[mosaic_lonlat(c, r) for c, r in corners]]}


def mosaic_tile(z=21):
    """The tile (z, x, y) at the middle of the fake mosaic, and the centre of its pixel (32, 32) as lon, lat"""
    import morecantile
    from pyproj import Transformer
    lon, lat = Transformer.from_crs('EPSG:32616', 'EPSG:4326', always_xy=True).transform(
        MOSAIC_ORIGIN[0] + 1.625, MOSAIC_ORIGIN[1] - 1.625)
    t = morecantile.tms.get("WebMercatorQuad").tile(lon, lat, z)
    return (t.z, t.x, t.y), (lon, lat)


def fake_measure(path, settings=None, unit='C'):
    """dji-thermal-cli's api.measure of a frame: 8 x 10 px warming to the east, 1 °C warmer for each 0.01 of
    emissivity above 0.91, and as warm as the ambient temperature given in its last column"""
    import numpy as np
    emissivity = settings.emissivity if settings is not None and settings.emissivity is not None else 0.91
    t = np.tile(np.arange(10, dtype=np.float32) + 20, (8, 1)) + (emissivity - 0.91) * 100
    if settings is not None and settings.ambient_temp is not None:
        t[:, 9] = settings.ambient_temp
    t[0, 0] = -273.15
    return SimpleNamespace(path=path, temperature=t.astype(np.float32), unit=unit, distance_source='rangefinder',
                           notes=[], params={'distance': 21.4, 'humidity': 50.0, 'emissivity': emissivity,
                                             'reflection': 27.6, 'ambient_temp': 27.6})


def image(name='DJI_0001_T.JPG'):
    return SimpleUploadedFile(name, JPEG, content_type='image/jpeg')


def thermal_report(path, **over):
    """A FileReport of dji-thermal-cli for a thermal frame, as check() makes it"""
    info = {
        'file': {'size_bytes': 1000, 'warnings': []},
        'camera': {'model': 'M4T', 'camera_serial': 'SN1', 'width': 640, 'height': 512,
                   'capture_time': '2026:10:12 18:29:50', 'utc_at_exposure': '2026-10-12T23:30:09.6'},
        'thermal': {'measurement_params': {'distance': 5.0, 'humidity': 50.0, 'emissivity': 0.91, 'reflection': 27.6,
                                           'ambient_temp': 27.6}, 'palette': {'name': 'ironred'}},
        'temperature': {'min': 17.25, 'max': float('nan'), 'mean': 21.9},
        'geospatial': {'latitude': 42.1, 'longitude': -88.07, 'relative_altitude_m': 21.14,
                       'absolute_altitude_m': 223.8, 'gps_status': 'RTK', 'rangefinder': {'distance_m': 21.4}},
        'attitude': {'gimbal_pitch': -90.0, 'gimbal_yaw': 5.4},
    }
    info.update(over)
    return SimpleNamespace(path=path, info=info, status=SimpleNamespace(kind='thermal', reason=''))


# --- datasets and conversions, made through the API ---

def dataset(**over):
    return ThermalDataset.objects.create(**dict(dict(name="Roof"), **over))


def server_folder(root, files=('DJI_0001_T.JPG',)):
    """A folder of images on the computer, under root"""
    for f in files:
        p = os.path.join(root, f)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, 'wb') as out:
            out.write(b"flight notes" if f.endswith('.txt') else JPEG)
    return str(root)


def uploaded(client, names=('100MEDIA/DJI_0001_T.JPG', '100MEDIA/DJI_0002_T.JPG')):
    d = dataset()
    client.post("{}/{}/upload".format(DATASETS, d.id), {'images': [image(n.split('/')[-1]) for n in names],
                                                       'paths': list(names)}, format='multipart')
    d.refresh_from_db()
    return d


def converted(client, settings=None, names=None):
    """A dataset of two frames (or of the files named) converted with the settings given, and its mosaics built: the
    conversion, and the mock of make_mosaic"""
    d = uploaded(client, names) if names else uploaded(client)
    with mock.patch('dji_thermal_cli.api.process', side_effect=fake_process), \
            mock.patch('dji_thermal_cli.api.make_mosaic', side_effect=fake_make_mosaic) as make, \
            mock.patch('dji_thermal_cli.tsdk.open', side_effect=fake_rjpeg):
        res = client.post("{}/{}/conversions".format(DATASETS, d.id), {'settings': settings or {}}, format='json')
    assert res.status_code == 201, res.data
    return ThermalConversion.objects.get(pk=res.data['id']), make


def analysed(c, pitches=(-90.0, -45.0)):
    """The conversion's dataset as analysed: its two uploads thermal frames, the second oblique"""
    rows = [{'path': '100MEDIA/DJI_000{}_T.JPG'.format(i + 1), 'kind': 'thermal', 'pitch': p, 'emissivity': 0.91,
             'reflection': 27.6, 'ambient': 27.6, 'humidity': 50.0, 'lrf': 21.4, 'time': '2026:10:12 18:29:5{}'.format(i),
             'lat': 42.1, 'lon': -88.07 + i * 0.0001}
            for i, p in enumerate(pitches)]
    ThermalDataset.objects.filter(pk=c.dataset_id).update(analysis={'files': rows})
    c.refresh_from_db()
    return c
