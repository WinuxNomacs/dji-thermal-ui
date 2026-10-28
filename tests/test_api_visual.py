"""The visual mosaic: built with a conversion's mosaics when the dataset has visual frames, copied for the map, served
as tiles, and each thermal frame paired with its visual frame"""
import io
import json
import os
import zipfile
from pathlib import Path
from unittest import mock

import numpy as np
import pytest

from dji_thermal_ui.analyzer import thermal_conversion, thermal_mosaics
from dji_thermal_ui.analyzer.models import ThermalDataset
from tests.fakes import (CONVERSIONS, DATASETS, THERMAL_MODELS, VISUAL_FILES, VISUAL_MODELS, analysed, converted,
                         fake_measure, fake_visual, frame_models, mosaic_lonlat, write_frame_models, write_mosaic)

THERMAL_FILES = tuple(m[0] for m in THERMAL_MODELS)
PAIRED = THERMAL_FILES + VISUAL_FILES


def visual_conversion(api, settings=None):
    c, make = converted(api, settings, names=PAIRED)
    return analysed(c), make


@pytest.fixture
def conversion(api):
    return visual_conversion(api)[0]


def tile_of(lon, lat, z):
    import math
    x = (lon + 180) / 360 * 2 ** z
    y = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * 2 ** z
    return int(x), int(y)


def test_the_homography_finds_a_ground_point_where_the_visual_frame_saw_it(tmp_path):
    from dji_thermal_cli import api
    write_frame_models(tmp_path / 't.json', THERMAL_MODELS)
    write_frame_models(tmp_path / 'v.json', VISUAL_MODELS)
    t_models, v_models = api.read_frame_models(tmp_path / 't.json'), api.read_frame_models(tmp_path / 'v.json')
    lon, lat = np.array([mosaic_lonlat(c, r) for c, r in ((0, 0), (32, 20), (63, 63), (-40, 90))]).T
    for k in range(2):
        t, v = t_models.pixels(lon, lat)[k], v_models.pixels(lon, lat)[k]
        h = thermal_mosaics.homography(frame_models(THERMAL_MODELS)['frames'][k], frame_models(VISUAL_MODELS)['frames'][k])
        q = (h @ np.c_[t, np.ones(len(t))].T).T
        assert np.allclose(q[:, :2] / q[:, 2:], v, atol=0.01)


def test_the_pairs_are_read_from_the_two_mosaics_sidecars(tmp_path):
    rows = [{'file': VISUAL_FILES[1], 'thermal_file': THERMAL_FILES[1]}, {'file': 'gone_V.JPG', 'thermal_file': 'x'}]
    write_frame_models(tmp_path / 't.json', THERMAL_MODELS)
    write_frame_models(tmp_path / 'v.json', VISUAL_MODELS, frames=rows)
    pairs = thermal_mosaics.visual_pairs(tmp_path / 't.json', tmp_path / 'v.json')
    assert list(pairs) == [THERMAL_FILES[1]]
    assert pairs[THERMAL_FILES[1]]['frame'] == VISUAL_FILES[1]
    assert (pairs[THERMAL_FILES[1]]['width'], pairs[THERMAL_FILES[1]]['height']) == (4032, 3024)
    assert len(pairs[THERMAL_FILES[1]]['homography']) == 9


def test_a_conversion_builds_the_visual_mosaic_beside_the_thermal_ones(conversion):
    c = conversion
    assert c.mosaic_status == 'ready', c.mosaic_error
    v = c.mosaics['visual']
    assert v['files'] == ['mosaics/visual/mosaic_visual.json', 'mosaics/visual/mosaic_visual.tif',
                          'mosaics/visual/mosaic_visual_preview.png']
    assert (v['frames'], v['skipped'], v['pairs']) == (2, 0, 2)
    assert (v['unpaired_thermal'], v['unused_visual']) == (0, 1)
    assert v['report']['camera_offset']['applied'] is True
    assert not os.path.exists(os.path.join(c.data_dir(), 'mosaics', 'harmonized', 'mosaic_visual.tif'))
    assert 'visual' not in c.mosaics['kinds']


