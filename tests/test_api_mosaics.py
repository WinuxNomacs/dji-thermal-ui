"""The conversions' mosaics through the API: built, tiled, read, canceled, compared (ported from LuxODM's
app/tests/test_thermal_analyzer_plugin.py, commit a2a81052, without its sharing and its pages)"""

import io
import os
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import pytest

from dji_thermal_ui.analyzer import jobs
from dji_thermal_ui.analyzer import thermal_conversion as conversion
from dji_thermal_ui.analyzer import thermal_mosaics as mosaics
from dji_thermal_ui.analyzer.models import ThermalConversion
from tests.fakes import (CONVERSIONS, DATASETS, PREFERENCES, MOSAIC_ORIGIN, analysed, converted, fake_make_mosaic, fake_process,
                         mosaic_events, mosaic_lonlat, mosaic_temperature, mosaic_tile, uploaded, write_mosaic)


def test_conversions_build_their_mosaics_which_the_viewer_reads(api):
    c, make = converted(api, {'max_pitch': -85})
    assert (c.status, c.mosaic_status, c.mosaic_progress, c.run_id) == ('ready', 'ready', 1.0, "")
    # Both mosaics from one layout (the harmonized one, and as converted alongside), with the conversion's pitch
    # limit and unit
    assert [(call.args[2].emissivity, call.args[3].normalize, call.args[3].max_pitch, call.args[3].units,
             Path(call.args[1]).name, Path(call.kwargs['as_converted_dir']).name)
            for call in make.call_args_list] == [(None, True, -85.0, ('C',), 'harmonized', 'as_converted')]
    assert sorted(c.mosaics['kinds']) == ['as_converted', 'harmonized']
    assert c.mosaics['frames'] == ['100MEDIA/DJI_0001_T.JPG', '100MEDIA/DJI_0002_T.JPG']
    k = c.mosaics['kinds']['harmonized']
    assert k['files'] == ['mosaics/harmonized/mosaic_preview.png', 'mosaics/harmonized/mosaic_temp_c.json',
                          'mosaics/harmonized/mosaic_temp_c.tif']
    assert (k['normalization'], k['frames'], k['palette']) == ([27.1, 27.2], 2, 'ironred')
    # The range leaves out no data and dji-thermal-cli's absolute-zero marker; the per-pair details are not kept
    assert k['temperature']['min'] >= 10.5
    assert 'pairs_detail' not in k['report']['misalignment']
    assert k['report']['heights']['range_m'] == [-0.2, 5.1]
    assert c.mosaics['kinds']['as_converted']['normalization'] is None
    # Their files count in the conversion's size, and are in its zip
    assert c.file_count == 2 + 6 + 1
    res = api.get("{}/{}/download".format(CONVERSIONS, c.id))
    with zipfile.ZipFile(io.BytesIO(b"".join(res.streaming_content))) as z:
        assert 'mosaics/as_converted/mosaic_temp_c.tif' in z.namelist()
        assert not [n for n in z.namelist() if n.startswith('viewer/')]
    summary = api.get("{}/{}".format(CONVERSIONS, c.id)).data
    assert 'mosaics/harmonized/mosaic_temp_c.tif' in summary['mosaic_files']
    assert 'mosaics' in summary['description']

    v = api.get("{}/{}/mosaics".format(CONVERSIONS, c.id)).data
    assert [t['tab'] for t in v['tabs']] == ['as_converted', 'harmonized', 'source_frame', 'view_angle']
    assert (v['default_palette'], v['unit']) == ('dji_ironred', 'C')
    # The palette preferred in the preferences wins where the flight has it; a DJI one it lacks, the images' own
    for preferred, starts in (('magma', 'magma'), ('dji_arctic', 'dji_arctic'), ('', 'dji_ironred')):
        assert api.put(PREFERENCES, {'palette': preferred}, format='json').data == {'palette': preferred}
        assert api.get("{}/{}/mosaics".format(CONVERSIONS, c.id)).data['default_palette'] == starts
    assert 'can_change' not in v
    from dji_thermal_cli import api as dji_api
    assert [p['key'] for p in v['palettes']][:len(dji_api.PALETTES) + 1] == \
        ['dji_' + name for name in dji_api.PALETTES] + ['ironbow']
    assert v['palettes'][0]['color_map'][255] == 0xff0000ff
    assert v['tabs'][2]['stats'] is None
    assert v['tabs'][3]['stats']['max'] == 4.0
    # When the mosaic's frames were taken: the first and the last, once the dataset's analysis has their times
    assert v['flown'] == []
    analysed(c)
    assert api.get("{}/{}/mosaics".format(CONVERSIONS, c.id)).data['flown'] == \
        ['2026:10:12 18:29:50', '2026:10:12 18:29:51']

    _, (lon, lat) = mosaic_tile()
    point = "{}/{}/mosaics/{{}}/point".format(CONVERSIONS, c.id)
    p = api.get(point.format('harmonized'), {'lon': lon, 'lat': lat}).data
    assert p['valid']
    assert p['temperature'] == pytest.approx(10 + 20 * 32 / 63 + 0.5, abs=1e-3)
    assert (p['frame'], p['frame_index'], p['view_angle'], p['unit']) == ('100MEDIA/DJI_0002_T.JPG', 1, 4.0, 'C')
    # Where in that frame the point was read from
    assert p['frame_pixel'] == [132, 232]
    assert api.get(point.format('as_converted'), {'lon': 0, 'lat': 0}).data['reason'] == 'outside_raster'
    corner = api.get(point.format('as_converted'), dict(zip(('lon', 'lat'), mosaic_lonlat(2.5, 2.5)))).data
    assert (corner['valid'], corner['temperature'], corner['reason']) == (False, None, 'nodata')
    assert api.get(point.format('as_converted'), {'lon': 'x'}).status_code == 400
    # A mosaic built before dji-thermal-cli 1.4.0 has no frame pixel bands
    raster = os.path.join(c.data_dir(), c.mosaics['kinds']['harmonized']['raster'])
    write_mosaic(Path(raster), normalize=True, source_pixel=False)
    p = api.get(point.format('harmonized'), {'lon': lon, 'lat': lat}).data
    assert (p['frame'], p['frame_pixel']) == ('100MEDIA/DJI_0002_T.JPG', None)

    # A frame's footprint: where the Source frame tab shows it (the left half, but for the corner of no data)
    from pyproj import Transformer
    footprint = "{}/{}/mosaics/footprint".format(CONVERSIONS, c.id)
    to_utm = Transformer.from_crs('EPSG:4326', 'EPSG:32616', always_xy=True)
    shapes = api.get(footprint, {'frame': '100MEDIA/DJI_0001_T.JPG'}).data['features']
    assert len(shapes) == 1
    assert shapes[0]['properties']['frame'] == '100MEDIA/DJI_0001_T.JPG'
    xs, ys = zip(*(to_utm.transform(*p) for p in shapes[0]['geometry']['coordinates'][0]))
    assert min(xs) - MOSAIC_ORIGIN[0] == pytest.approx(0, abs=0.05)
    assert max(xs) - MOSAIC_ORIGIN[0] == pytest.approx(1.6, abs=0.05)
    assert MOSAIC_ORIGIN[1] - min(ys) == pytest.approx(3.2, abs=0.05)
    assert len(shapes[0]['geometry']['coordinates'][0]) == 7
    assert api.get(footprint, {'frame': 'nope.JPG'}).status_code == 404
    assert api.get(footprint).status_code == 404


