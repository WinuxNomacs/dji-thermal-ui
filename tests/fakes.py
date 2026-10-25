"""What the API tests make datasets, conversions and mosaics from: dji-thermal-cli's calls faked (copied from LuxODM's
app/tests/test_thermal_analyzer_plugin.py, commit a2a81052), a small JPEG, and helpers making datasets through the API.
"""

import io
import os
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
    return result


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
                           not_thermal=0, normalize_ambient_c=(27.1, 27.2) if normalize else None, as_converted=None)


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
                   'capture_time': '2026:10:12 18:29:50'},
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


def converted(client, settings=None):
    """A dataset of two frames converted with the settings given, and its mosaics built: the conversion, and the mock of
    make_mosaic"""
    d = uploaded(client)
    with mock.patch('dji_thermal_cli.api.process', side_effect=fake_process), \
            mock.patch('dji_thermal_cli.api.make_mosaic', side_effect=fake_make_mosaic) as make, \
            mock.patch('dji_thermal_cli.tsdk.open', side_effect=fake_rjpeg):
        res = client.post("{}/{}/conversions".format(DATASETS, d.id), {'settings': settings or {}}, format='json')
    assert res.status_code == 201, res.data
    return ThermalConversion.objects.get(pk=res.data['id']), make
