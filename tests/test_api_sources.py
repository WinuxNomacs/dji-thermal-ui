"""The source frames of a spot or an area of a mosaic, through the API: every frame that saw it from the mosaic's frame
models, or only those it used in a mosaic built before dji-thermal-cli 1.5.0"""

from unittest import mock

import numpy as np
import pytest

from tests.fakes import CONVERSIONS, MOSAIC_ORIGIN, analysed, converted, mosaic_lonlat, mosaic_square

FILES = ('100MEDIA/DJI_0001_T.JPG', '100MEDIA/DJI_0002_T.JPG', '100MEDIA/DJI_0003_T.JPG')
# What each fake frame saw of the fake mosaic (its columns), its pixel there (from the mosaic's column and row, centres
# at whole numbers) and its view angle: the mosaic took the left half from the first and the right half from the
# second; the third, which it did not use, saw all of it
SEEN = ((0, 40, lambda c, r: (2 * c, 2 * r), 5.0), (24, 64, lambda c, r: (2 * (c - 24), 2 * r), 6.0),
        (0, 64, lambda c, r: (c, r), 2.0))


class FakeModels:
    """dji-thermal-cli's FrameModels of the fake mosaic"""
    files = FILES

    def __init__(self):
        self.footprints = tuple(np.array([mosaic_lonlat(c0, 0), mosaic_lonlat(c1, 0), mosaic_lonlat(c1, 64),
                                          mosaic_lonlat(c0, 64)]) for c0, c1, _p, _a in SEEN)

    def _grid(self, lon, lat):
        from pyproj import Transformer
        e, n = Transformer.from_crs('EPSG:4326', 'EPSG:32616', always_xy=True).transform(
            np.atleast_1d(np.asarray(lon, float)), np.atleast_1d(np.asarray(lat, float)))
        return (e - MOSAIC_ORIGIN[0]) / 0.05 - 0.5, (MOSAIC_ORIGIN[1] - n) / 0.05 - 0.5

    def pixels(self, lon, lat):
        c, r = self._grid(lon, lat)
        out = np.full((len(SEEN), c.size, 2), np.nan)
        for k, (c0, c1, pixel, _a) in enumerate(SEEN):
            seen = (c >= c0 - 0.5) & (c < c1 - 0.5) & (r >= -0.5) & (r < 63.5)
            out[k][seen] = np.column_stack(pixel(c[seen], r[seen]))
        return out

    def view_angles(self, lon, lat):
        seen = np.isfinite(self.pixels(lon, lat)[:, :, 0])
        return np.where(seen, np.array([a for *_x, a in SEEN])[:, None], np.nan)


@pytest.fixture
def mosaic(api):
    c, _make = converted(api)
    analysed(c)
    return c, "{}/{}/mosaics/{{}}/sources".format(CONVERSIONS, c.id)


def centre(col, row):
    return {'type': 'Point', 'coordinates': mosaic_lonlat(col + 0.5, row + 0.5)}


def test_a_spot_lists_every_frame_that_saw_it_the_one_the_mosaic_used_first(api, mosaic):
    c, url = mosaic
    with mock.patch('dji_thermal_cli.api.read_frame_models', return_value=FakeModels()):
        res = api.post(url.format('harmonized'), {'geometry': centre(10, 20)}, format='json')
    assert res.status_code == 200
    d = res.data
    assert (d['kind'], d['models'], d['reason']) == ('Point', True, None)
    # The used frame's pixel is the mosaic's own (its pixel bands); the others' come from their models
    assert [(f['frame'], f['used'], f['pixel'], f['view_angle']) for f in d['frames']] == [
        (FILES[0], True, [110.0, 220.0], 5.0), (FILES[2], False, [10.0, 20.0], 2.0)]
    assert d['frames'][0]['time'] == '2026:10:12 18:29:50'
    assert d['frames'][1]['time'] == ""
    # With the mosaic's values there, as the point endpoint gives them
    assert (d['point']['frame'], d['point']['frame_pixel']) == (FILES[0], [110, 220])