def test_mosaics_are_written_in_the_conversions_unit(api):
    c, make = converted(api, {'unit': 'F'})
    assert make.call_args.args[3].units == ('F',)
    assert c.mosaics['unit'] == 'F'
    assert 'mosaics/harmonized/mosaic_temp_f.tif' in c.mosaics['kinds']['harmonized']['files']
    assert api.get("{}/{}/mosaics".format(CONVERSIONS, c.id)).data['unit'] == 'F'


def test_mosaics_are_optional_and_can_be_built_later_or_again(api):
    c, make = converted(api, {'mosaics': False})
    assert (c.status, c.mosaic_status, make.call_count) == ('ready', '', 0)
    assert api.get("{}/{}/mosaics".format(CONVERSIONS, c.id)).data['tabs'] == []

    url = "{}/{}/mosaics".format(CONVERSIONS, c.id)
    with mock.patch('dji_thermal_cli.api.make_mosaic', side_effect=fake_make_mosaic):
        res = api.post(url)
        assert res.status_code == 200, res.data
        c.refresh_from_db()
        assert (c.mosaic_status, c.options['mosaics'], c.run_id) == ('ready', True, "")
        size = c.size
        # Again: replaced, not added to
        api.post(url)
    c.refresh_from_db()
    assert c.size == pytest.approx(size)
    # Without DJI's palettes (none read from the frames), the app's colour maps
    assert api.get(url).data['default_palette'] == 'ironbow'
    api.put(PREFERENCES, {'palette': 'dji_arctic'}, format='json')
    assert api.get(url).data['default_palette'] == 'ironbow'
    api.put(PREFERENCES, {'palette': 'viridis'}, format='json')
    assert api.get(url).data['default_palette'] == 'viridis'
    api.put(PREFERENCES, {'palette': ''}, format='json')

    # Only once the images are converted, and not twice at once
    ThermalConversion.objects.filter(pk=c.pk).update(status='failed')
    assert api.post(url).status_code == 400
    ThermalConversion.objects.filter(pk=c.pk).update(status='ready', mosaic_status='building', run_id="run1")
    with mock.patch.object(jobs, 'alive', return_value=True):
        assert api.post(url).status_code == 400