def test_the_map_copy_is_tiled_jpeg_with_its_alpha_as_a_mask_and_overviews(tmp_path):
    import rasterio
    from rasterio.transform import from_origin
    src = tmp_path / 'src.tif'
    rgba = np.full((4, 600, 700), 120, np.uint8)
    rgba[3, :100, :100] = 0
    with rasterio.open(src, 'w', driver='GTiff', width=700, height=600, count=4, dtype='uint8', crs='EPSG:32616',
                       transform=from_origin(399000, 4661700, 0.01, 0.01)) as dst:
        dst.write(rgba)
    out = thermal_mosaics.map_copy(src, tmp_path / 'map.tif')
    with rasterio.open(out) as ds:
        assert ds.count == 3 and ds.compression.name == 'jpeg'
        assert ds.block_shapes[0] == (thermal_mosaics.VISUAL_TILE, thermal_mosaics.VISUAL_TILE)
        assert ds.overviews(1) == [2]
        mask = ds.dataset_mask()
        assert mask[:100, :100].max() == 0 and mask[100:, 100:].min() == 255


def test_the_viewer_gets_the_visual_mosaic_without_its_raster(api, conversion):
    res = api.get("{}/{}/mosaics".format(CONVERSIONS, conversion.id))
    v = res.data['visual']
    assert 'raster' not in v and v['bounds'] and v['maxzoom'] >= v['minzoom']
    assert res.data['visual_note'] == ""
    assert [t['tab'] for t in res.data['tabs']] == ['as_converted', 'harmonized', 'source_frame', 'view_angle']


def test_its_tiles_are_pngs_with_alpha_and_none_outside_it(api, conversion):
    v = conversion.mosaics['visual']
    z = v['maxzoom']
    x, y = tile_of(*mosaic_lonlat(32, 32), z)
    url = "{}/{}/mosaics/visual/tiles/{}/{}/{}.png".format(CONVERSIONS, conversion.id, z, x, y)
    res = api.get(url)
    assert res.status_code == 200 and res['Content-Type'] == 'image/png'
    from PIL import Image
    assert Image.open(io.BytesIO(res.content)).mode == 'RGBA'
    assert api.get(url, HTTP_IF_NONE_MATCH=res['ETag']).status_code == 304
    assert api.get("{}/{}/mosaics/visual/tiles/{}/0/0.png".format(CONVERSIONS, conversion.id, z)).status_code == 404


def test_a_conversion_without_the_visual_mosaic_has_no_tiles(api):
    c, make = converted(api, {'visual': False}, names=PAIRED)
    assert make.call_args.args[3].visual is False
    assert 'visual' not in c.mosaics
    assert api.get("{}/{}/mosaics/visual/tiles/20/0/0.png".format(CONVERSIONS, c.id)).status_code == 404
    assert api.get("{}/{}/mosaics".format(CONVERSIONS, c.id)).data['visual'] is None


def test_a_dataset_without_visual_frames_says_why_there_is_no_visual_mosaic(api):
    c, make = converted(api)
    assert make.call_args.args[3].visual is True
    assert 'visual' not in c.mosaics
    assert "no visual frames" in api.get("{}/{}/mosaics".format(CONVERSIONS, c.id)).data['visual_note']


def test_the_option_is_on_unless_switched_off():
    assert thermal_conversion.parse_settings({})[0]['visual'] is True
    assert thermal_conversion.parse_settings({'visual': False})[0]['visual'] is False