def test_an_area_lists_the_frames_the_mosaic_used_in_it_then_the_others_with_their_outlines(api, mosaic):
    c, url = mosaic
    with mock.patch('dji_thermal_cli.api.read_frame_models', return_value=FakeModels()):
        d = api.post(url.format('as_converted'), {'geometry': mosaic_square(20, 20, 45, 30)}, format='json').data
    assert (d['kind'], d['models'], d['reason']) == ('Polygon', True, None)
    assert 'point' not in d
    # The mosaic took 12 of the area's 25 columns from the first frame and 13 from the second: the second first
    assert [(f['frame'], f['used'], f['used_share'], f['share']) for f in d['frames']] == [
        (FILES[1], True, 0.52, 0.84), (FILES[0], True, 0.48, 0.8), (FILES[2], False, 0.0, 1.0)]
    # The area's outline in each frame's pixels, cut to what the frame saw
    third = np.array(d['frames'][2]['outline'][0])
    assert len(d['frames'][2]['outline']) == 1 and len(third) > 4
    assert third[:, 0].min() == pytest.approx(19.7, abs=0.05) and third[:, 0].max() == pytest.approx(44.3, abs=0.05)
    assert third[:, 1].min() == pytest.approx(19.7, abs=0.05) and third[:, 1].max() == pytest.approx(29.3, abs=0.05)
    # The second frame saw the area from the mosaic's column 24 (a quarter of a pixel inside it: its pixel -0.5)
    second = np.array(d['frames'][0]['outline'][0])
    assert second[:, 0].min() == pytest.approx(-0.5, abs=0.05) and second[:, 0].max() == pytest.approx(40.6, abs=0.05)
    first = np.array(d['frames'][1]['outline'][0])
    assert first[:, 0].min() == pytest.approx(39.4, abs=0.05) and first[:, 0].max() == pytest.approx(78.5, abs=0.05)


def test_outside_the_mosaic_no_frame_is_listed(api, mosaic):
    c, url = mosaic
    far = {'type': 'Point', 'coordinates': [0, 0]}
    with mock.patch('dji_thermal_cli.api.read_frame_models', return_value=FakeModels()):
        assert api.post(url.format('as_converted'), {'geometry': far}, format='json').data['frames'] == []
        d = api.post(url.format('as_converted'), {'geometry': {'type': 'Polygon', 'coordinates': [
            [[0, 0], [0.001, 0], [0.001, 0.001], [0, 0]]]}}, format='json').data
    assert (d['frames'], d['reason']) == ([], 'outside_raster')
    # Without frame models, none where the mosaic has no data
    d = api.post(url.format('as_converted'), {'geometry': centre(2, 2)}, format='json').data
    assert (d['frames'], d['reason']) == ([], 'nodata')


def test_a_mosaic_without_frame_models_lists_only_the_frames_it_used(api, mosaic):
    c, url = mosaic
    d = api.post(url.format('source_frame'), {'geometry': centre(40, 20)}, format='json').data
    assert d['models'] is False
    assert [(f['frame'], f['used'], f['pixel'], f['view_angle']) for f in d['frames']] == [
        (FILES[1], True, [140.0, 220.0], 4.0)]
    d = api.post(url.format('as_converted'), {'geometry': mosaic_square(20, 20, 45, 30)}, format='json').data
    assert [(f['frame'], f['used_share'], f['share'], f['outline'], f['view_angle']) for f in d['frames']] == [
        (FILES[1], 0.52, None, [], 4.0), (FILES[0], 0.48, None, [], 4.0)]


def test_a_line_lists_the_frames_that_saw_a_strip_along_it_outlined_in_each(api, mosaic):
    c, url = mosaic
    # A Delta T across the middle: from the first frame's half to the second's, the third seeing all of it
    line = {'type': 'LineString', 'coordinates': [mosaic_lonlat(10.5, 30.5), mosaic_lonlat(50.5, 30.5)]}
    with mock.patch('dji_thermal_cli.api.read_frame_models', return_value=FakeModels()):
        d = api.post(url.format('as_converted'), {'geometry': line}, format='json').data
    assert (d['kind'], d['geometry'], d['models']) == ('LineString', line, True)
    assert sorted((f['frame'], f['used']) for f in d['frames']) == [(FILES[0], True), (FILES[1], True), (FILES[2], False)]
    assert d['frames'][2]['share'] == 1.0 and all(f['outline'] for f in d['frames'])
    # The strip is a spot's disc wide (0.25 m, 5 px of the mosaic), outlined in the third frame's pixels
    xs, ys = zip(*d['frames'][2]['outline'][0])
    assert (min(xs), max(xs)) == pytest.approx((10.5 - 5, 50.5 + 5), abs=0.5)
    assert (min(ys), max(ys)) == pytest.approx((30.5 - 5, 30.5 + 5), abs=0.5)
    far = {'type': 'LineString', 'coordinates': [mosaic_lonlat(500, 500), mosaic_lonlat(510, 500)]}
    assert api.post(url.format('as_converted'), {'geometry': far}, format='json').data['frames'] == []


def test_a_geometry_and_a_mosaic_tab_are_asked_for(api, mosaic):
    c, url = mosaic
    assert api.post(url.format('as_converted'), {}, format='json').status_code == 400
    assert api.post(url.format('nope'), {'geometry': centre(10, 10)}, format='json').status_code == 404