def test_a_failed_mosaic_says_why_and_keeps_nothing_but_the_images(api):
    from dji_thermal_cli import api as dji_api

    def fail(path, output_dir, *args, **kw):
        os.makedirs(output_dir)
        Path(output_dir, 'partial.tif').write_bytes(b'0' * 100)
        raise dji_api.MosaicError("No frames to mosaic.", {})

    d = uploaded(api)
    with mock.patch('dji_thermal_cli.api.process', side_effect=fake_process), \
            mock.patch('dji_thermal_cli.api.make_mosaic', side_effect=fail):
        res = api.post("{}/{}/conversions".format(DATASETS, d.id), {'settings': {}}, format='json')
    c = ThermalConversion.objects.get(pk=res.data['id'])
    assert (c.status, c.mosaic_status, c.mosaic_error, c.file_count) == ('ready', 'failed', "No frames to mosaic.", 2)
    assert not os.path.exists(os.path.join(c.data_dir(), 'mosaics'))
    assert not os.path.exists(os.path.join(c.data_dir(), 'viewer'))
    assert api.get("{}/{}/mosaics/as_converted/point".format(CONVERSIONS, c.id),
                   {'lon': 0, 'lat': 0}).status_code == 404


def test_stripped_conversions_keep_a_located_copy_for_the_viewer_only(api):
    written = []

    def write(m, path, compression, unit, located=True):
        written.append((Path(path).parent.name, located))
        return write_mosaic(Path(path)), Path(path).with_suffix('.json')

    with mock.patch('dji_thermal_cli.mosaic.write', side_effect=write):
        c, make = converted(api, {'strip_location': True})
    assert make.call_args.args[2].strip_location
    assert written == [('viewer', True), ('viewer', True)]
    assert c.mosaics['kinds']['as_converted']['raster'] == 'viewer/as_converted.tif'
    assert c.mosaics['stripped']
    (z, x, y), _ = mosaic_tile()
    assert api.get("{}/{}/mosaics/source_frame/data/{}/{}/{}".format(CONVERSIONS, c.id, z, x, y)).status_code == 200
    # Never downloaded: neither in the zip nor on its own
    download = "{}/{}/download".format(CONVERSIONS, c.id)
    with zipfile.ZipFile(io.BytesIO(b"".join(api.get(download).streaming_content))) as zf:
        assert not [n for n in zf.namelist() if 'viewer' in n]
        assert 'mosaics/as_converted/mosaic_temp_c.tif' in zf.namelist()
    for rel in ('viewer/as_converted.tif', './viewer/as_converted.tif', 'mosaics/../viewer/as_converted.tif'):
        assert api.get(download, {'file': rel}).status_code == 404, rel


def test_canceling_while_the_mosaics_are_built_keeps_the_images(api):
    d = uploaded(api)
    calls = []
    c_id = []

    def make(path, output_dir, *args, **kw):
        calls.append(output_dir)
        res = api.post("{}/{}/cancel".format(CONVERSIONS, c_id[0]))
        assert (res.data['status'], res.data['mosaic_status']) == ('ready', 'canceled')
        return fake_make_mosaic(path, output_dir, *args, **kw)

    real_create = ThermalConversion.objects.create

    def create(**kw):
        c = real_create(**kw)
        c_id.append(c.id)
        return c

    with mock.patch('dji_thermal_cli.api.process', side_effect=fake_process), \
            mock.patch('dji_thermal_cli.api.make_mosaic', side_effect=make), \
            mock.patch.object(ThermalConversion.objects, 'create', side_effect=create):
        api.post("{}/{}/conversions".format(DATASETS, d.id), {'settings': {}}, format='json')
    c = ThermalConversion.objects.get(pk=c_id[0])
    # The run stopped at the first mosaic's first stage
    assert len(calls) == 1
    assert not os.path.exists(os.path.join(calls[0], 'mosaic_preview.png'))
    assert (c.stage, c.mosaic_progress) == ({}, 0)
    assert (c.status, c.mosaic_status, c.run_id, c.mosaics) == ('ready', 'canceled', "", {})
    assert c.results['converted'] == 2