def test_a_stripped_conversion_maps_and_pairs_a_located_copy_it_then_removes(api):
    def located(m, path, compression, located):
        assert located is True
        made = fake_visual(Path(path).parent)
        os.replace(made.file, path)
        os.replace(made.sidecar, Path(path).with_suffix('.json'))
        os.remove(made.preview)
        return Path(path), Path(path).with_suffix('.json')
    def thermal_located(m, path, compression, unit, located=True):
        write_mosaic(Path(path))
        write_frame_models(Path(path).with_suffix('.json'), THERMAL_MODELS)
        return Path(path), Path(path).with_suffix('.json')

    with mock.patch('dji_thermal_cli.visual.write', side_effect=located) as write, \
            mock.patch('dji_thermal_cli.mosaic.write', side_effect=thermal_located):
        c, _make = converted(api, {'strip_location': True}, names=PAIRED)
    assert write.called and c.mosaic_status == 'ready', c.mosaic_error
    assert sorted(os.listdir(os.path.join(c.data_dir(), 'viewer'))) == [
        'as_converted.json', 'as_converted.tif', 'harmonized.json', 'harmonized.tif', 'palettes.json',
        'visual.tif', 'visual_pairs.json']
    assert c.mosaics['visual']['pairs'] == 2


def test_a_frame_and_the_sources_of_a_spot_give_the_visual_pair(api, conversion):
    c = conversion
    with mock.patch('dji_thermal_cli.api.measure', side_effect=fake_measure):
        res = api.get("{}/{}/frame".format(CONVERSIONS, c.id), {'frame': THERMAL_FILES[0]})
    assert res.status_code == 200, res.data
    assert res.data['visual']['frame'] == VISUAL_FILES[0]
    pairs = thermal_mosaics.read_visual_pairs(c.data_dir())
    assert pairs[THERMAL_FILES[0]]['frame'] == VISUAL_FILES[0]
    res = api.post("{}/{}/mosaics/as_converted/sources".format(CONVERSIONS, c.id),
                   {'geometry': {'type': 'Point', 'coordinates': mosaic_lonlat(32, 32)}}, format='json')
    assert res.status_code == 200, res.data
    assert res.data['frames'] and all(f['visual']['frame'] == VISUAL_FILES[THERMAL_FILES.index(f['frame'])]
                                      for f in res.data['frames'])


def test_the_visual_frame_is_served_as_a_jpeg_at_the_size_asked(api, conversion):
    from PIL import Image
    url = "{}/{}/frame/visual".format(CONVERSIONS, conversion.id)
    res = api.get(url, {'frame': THERMAL_FILES[1]})
    assert res.status_code == 200 and res['Content-Type'] == 'image/jpeg'
    assert Image.open(io.BytesIO(res.content)).size == (8, 8)
    res = api.get(url, {'frame': THERMAL_FILES[1], 'size': 4})
    assert Image.open(io.BytesIO(res.content)).size == (4, 4)
    assert api.get(url, {'frame': 'nope.JPG'}).status_code == 404
    assert api.get(url, {'frame': THERMAL_FILES[1], 'size': 'big'}).status_code == 400


def test_the_download_has_the_visual_mosaic_and_not_the_map_copy(api, conversion):
    res = api.get("{}/{}/download".format(CONVERSIONS, conversion.id))
    names = zipfile.ZipFile(io.BytesIO(b"".join(res.streaming_content))).namelist()
    assert 'mosaics/visual/mosaic_visual.tif' in names
    assert not any(n.startswith('viewer/') for n in names)


def test_the_dataset_counts_its_visual_images(api, conversion):
    rows = [{'path': n, 'kind': 'thermal'} for n in THERMAL_FILES] + \
        [{'path': n, 'kind': 'not_thermal'} for n in VISUAL_FILES] + \
        [{'path': 'other.JPG', 'kind': 'not_thermal'}, {'path': 'x_V.JPG', 'kind': 'corrupt'}]
    ThermalDataset.objects.filter(pk=conversion.dataset_id).update(analysis={'files': rows})
    res = api.get("{}/{}".format(DATASETS, conversion.dataset_id))
    assert res.data['visual'] == 2


def test_removing_the_mosaics_removes_the_visual_one(conversion):
    thermal_mosaics.remove(conversion)
    assert thermal_mosaics.read_visual_pairs(conversion.data_dir()) == {}
    assert not os.path.exists(os.path.join(conversion.data_dir(), 'mosaics', 'visual'))
    assert json.dumps(thermal_mosaics.visual_raster(conversion.data_dir(), {})) == 'null'