def test_each_stage_of_a_run_counts_the_same_and_aligning_is_its_pairs_then_its_solve():
    def fraction(**d):
        return conversion.stage_fraction(dict({'step': 2, 'steps': 4, 'done': 1, 'total': 4, 'unit': 'files'}, **d))

    assert fraction() == (1 + 0.25) / 4
    assert fraction(done=0, total=0) == 1 / 4
    assert fraction(done=9) == 2 / 4
    # Round 2 of 2 of aligning: its pairs are the first half of the round, its solve the second
    assert fraction(round=2, rounds=2, unit='pairs', done=2) == (1 + (1 + 0.25) / 2) / 4
    assert fraction(round=2, rounds=2, unit='solve steps', done=4) == 2 / 4
    event = SimpleNamespace(kind='mosaic', data={'stage': 'align', 'step': 3, 'steps': 6, 'round': 1, 'rounds': 3,
                                                 'done': 5, 'total': 9, 'unit': 'pairs', 'other': 1})
    assert conversion.mosaic_stage(event, mosaic=2) == \
        {'stage': 'align', 'step': 3, 'steps': 6, 'round': 1, 'rounds': 3, 'done': 5, 'total': 9, 'unit': 'pairs',
         'mosaic': 2}


def test_building_the_mosaics_saves_each_stage_and_one_bar_for_both_that_only_moves_forward(api):
    c, _ = converted(api, {'mosaics': False})
    seen = []

    def make(path, output_dir, *args, progress=None, **kw):
        def record(event):
            progress(event)
            c.refresh_from_db()
            seen.append((c.stage.get('stage'), c.mosaic_progress))
        return fake_make_mosaic(path, output_dir, *args, progress=record, **kw)

    ThermalConversion.objects.filter(pk=c.pk).update(mosaic_status='building', run_id="run1")
    with mock.patch.object(mosaics, 'PROGRESS_INTERVAL', 0), \
            mock.patch('dji_thermal_cli.api.make_mosaic', side_effect=make):
        assert mosaics.build_mosaics(c.id, "run1") == {'mosaics': ['as_converted', 'harmonized']}
    # Both mosaics are one run of stages
    assert [s[0] for s in seen[::2]] == ['ambient', 'frames', 'align', 'align', 'composite', 'check', 'write']
    bar = [s[1] for s in seen]
    assert bar == sorted(bar)
    assert bar[0] == 0
    assert bar[-1] == pytest.approx(0.99)
    # The page reads it, and it is cleared once the mosaics are built
    c.refresh_from_db()
    assert (c.mosaic_status, c.stage) == ('ready', {})
    assert api.get("{}/{}".format(CONVERSIONS, c.id)).data['stage'] == {}


def test_normalizing_saves_its_stages_and_can_be_canceled_meanwhile(api):
    d = uploaded(api)
    c = ThermalConversion.objects.create(dataset=d, name="Run", options=dict(conversion.DEFAULTS, normalize=True),
                                         run_id="run1")
    events = mosaic_events(normalize=True, written=False)

    def process(path, output_dir, progress=None, **kw):
        for event in events[:3]:
            progress(event)
        summary = api.get("{}/{}".format(CONVERSIONS, c.id)).data
        assert (summary['stage']['stage'], summary['stage']['step'], summary['stage']['steps']) == ('frames', 2, 5)
        assert summary['progress'] == 0
        api.post("{}/{}/cancel".format(CONVERSIONS, c.id))
        progress(events[3])
        raise AssertionError("the run should have stopped")

    # The run is called here rather than by the job runner, which would say it is alive
    with mock.patch.object(conversion, 'PROGRESS_INTERVAL', 0), mock.patch.object(jobs, 'alive', return_value=True), \
            mock.patch('dji_thermal_cli.api.process', side_effect=process):
        assert conversion.convert(c.id, "run1") == {'canceled': True}
    c.refresh_from_db()
    assert (c.status, c.run_id, c.stage) == ('canceled', "", {})


def test_the_stage_gives_way_to_the_images_once_they_are_written(api):
    d = uploaded(api)
    c = ThermalConversion.objects.create(dataset=d, name="Run", options=dict(conversion.DEFAULTS, normalize=True),
                                         run_id="run1")
    stages = []

    def process(path, output_dir, progress=None, **kw):
        for event in mosaic_events(normalize=True, written=False):
            progress(event)
        progress(SimpleNamespace(kind='file'))
        stages.append(ThermalConversion.objects.get(pk=c.pk).stage)
        return fake_process(path, output_dir, **kw)

    with mock.patch('dji_thermal_cli.api.process', side_effect=process):
        conversion.convert(c.id, "run1")
    c.refresh_from_db()
    assert (stages, c.status, c.stage) == ([{}], 'ready', {})


def test_a_mosaic_job_that_stopped_is_not_left_building(api):
    c, _ = converted(api, {'mosaics': False})
    ThermalConversion.objects.filter(pk=c.pk).update(mosaic_status='building', run_id="gone")
    v = api.get("{}/{}/mosaics".format(CONVERSIONS, c.id)).data
    assert (v['status'], v['mosaic_status']) == ('ready', 'failed')
    assert "stopped" in v['mosaic_error']


# --- comparing two mosaics ---

def write_flat_mosaic(c, value, east_m):
    """Replaces a conversion's as-converted mosaic with one of a single temperature, east_m metres east of the fake
    mosaic"""
    import numpy as np
    import rasterio
    from rasterio.transform import from_origin
    path = os.path.join(c.data_dir(), c.mosaics['kinds']['as_converted']['raster'])
    with rasterio.open(path, 'w', driver='GTiff', width=64, height=64, count=1, dtype='float32', crs='EPSG:32616',
                       transform=from_origin(MOSAIC_ORIGIN[0] + east_m, MOSAIC_ORIGIN[1], 0.05, 0.05),
                       nodata=float('nan')) as dst:
        dst.write(np.full((1, 64, 64), value, np.float32))


def test_two_mosaics_are_compared_as_their_difference_in_the_first_ones_unit(api):
    a, _ = converted(api)
    b, _ = converted(api, {'unit': 'F'})
    assert (a.mosaics['unit'], b.mosaics['unit']) == ('C', 'F')

    # The mosaics it can be compared with, itself too
    listed = api.get("{}/{}/comparable".format(CONVERSIONS, a.id)).data
    assert [(m['id'], m['unit'], m['tabs']) for m in listed] == \
        [(a.id, 'C', ['as_converted', 'harmonized']), (b.id, 'F', ['as_converted', 'harmonized'])]
    assert (listed[0]['name'], listed[0]['dataset_name']) == (a.name, 'Roof')

    difference = "{}/{}/mosaics/{{}}/difference".format(CONVERSIONS, a.id)

    # A mosaic less itself is 0 wherever it has data
    d = api.get(difference.format('as_converted'), {'b': a.id}).data
    assert (d['unit'], d['stats']['min'], d['stats']['max'], d['range']) == ('C', 0, 0, [-1.0, 1.0])
    assert [p['key'] for p in d['palettes']] == ['rdbu_r', 'coolwarm', 'bwr', 'seismic']
    assert len(d['palettes'][0]['color_map']) == 256

    # B, 50 °F (10 °C) everywhere, over the east half of A: A - B in °C there, no data elsewhere
    write_flat_mosaic(b, 50.0, 1.6)
    d = api.get(difference.format('as_converted'), {'b': b.id}).data
    assert d['stats']['min'] == pytest.approx(mosaic_temperature(32) - 10, abs=0.4)
    assert d['stats']['max'] == pytest.approx(20, abs=0.4)
    assert 19 < d['range'][1] < 20.5 and d['range'][0] == -d['range'][1], d['range']
    assert d['bounds'][0] == pytest.approx(mosaic_lonlat(32, 0)[0], abs=1e-5)
    # B's other mosaic is still the fake one: 10..30 °F
    d = api.get(difference.format('harmonized'), {'b': b.id, 'b_tab': 'harmonized'}).data
    assert d['stats']['min'] == pytest.approx(10.5 - (10 - 32) / 1.8, abs=0.4)

    # Not overlapping at all
    write_flat_mosaic(b, 50.0, 10)
    d = api.get(difference.format('as_converted'), {'b': b.id}).data
    assert (d['unit'], d['bounds'], d['stats'], d['range']) == ('C', None, None, None)

    # What is asked is checked
    assert api.get(difference.format('as_converted'), {'b': a.id, 'b_tab': 'view_angle'}).status_code == 404
    assert api.get(difference.format('as_converted'), {'b': 99999}).status_code == 404


def data_tile(res, size):
    """A data tile's values (size x size), NaN where it has none"""
    import numpy as np
    from dji_thermal_ui.analyzer import api as api_module
    assert (res.status_code, res['Content-Type']) == (200, 'application/octet-stream')
    values = np.frombuffer(res.content, dtype='<f4').reshape(size, size).astype(np.float64)
    return np.where(values == np.float32(api_module.NO_DATA), np.nan, values)


def test_mosaics_are_sent_as_data_tiles_with_a_gutter_for_the_browser_to_colour(api):
    import numpy as np
    from dji_thermal_ui.analyzer import api as api_module
    c, _ = converted(api)
    size = api_module.DATA_TILE_SIZE + 2 * api_module.DATA_GUTTER
    g = api_module.DATA_GUTTER
    (z, x, y), _ = mosaic_tile()
    data = "{}/{}/mosaics/{{}}/data/{}/{}/{}".format(CONVERSIONS, c.id, z, x, y)

    # Temperatures, with no data around the mosaic, in its corner and where dji-thermal-cli marked none
    res = api.get(data.format('as_converted'))
    t = data_tile(res, size)
    shown = t[np.isfinite(t)]
    assert shown.size and np.isnan(t).any()
    assert shown.min() >= 10 and shown.max() <= 30
    # The tile's own pixels are what an unbuffered read gives (nearest pixel)
    raster = os.path.join(c.data_dir(), c.mosaics['kinds']['as_converted']['raster'])
    with mosaics.open_raster(raster) as src:
        plain = src.tile(x, y, z, indexes=(1,), tilesize=256, resampling_method='nearest', reproject_method='nearest')
    expected = np.where((plain.mask > 0) & (plain.data[0] > -272), plain.data[0], np.nan)
    np.testing.assert_allclose(t[g:-g, g:-g], expected, rtol=1e-6)

    # The other tabs: each pixel's source frame, and its view angle
    frames = data_tile(api.get(data.format('source_frame')), size)
    assert set(np.unique(frames[np.isfinite(frames)])) == {0.0, 1.0}
    angles = data_tile(api.get(data.format('view_angle')), size)
    assert set(np.unique(angles[np.isfinite(angles)])) == {4.0}

    # Corrected for the emissivity asked: a lower one makes what is warmer than the reflected temperature warmer
    # still; a bad one is refused
    warmer = data_tile(api.get(data.format('as_converted'), {'emissivity': '0.8'}), size)
    assert np.array_equal(np.isnan(warmer), np.isnan(t))
    assert np.nanmax(warmer) > np.nanmax(t)
    assert api.get(data.format('as_converted'), {'emissivity': '2'}).status_code == 400

    # Cached until it changes, and only where there is a mosaic
    assert api.get(data.format('as_converted'), HTTP_IF_NONE_MATCH=res['ETag']).status_code == 304
    assert api.get(data.format('as_converted'), {'emissivity': '0.8'}, HTTP_IF_NONE_MATCH=res['ETag']).status_code == 200
    assert api.get(data.format('nope')).status_code == 404
    assert api.get("{}/{}/mosaics/as_converted/data/5/1/1".format(CONVERSIONS, c.id)).status_code == 404


def test_a_data_tiles_gutter_holds_its_neighbours_pixels(api):
    import numpy as np
    from dji_thermal_ui.analyzer import api as api_module
    c, _ = converted(api)
    size, g = api_module.DATA_TILE_SIZE + 2 * api_module.DATA_GUTTER, api_module.DATA_GUTTER
    # Zoomed in so far that the mosaic spans tiles: the gutter on the east is the next tile's west edge
    (z, x, y), _ = mosaic_tile(24)
    data = "{}/{}/mosaics/view_angle/data/{}/{{}}/{}".format(CONVERSIONS, c.id, z, y)
    here, east = data_tile(api.get(data.format(x)), size), data_tile(api.get(data.format(x + 1)), size)
    assert np.isfinite(here[g:-g, -g:]).any()
    assert np.array_equal(np.isfinite(here[g:-g, -g:]), np.isfinite(east[g:-g, g:2 * g]))


def test_a_difference_is_sent_as_data_tiles_in_the_first_mosaics_unit(api):
    import numpy as np
    from dji_thermal_ui.analyzer import api as api_module
    a, _ = converted(api)
    b, _ = converted(api, {'unit': 'F'})
    (z, x, y), _ = mosaic_tile()
    data = "{}/{}/mosaics/{{}}/difference/data/{}/{}/{}".format(CONVERSIONS, a.id, z, x, y)
    size = api_module.DATA_TILE_SIZE

    same = data_tile(api.get(data.format('as_converted'), {'b': a.id}), size)
    assert np.isfinite(same).any()
    assert (same[np.isfinite(same)] == 0).all()
    # B, 50 °F (10 °C) everywhere, over the east half of A: A - B in °C there, no data elsewhere
    write_flat_mosaic(b, 50.0, 1.6)
    res = api.get(data.format('as_converted'), {'b': b.id})
    shifted = data_tile(res, size)
    d = shifted[np.isfinite(shifted)]
    assert 0 < d.size < np.isfinite(same).sum() * 0.6
    assert d.min() == pytest.approx(mosaic_temperature(32) - 10, abs=0.4)
    assert d.max() == pytest.approx(20, abs=0.4)

    assert api.get(data.format('as_converted'), {'b': b.id}, HTTP_IF_NONE_MATCH=res['ETag']).status_code == 304
    write_flat_mosaic(b, 50.0, 10)
    assert api.get(data.format('as_converted'), {'b': b.id}, HTTP_IF_NONE_MATCH=res['ETag']).status_code == 200
    assert api.get(data.format('as_converted'), {'b': 'x'}).status_code == 400
    assert api.get(data.format('source_frame'), {'b': a.id}).status_code == 404


def test_the_palette_the_map_pages_start_with_is_chosen_in_the_preferences(api):
    res = api.get(PREFERENCES).data
    assert res['palette'] == ""
    keys = [p['key'] for p in res['view_palettes']]
    assert keys[0] == 'dji_whitehot' and 'ironbow' in keys and 'viridis' in keys
    gray = next(p for p in res['view_palettes'] if p['key'] == 'gray')
    assert (gray['label'], len(gray['color_map']), gray['color_map'][-1]) == ('White hot', 256, 0xffffffff)
    assert api.put(PREFERENCES, {'palette': 'dji_ironred'}, format='json').data == {'palette': 'dji_ironred'}
    assert api.get(PREFERENCES).data['palette'] == 'dji_ironred'
    for bad in ('rdbu_r', 'ironred', None, 3):
        res = api.put(PREFERENCES, {'palette': bad}, format='json')
        assert res.status_code == 400 and str(res.data['palette']).startswith('One of "", dji_whitehot')
    assert api.get(PREFERENCES).data['palette'] == 'dji_ironred'


def test_the_preferences_preview_each_palette_dji_s_as_the_newest_flight_holds_them(api):
    # Without a converted flight: the app's colour maps only, and each flight's own palette is ironbow
    res = api.get(PREFERENCES).data
    assert not [p for p in res['view_palettes'] if p['key'].startswith('dji_') and 'color_map' in p]
    assert all(len(p['color_map']) == 256 for p in res['view_palettes'] if not p['key'].startswith('dji_'))
    assert res['images_palette'] == 'ironbow'
    converted(api)
    res = api.get(PREFERENCES).data
    ironred = next(p for p in res['view_palettes'] if p['key'] == 'dji_ironred')
    assert len(ironred['color_map']) == 256
    assert res['images_palette'] == 'dji_ironred'
    # The preference does not change the images' own
    api.put(PREFERENCES, {'palette': 'magma'}, format='json')
    assert api.get(PREFERENCES).data['images_palette'] == 'dji_ironred'


def rebuild(api, c, make):
    """Builds the conversion's mosaics again with this make_mosaic, and answers with its row"""
    with mock.patch('dji_thermal_cli.api.make_mosaic', side_effect=make):
        res = api.post("{}/{}/mosaics".format(CONVERSIONS, c.id))
    assert res.status_code == 200, res.data
    c.refresh_from_db()
    return c


def mosaic_files(c):
    return sorted(p.name for p in Path(c.data_dir(), 'mosaics').rglob('*') if p.is_file())


def test_a_failed_rebuild_keeps_the_last_mosaics_and_says_why(api):
    from dji_thermal_cli import api as dji_api
    c, _make = converted(api)
    before, built = mosaic_files(c), c.mosaics

    def fail(path, output_dir, *args, **kw):
        os.makedirs(output_dir)
        Path(output_dir, 'partial.tif').write_bytes(b'0' * 100)
        raise dji_api.MosaicError("No frames to mosaic.", {})

    c = rebuild(api, c, fail)
    assert (c.mosaic_status, c.mosaic_error, c.run_id, c.mosaic_progress) == ('ready', "No frames to mosaic.", "", 0)
    assert c.mosaics == built and mosaic_files(c) == before
    assert not os.path.exists(mosaics.building_dir(c))


def test_a_canceled_rebuild_keeps_the_last_mosaics_and_its_partial_files_go(api):
    c, _make = converted(api)
    before, built, count = mosaic_files(c), c.mosaics, c.file_count

    def make(path, output_dir, *args, **kw):
        os.makedirs(output_dir)
        Path(output_dir, 'partial.tif').write_bytes(b'0' * 100)
        res = api.post("{}/{}/cancel".format(CONVERSIONS, c.id))
        assert (res.data['mosaic_status'], res.data['mosaic_error']) == ('ready', "")
        return fake_make_mosaic(path, output_dir, *args, **kw)

    c = rebuild(api, c, make)
    assert (c.mosaic_status, c.mosaics, c.file_count) == ('ready', built, count)
    assert mosaic_files(c) == before
    assert not os.path.exists(mosaics.building_dir(c))


def test_the_last_mosaics_can_be_read_while_they_are_built_again(api):
    c, _make = converted(api)
    (z, x, y), _ = mosaic_tile()
    seen = []

    def make(path, output_dir, *args, **kw):
        tile = "{}/{}/mosaics/as_converted/data/{}/{}/{}".format(CONVERSIONS, c.id, z, x, y)
        viewer = api.get("{}/{}/mosaics".format(CONVERSIONS, c.id)).data
        seen.append((api.get(tile).status_code, viewer['mosaic_status'], len(viewer['tabs']) > 0,
                     api.get("{}/{}/download".format(CONVERSIONS, c.id)).status_code))
        with zipfile.ZipFile(io.BytesIO(b"".join(api.get("{}/{}/download".format(CONVERSIONS, c.id)).streaming_content))) as z_:
            seen.append([n for n in z_.namelist() if mosaics.BUILDING_DIR in n])
        Path(output_dir).mkdir(parents=True)
        Path(output_dir, 'partial.tif').write_bytes(b'0')
        assert api.get("{}/{}/download".format(CONVERSIONS, c.id), {
            'file': "{}/mosaics/{}/partial.tif".format(mosaics.BUILDING_DIR, Path(output_dir).name)
        }).status_code == 404
        return fake_make_mosaic(path, output_dir, *args, **kw)

    first = c.mosaics['built_at']
    with mock.patch.object(jobs, 'alive', return_value=True):
        c = rebuild(api, c, make)
    assert seen == [(200, 'building', True, 200), []]
    assert c.mosaic_status == 'ready' and c.mosaics['built_at'] > first


def test_a_rebuild_interrupted_by_a_restart_goes_back_to_the_last_mosaics(api):
    c, _make = converted(api)
    os.makedirs(os.path.join(mosaics.building_dir(c), 'mosaics'))
    ThermalConversion.objects.filter(pk=c.pk).update(mosaic_status='building', run_id="gone", mosaic_progress=0.5)
    assert jobs.mark_interrupted() == 1
    c.refresh_from_db()
    assert (c.mosaic_status, c.mosaic_error, c.run_id) == ('ready', jobs.INTERRUPTED, "")
    assert not os.path.exists(mosaics.building_dir(c))


def test_a_rebuild_whose_job_is_gone_goes_back_to_the_last_mosaics(api):
    c, _make = converted(api)
    os.makedirs(os.path.join(mosaics.building_dir(c), 'mosaics'))
    ThermalConversion.objects.filter(pk=c.pk).update(mosaic_status='building', run_id="gone", mosaic_progress=0.5)
    res = api.get("{}/{}/mosaics".format(CONVERSIONS, c.id))
    assert (res.data['mosaic_status'], res.data['mosaic_error']) == ('ready', "The mosaic job stopped before it finished")
    assert res.data['tabs']
    assert not os.path.exists(mosaics.building_dir(c))


def test_a_swap_that_cannot_finish_puts_the_last_mosaics_back(api):
    c, _make = converted(api)
    before = mosaic_files(c)
    real = os.rename
    renames = []

    def rename(src, dst):
        renames.append(src)
        if len(renames) == 3:       # the last ones are aside, the new ones not all in place
            raise PermissionError("in use")
        return real(src, dst)

    with mock.patch('dji_thermal_cli.api.make_mosaic', side_effect=fake_make_mosaic), \
            mock.patch.object(mosaics, 'SWAP_WAIT', 0), mock.patch('os.rename', side_effect=rename):
        api.post("{}/{}/mosaics".format(CONVERSIONS, c.id))
    c.refresh_from_db()
    assert (c.mosaic_status, c.mosaic_error) == ('ready', "in use")
    assert mosaic_files(c) == before
    assert os.path.isdir(os.path.join(c.data_dir(), 'viewer'))
