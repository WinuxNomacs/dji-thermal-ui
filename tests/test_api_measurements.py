"""Measuring the mosaics and the frames through the API: spots, lines, areas, isotherms, corrections, the
colouring's adjustments, and the saved measurements and their exports (ported from LuxODM's
app/tests/test_thermal_analyzer_plugin.py, commit a2a81052, without its sharing and its pages; the exports are in
the app's unit)"""

import csv
import io
import json
import os
from types import SimpleNamespace
from unittest import mock

import numpy as np
import pytest

from dji_thermal_ui.analyzer import thermal_measure as measuring
from dji_thermal_ui.analyzer import thermal_mosaics as mosaics
from dji_thermal_ui.analyzer.models import ThermalConversion, ThermalDataset, ThermalMeasurement
from dji_thermal_ui.analyzer.raster.thermal_correction import corrected_array
from tests.fakes import (CONVERSIONS, DATASETS, PREFERENCES, analysed, converted, dataset, fake_measure, fake_process,
                         mosaic_lonlat, mosaic_square, mosaic_temperature, mosaic_tile, uploaded)


def csv_rows(client, c):
    res = client.get("{}/{}/measurements.csv".format(CONVERSIONS, c.id))
    return list(csv.DictReader(io.StringIO(res.content.decode("utf-8-sig"))))


def test_spots_lines_and_areas_measure_the_mosaics_and_their_surroundings(api):
    c, _ = converted(api)
    url = "{}/{}/measure".format(CONVERSIONS, c.id)
    res = api.post(url, {'target': 'as_converted', 'geometry': mosaic_square(32, 16, 48, 32),
                         'isotherm': 'above,{}'.format(mosaic_temperature(39.5))}, format='json')
    assert res.status_code == 200, res.data
    assert not res.data['approximate']
    r = res.data['result']
    assert (r['kind'], r['valid_pixels'], r['reason']) == ('Polygon', 256, None)
    assert r['mean'] == pytest.approx(mosaic_temperature(39.5), abs=1e-3)
    assert r['min'] == pytest.approx(mosaic_temperature(32), abs=1e-3)
    assert r['max'] == pytest.approx(mosaic_temperature(47), abs=1e-3)
    assert r['area'] == pytest.approx((15.6 * 0.05) ** 2, abs=1e-3)
    # The hottest pixel: the east edge's (the first of its column)
    assert r['max_location'] == pytest.approx(mosaic_lonlat(47.5, 16.5), abs=1e-7)
    # Half of it is above its mean; the surroundings are a ring around it, its ΔT their difference
    assert r['isotherm'] == {'pixels': 128, 'share': 0.5}
    assert r['delta_t'] == pytest.approx(r['mean'] - r['surroundings'], abs=1e-6)
    assert sum(r['histogram'][0]) == 256
    # The harmonized mosaic is half a degree warmer
    h = api.post(url, {'target': 'harmonized', 'geometry': mosaic_square(32, 16, 48, 32)}, format='json').data['result']
    assert h['mean'] - r['mean'] == pytest.approx(0.5, abs=1e-3)

    # A spot: the pixel's own value and the mean of a disc around it; a line: a strip along it
    spot = api.post(url, {'target': 'as_converted', 'geometry': {'type': 'Point', 'coordinates': mosaic_lonlat(32.5, 32.5)}},
                    format='json').data['result']
    assert spot['value'] == pytest.approx(mosaic_temperature(32), abs=1e-3)
    assert spot['mean'] == pytest.approx(mosaic_temperature(32), abs=0.1)
    assert spot['valid_pixels'] > 50
    line = api.post(url, {'target': 'as_converted', 'geometry': {'type': 'LineString', 'coordinates': [
        mosaic_lonlat(20, 30), mosaic_lonlat(40, 30)]}}, format='json').data['result']
    assert line['length'] == pytest.approx(1.0, abs=1e-3)
    assert line['mean'] == pytest.approx(mosaic_temperature(29.5), abs=0.2)

    # All of it: no data and dji-thermal-cli's absolute-zero marker left out
    whole = api.post(url, {'target': 'as_converted', 'geometry': None}, format='json').data['result']
    assert (whole['kind'], whole['valid_pixels']) == ('mosaic', 64 * 64 - 64 - 16)
    assert whole['min'] >= 10
    assert len(whole['percentiles']) == 2

    far = api.post(url, {'target': 'as_converted', 'geometry': {'type': 'Point', 'coordinates': mosaic_lonlat(500, 500)}},
                   format='json').data['result']
    assert (far['valid_pixels'], far['reason']) == (0, 'outside_raster')
    nodata = api.post(url, {'target': 'as_converted', 'geometry': mosaic_square(0, 0, 8, 8)}, format='json').data['result']
    assert (nodata['valid_pixels'], nodata['reason']) == (0, 'nodata')
    for bad in ({'target': 'source_frame', 'geometry': None},
                {'target': 'as_converted', 'geometry': {'type': 'Polygon', 'coordinates': [[[0, 0], [1, 1]]]}},
                {'target': 'as_converted', 'geometry': {'type': 'Point', 'coordinates': [200, 0]}},
                {'target': 'as_converted', 'geometry': None, 'isotherm': 'over,3'},
                {'target': 'as_converted', 'geometry': None, 'isotherm': 'between,5,1'}):
        assert api.post(url, bad, format='json').status_code == 400, bad


def test_the_mosaics_are_corrected_approximately_for_another_emissivity_or_reflected_temperature(api):
    c = analysed(converted(api)[0])
    v = api.get("{}/{}/mosaics".format(CONVERSIONS, c.id)).data
    # What the mosaics were measured with: the conversion's own, else the flight's (the harmonized one: the
    # normalization's reflected temperature)
    assert v['baselines']['as_converted'] == {'emissivity': 0.91, 'reflected_temp': 27.6}
    assert v['baselines']['harmonized'] == {'emissivity': 0.91, 'reflected_temp': 27.2}

    url = "{}/{}/measure".format(CONVERSIONS, c.id)
    square = mosaic_square(32, 16, 48, 32)
    base = api.post(url, {'target': 'as_converted', 'geometry': square}, format='json').data
    same = api.post(url, {'target': 'as_converted', 'geometry': square,
                          'parameters': {'emissivity': 0.91, 'reflected_temp': ''}}, format='json').data
    assert not same['approximate']
    lower = api.post(url, {'target': 'as_converted', 'geometry': square, 'parameters': {'emissivity': 0.85}},
                     format='json').data
    assert lower['approximate']
    # Below the reflected temperature, a lower emissivity means a colder surface than measured (less of what is
    # seen is reflected warmth)
    assert lower['result']['mean'] < base['result']['mean']
    assert lower['result']['min'] == pytest.approx(
        float(corrected_array([mosaic_temperature(32)], (0.85, 1, 27.6, 20), (0.91, 1, 27.6, 20))[0]), abs=1e-3)
    assert api.post(url, {'target': 'as_converted', 'parameters': {'emissivity': 3}}, format='json').status_code == 400

    _, (lon, lat) = mosaic_tile()
    point = "{}/{}/mosaics/as_converted/point".format(CONVERSIONS, c.id)
    plain = api.get(point, {'lon': lon, 'lat': lat}).data['temperature']
    corrected = api.get(point, {'lon': lon, 'lat': lat, 'emissivity': '0.85'}).data['temperature']
    assert corrected < plain


def test_delta_t_around_a_point_compares_its_pixel_with_the_mean_of_the_others_in_a_circle():
    from affine import Affine
    from shapely.geometry import Point
    values = np.tile(np.arange(7, dtype=float), (7, 1))
    values[3, 3] = 10.0         # the pixel at the point, left out of the circle's figures
    values[3, 1] = values[3, 5] = np.nan
    a = measuring.around_point(values, Affine.identity(), 3.5, 3.5, 2.0)
    assert (a['mean'], a['min'], a['max']) == (pytest.approx(3.0), 1.0, 5.0)
    assert a['delta_t'] == pytest.approx(7.0)
    assert a['radius'] == 2.0
    assert a['pixels'] == int(measuring.region_mask(Point(3.5, 3.5).buffer(2.0), values.shape, Affine.identity()).sum()) - 3
    # The temperature at the point given (as the point request read it) is what ΔT compares
    assert measuring.around_point(values, Affine.identity(), 3.5, 3.5, 2.0, at=4.0)['delta_t'] == pytest.approx(1.0)
    # No pixel with data: no figures
    empty = measuring.around_point(np.full((7, 7), np.nan), Affine.identity(), 3.5, 3.5, 2.0)
    assert (empty['pixels'], empty['mean'], empty['delta_t']) == (0, None, None)
    for bad, kind in (("0", 'mosaic'), ("10.5", 'mosaic'), ("51", 'frame'), ("wide", 'frame')):
        with pytest.raises(measuring.MeasureError):
            measuring.check_around(bad, kind)
    assert measuring.check_around("", 'mosaic') is None


def test_the_point_requests_answer_delta_t_around_the_point_when_asked(api):
    c = analysed(converted(api)[0])
    point = "{}/{}/mosaics/as_converted/point".format(CONVERSIONS, c.id)
    lon, lat = mosaic_lonlat(32.5, 32.5)
    assert 'around' not in api.get(point, {'lon': lon, 'lat': lat}).data
    res = api.get(point, {'lon': lon, 'lat': lat, 'around': '0.5'})
    assert res.status_code == 200, res.data
    a = res.data['around']
    # A circle of 10 px around the pixel of column 32: as warm as its column on average, the columns 22 to 42 in it
    assert a['radius'] == 0.5
    assert a['mean'] == pytest.approx(mosaic_temperature(32), abs=1e-3)
    assert a['delta_t'] == pytest.approx(res.data['temperature'] - a['mean'], abs=1e-6)
    assert a['min'] == pytest.approx(mosaic_temperature(22), abs=1e-3)
    assert a['max'] == pytest.approx(mosaic_temperature(42), abs=1e-3)
    assert a['pixels'] > 300
    # Corrected as the temperature is
    lower = api.get(point, {'lon': lon, 'lat': lat, 'around': '0.5', 'emissivity': '0.85'}).data
    assert lower['around']['mean'] < a['mean']
    assert lower['around']['delta_t'] == pytest.approx(lower['temperature'] - lower['around']['mean'], abs=1e-6)
    for bad in ('0', '10.5', 'wide'):
        assert api.get(point, {'lon': lon, 'lat': lat, 'around': bad}).status_code == 400, bad

    rel = '100MEDIA/DJI_0002_T.JPG'
    frame = "{}/{}/frame".format(CONVERSIONS, c.id)
    with mock.patch('dji_thermal_cli.api.measure', side_effect=fake_measure):
        assert 'around' not in api.get(frame + "/point", {'frame': rel, 'x': '3.5', 'y': '2.5'}).data
        # The 3 x 3 px around the pixel (3, 2), of 22 to 24 °C, on the frame as converted
        p = api.get(frame + "/point", {'frame': rel, 'x': '3.5', 'y': '2.5', 'around': '1.2',
                                       'emissivity': '0.95'}).data
        assert p['around'] == {'radius': 1.2, 'pixels': 8, 'mean': pytest.approx(23.0), 'min': 22.0, 'max': 24.0,
                               'delta_t': pytest.approx(0.0)}
        assert api.get(frame + "/point", {'frame': rel, 'x': '3.5', 'y': '2.5', 'around': '51'}).status_code == 400


def test_the_palettes_shares_are_bent_by_gamma_and_equalization_without_changing_the_temperatures():
    assert measuring.parse_adjust({}) == {'gamma': 1.0, 'equalize': False, 'sharpen': 0.0}
    assert measuring.parse_adjust({'gamma': '2', 'equalize': '1', 'sharpen': '1.5'}) == \
        {'gamma': 2.0, 'equalize': True, 'sharpen': 1.5}
    for bad in ({'gamma': '0.1'}, {'gamma': 'bright'}, {'sharpen': '6'}, {'equalize': 'yes'}):
        with pytest.raises(measuring.MeasureError):
            measuring.parse_adjust(bad)

    # Gamma bends the palette's shares; the range's ends stay where they are
    assert float(measuring.tone(np.array([15.0]), 10, 20, {'gamma': 2.0})[0]) == pytest.approx(0.5 ** 0.5)
    assert measuring.curve_shares(10, 20, {'gamma': 2.0})[0::64] == [0.0, 1.0]

    # Equalized, most of the palette goes to where most of the values are, within the range only
    values = np.concatenate([np.full(900, 10.0), np.linspace(10, 30, 100), [np.nan]])
    curve = measuring.equalization(measuring.value_histogram(values), 10, 30)
    assert float(measuring.tone(np.array([11.0]), 10, 30, None, curve)[0]) > 0.9
    upper = measuring.equalization(measuring.value_histogram(values), 20, 30)
    assert float(measuring.tone(np.array([25.0]), 20, 30, None, upper)[0]) == pytest.approx(0.5, abs=0.1)
    assert measuring.equalization(measuring.value_histogram(values), 40, 50) is None
    assert measuring.value_histogram(np.array([np.nan])) is None
    # A stray value far off (no data, the sun's reflection) leaves the others spread over the bins still
    stray = measuring.equalization(measuring.value_histogram(np.append(values, -9999.0)), 20, 30)
    assert float(measuring.tone(np.array([25.0]), 20, 30, None, stray)[0]) == pytest.approx(0.5, abs=0.1)
    assert measuring.value_histogram(values, (10, 12))[1][[0, -1]].tolist() == [10, 12]


def test_mosaics_and_frames_have_a_curve_the_browser_colours_them_and_their_legend_with(api):
    c = analysed(converted(api)[0])
    # The mosaic's histogram is kept beside it, and read again rather than the mosaic
    curve = "{}/{}/mosaics/as_converted/curve".format(CONVERSIONS, c.id)
    assert api.get(curve, {'rescale': '0,40', 'equalize': '1'}).status_code == 200
    kept = os.path.join(c.data_dir(), mosaics.VIEWER_DIR, 'histogram-as_converted.json')
    assert os.path.isfile(kept)
    measuring.kept_histogram.cache_clear()
    with mock.patch.object(measuring, 'read_mosaic', wraps=measuring.read_mosaic) as read:
        assert api.get(curve, {'rescale': '5,35', 'equalize': '1'}).status_code == 200
    assert read.call_count == 0
    # One that can't be replaced (Windows, while another request reads it) is drawn all the same, and kept next time
    os.remove(kept)
    measuring.kept_histogram.cache_clear()
    with mock.patch.object(measuring.os, 'replace', side_effect=PermissionError):
        assert api.get(curve, {'rescale': '0,40', 'equalize': '1'}).status_code == 200
    assert not os.path.exists(kept)
    assert not [f for f in os.listdir(os.path.dirname(kept)) if f.endswith('.tmp')]

    # Linear, bent by gamma, or equalized (the fake mosaic's 10 to 30 °C, evenly)
    shares = api.get(curve, {'rescale': '0,40'}).data['shares']
    assert len(shares) == measuring.CURVE_SAMPLES
    assert shares[16] == pytest.approx(0.25)
    assert api.get(curve, {'rescale': '0,40', 'gamma': '2'}).data['shares'][16] == pytest.approx(0.5)
    equalized = api.get(curve, {'rescale': '0,40', 'equalize': '1'}).data['shares']
    assert equalized[15] < 0.05
    assert equalized[49] > 0.95
    assert equalized[32] == pytest.approx(0.5, abs=0.1)
    # Corrected as the data tiles are: warmer, so less of the range is below 10 °C still
    warmer = api.get(curve, {'rescale': '0,40', 'equalize': '1', 'emissivity': '0.8'}).data['shares']
    assert warmer != equalized
    assert api.get("{}/{}/mosaics/source_frame/curve".format(CONVERSIONS, c.id)).status_code == 404
    for bad in ({'gamma': '0'}, {'gamma': '9'}, {'equalize': '2'}, {'sharpen': '-1'}):
        assert api.get(curve, dict(bad, rescale='0,40')).status_code == 400, bad

    # A frame's, equalized from its own temperatures (20 to 29 °C, evenly)
    rel = '100MEDIA/DJI_0002_T.JPG'
    with mock.patch('dji_thermal_cli.api.measure', side_effect=fake_measure):
        frame_curve = "{}/{}/frame/curve".format(CONVERSIONS, c.id)
        shares = api.get(frame_curve, {'frame': rel, 'rescale': '10,40', 'equalize': '1'}).data['shares']
        assert (shares[0], shares[-1]) == (0.0, 1.0)
        assert shares[20] < 0.05       # 19.4 °C: below the frame's coldest
        assert shares[42] > 0.95       # 29.7 °C: above its warmest
        assert api.get(frame_curve, {'frame': rel, 'rescale': '10,40', 'sharpen': 'x'}).status_code == 400


def test_measurements_are_saved_listed_exported_renamed_and_deleted(api):
    c, _ = converted(api)
    api.put(PREFERENCES, {'unit': 'C'}, format='json')
    url = "{}/{}/measurements".format(CONVERSIONS, c.id)
    area = {'name': ' Warm corner ', 'target': 'harmonized', 'geometry': mosaic_square(32, 16, 48, 32),
            'isotherm': 'above,22'}
    res = api.post(url, area, format='json')
    assert res.status_code == 201, res.data
    m = res.data
    assert (m['name'], m['target']) == ('Warm corner', 'harmonized')
    assert m['geometry']['type'] == 'Polygon'
    assert m['values']['result']['mean'] == pytest.approx(mosaic_temperature(39.5) + 0.5, abs=1e-3)
    assert m['values']['isotherm'] == 'above,22'
    assert api.post(url, dict(area, name=""), format='json').status_code == 400
    assert api.post(url, dict(area, geometry=None), format='json').status_code == 400

    assert [x['name'] for x in api.get(url).data['measurements']] == ['Warm corner']
    assert api.get(url, {'target': 'as_converted'}).data['measurements'] == []

    res = api.get("{}/{}/measurements.csv".format(CONVERSIONS, c.id))
    assert res['Content-Type'] == 'text/csv; charset=utf-8'
    assert res.content.startswith(b'\xef\xbb\xbf')      # Excel reads it as UTF-8
    assert '-measurements.csv' in res['Content-Disposition']
    rows = list(csv.DictReader(io.StringIO(res.content.decode("utf-8-sig"))))
    assert (rows[0]['Name'], rows[0]['Measured on'], rows[0]['Shape'], rows[0]['Isotherm share'],
            rows[0]['Length / area unit']) == ('Warm corner', 'Harmonized mosaic', 'Polygon', '0.6875', 'm')
    assert float(rows[0]['Mean']) == round(mosaic_temperature(39.5) + 0.5, 3)
    assert (rows[0]['Unit'], rows[0]['Isotherm']) == ('C', 'above,22')

    # The same as GeoJSON, with their shapes; one measured on a frame has no place on the map
    ThermalMeasurement.objects.create(conversion=c, name="Spot", target='frame', frame='100MEDIA/DJI_0001_T.JPG',
                                      geometry={'type': 'Point', 'coordinates': [3, 2]}, values={})
    res = api.get("{}/{}/measurements.geojson".format(CONVERSIONS, c.id))
    assert res['Content-Type'] == 'application/geo+json; charset=utf-8'
    assert '-measurements.geojson' in res['Content-Disposition']
    geo = json.loads(res.content)
    assert (geo['type'], len(geo['features'])) == ('FeatureCollection', 1)
    feature = geo['features'][0]
    assert feature['geometry'] == m['geometry']
    assert (feature['properties']['name'], feature['properties']['target'], feature['properties']['unit'],
            feature['properties']['isotherm_share']) == ('Warm corner', 'Harmonized mosaic', 'C', 0.6875)
    assert feature['properties']['mean'] == float(rows[0]['Mean'])
    assert 'geometry' not in feature['properties']
    ThermalMeasurement.objects.filter(target='frame').delete()

    # In the app's unit: the temperatures converted, the differences scaled
    api.put(PREFERENCES, {'unit': 'F'}, format='json')
    rows_f = csv_rows(api, c)
    assert (rows_f[0]['Unit'], rows_f[0]['Isotherm']) == ('F', 'above,71.6')
    assert float(rows_f[0]['Mean']) == pytest.approx(float(rows[0]['Mean']) * 1.8 + 32, abs=0.01)
    assert float(rows_f[0]['Std dev']) == pytest.approx(float(rows[0]['Std dev']) * 1.8, abs=0.01)

    detail = "{}/{}".format(url, m['id'])
    assert api.patch(detail, {'name': 'Roof edge'}, format='json').data['name'] == 'Roof edge'
    # A comment, kept with it and exported
    assert m['comment'] == ""
    res = api.patch(detail, {'comment': "Wet insulation, seen again in May"}, format='json')
    assert (res.data['comment'], res.data['name']) == ("Wet insulation, seen again in May", 'Roof edge')
    assert csv_rows(api, c)[0]['Comment'] == "Wet insulation, seen again in May"
    geo = json.loads(api.get("{}/{}/measurements.geojson".format(CONVERSIONS, c.id)).content)
    assert geo['features'][0]['properties']['comment'] == "Wet insulation, seen again in May"
    for bad in (5, None, "x" * 10001):
        assert api.patch(detail, {'comment': bad}, format='json').status_code == 400
    assert api.get(url).data['measurements'][0]['comment'] == "Wet insulation, seen again in May"

    assert api.delete(detail).status_code == 204
    assert not ThermalMeasurement.objects.filter(pk=m['id']).exists()
    # Deleted with their conversion
    api.post(url, area, format='json')
    api.delete("{}/{}".format(CONVERSIONS, c.id))
    assert not ThermalMeasurement.objects.exists()


def test_lines_have_a_temperature_profile_with_the_frames_it_crosses(api):
    c, _ = converted(api)
    api.put(PREFERENCES, {'unit': 'C'}, format='json')
    url = "{}/{}/measure".format(CONVERSIONS, c.id)
    line = {'type': 'LineString', 'coordinates': [mosaic_lonlat(20.5, 30.5), mosaic_lonlat(40.5, 30.5)]}
    p = api.post(url, {'target': 'as_converted', 'geometry': line}, format='json').data['result']['profile']
    # Sampled every pixel (5 cm) along its metre, each sample the temperature of the pixel it falls in
    assert len(p['distance']) in (20, 21)
    assert len(p['values']) == len(p['distance'])
    assert p['distance'][-1] == pytest.approx(1.0, abs=1e-3)
    assert p['values'][0] == pytest.approx(mosaic_temperature(20), abs=1e-3)
    assert p['values'][-1] == pytest.approx(mosaic_temperature(40), abs=1e-3)
    assert p['points'][0][0] == pytest.approx(line['coordinates'][0][0], abs=1e-7)
    # The frames the mosaic took them from: frame 0 west of the middle, frame 1 east of it
    assert (p['frames'][0], p['frames'][-1]) == ('100MEDIA/DJI_0001_T.JPG', '100MEDIA/DJI_0002_T.JPG')
    # On the harmonized mosaic too, half a degree warmer
    h = api.post(url, {'target': 'harmonized', 'geometry': line}, format='json').data['result']['profile']
    assert h['values'][0] - p['values'][0] == pytest.approx(0.5, abs=1e-3)
    assert h['frames'] == p['frames']
    # Through no data: None there
    corner = {'type': 'LineString', 'coordinates': [mosaic_lonlat(2.5, 4.5), mosaic_lonlat(12.5, 4.5)]}
    q = api.post(url, {'target': 'as_converted', 'geometry': corner}, format='json').data['result']['profile']
    assert (q['values'][0], q['frames'][0]) == (None, None)
    assert q['values'][-1] == pytest.approx(mosaic_temperature(12), abs=1e-3)
    # Spots and areas have none
    area = api.post(url, {'target': 'as_converted', 'geometry': mosaic_square(32, 16, 48, 32)}, format='json')
    assert 'profile' not in area.data['result']

    # Saved: in the CSV, a row per sample after the line's own, where it is in the Geometry column; not in the GeoJSON
    saved = api.post("{}/{}/measurements".format(CONVERSIONS, c.id),
                     {'name': 'Across', 'target': 'as_converted', 'geometry': line}, format='json')
    assert saved.status_code == 201, saved.data
    rows = csv_rows(api, c)
    assert [r['Shape'] for r in rows] == ['LineString'] + ['profile'] * len(p['distance'])
    first, last = rows[1], rows[-1]
    assert (first['Name'], first['Distance'], first['Source frame'], first['Mean']) == \
        ('Across', '0.0', '100MEDIA/DJI_0001_T.JPG', '')
    assert float(first['Temperature']) == round(mosaic_temperature(20), 3)
    assert (last['Source frame'], last['Length / area unit']) == ('100MEDIA/DJI_0002_T.JPG', 'm')
    assert json.loads(first['Geometry'])['type'] == 'Point'
    geo = json.loads(api.get("{}/{}/measurements.geojson".format(CONVERSIONS, c.id)).content)
    assert [f['geometry']['type'] for f in geo['features']] == ['LineString']


def test_areas_drawn_as_a_box_or_a_circle_are_saved_as_such(api):
    c, _ = converted(api)
    url = "{}/{}/measurements".format(CONVERSIONS, c.id)
    box = {'name': 'Box', 'target': 'as_converted', 'geometry': mosaic_square(32, 16, 48, 32), 'shape': {'kind': 'box'}}
    res = api.post(url, box, format='json')
    assert res.status_code == 201, res.data
    assert res.data['values']['shape'] == {'kind': 'box'}
    circle = dict(box, name='Circle', shape={'kind': 'circle', 'center': mosaic_lonlat(40, 24), 'radius': 0.3})
    res = api.post(url, circle, format='json')
    assert res.status_code == 201, res.data
    assert (res.data['values']['shape']['kind'], res.data['values']['shape']['radius']) == ('circle', 0.3)
    assert sorted(r['Shape'] for r in csv_rows(api, c)) == ['box', 'circle']
    line = {'type': 'LineString', 'coordinates': [mosaic_lonlat(20, 30), mosaic_lonlat(40, 30)]}
    for bad in (dict(box, shape={'kind': 'star'}), dict(box, geometry=line),
                dict(circle, shape={'kind': 'circle', 'center': mosaic_lonlat(40, 24), 'radius': 0}),
                dict(circle, shape={'kind': 'circle', 'center': [400, 0], 'radius': 1})):
        assert api.post(url, bad, format='json').status_code == 400, bad


def delta(a, b):
    return {'type': 'LineString', 'coordinates': [a, b]}


def test_a_delta_t_measures_its_two_ends_as_spots_on_a_mosaic_second_minus_first(api):
    c, _ = converted(api)
    url = "{}/{}/measure".format(CONVERSIONS, c.id)
    a, b = mosaic_lonlat(20.5, 30.5), mosaic_lonlat(40.5, 30.5)
    res = api.post(url, {'target': 'as_converted', 'geometry': delta(a, b), 'shape': {'kind': 'delta'},
                         'isotherm': 'above,20'}, format='json')
    assert res.status_code == 200, res.data
    r = res.data['result']
    # Each end is what a Spot there measures: the mean of its disc
    spots = [api.post(url, {'target': 'as_converted', 'geometry': {'type': 'Point', 'coordinates': p}},
                      format='json').data['result'] for p in (a, b)]
    assert (r['kind'], r['first'], r['second']) == ('LineString', spots[0]['mean'], spots[1]['mean'])
    assert r['first'] == pytest.approx(mosaic_temperature(20), abs=0.05)
    assert r['delta_t'] == pytest.approx(r['second'] - r['first'], abs=1e-9)
    assert r['delta_t'] == pytest.approx(mosaic_temperature(40) - mosaic_temperature(20), abs=0.05)
    assert r['length'] == pytest.approx(1.0, abs=1e-3)
    assert r['valid_pixels'] == spots[0]['valid_pixels'] + spots[1]['valid_pixels']
    assert not {'profile', 'isotherm', 'mean', 'histogram'} & set(r)
    # The other way round, ΔT is below zero; corrected, both ends are
    back = api.post(url, {'target': 'as_converted', 'geometry': delta(b, a), 'shape': {'kind': 'delta'}},
                    format='json').data['result']
    assert back['delta_t'] == pytest.approx(-r['delta_t'], abs=1e-9)
    # An end off the mosaic: no ΔT
    off = api.post(url, {'target': 'as_converted', 'geometry': delta(a, mosaic_lonlat(500, 500)),
                         'shape': {'kind': 'delta'}}, format='json').data['result']
    assert (off['valid_pixels'], off['reason'], off['delta_t'], off['second']) == (0, 'outside_raster', None, None)
    for bad in ({'geometry': {'type': 'LineString', 'coordinates': [a, b, a]}, 'shape': {'kind': 'delta'}},
                {'geometry': mosaic_square(32, 16, 48, 32), 'shape': {'kind': 'delta'}},
                {'geometry': delta(a, b), 'shape': {'kind': 'box'}}):
        assert api.post(url, dict(bad, target='as_converted'), format='json').status_code == 400, bad

    # Saved, then in the CSV (in °C here) with its two spots, and no profile
    api.put(PREFERENCES, {'unit': 'C'}, format='json')
    saved = api.post("{}/{}/measurements".format(CONVERSIONS, c.id),
                     {'name': 'Joint', 'target': 'as_converted', 'geometry': delta(a, b), 'shape': {'kind': 'delta'},
                      'isotherm': 'above,20'}, format='json')
    assert saved.status_code == 201, saved.data
    assert (saved.data['values']['shape'], 'isotherm' in saved.data['values']) == ({'kind': 'delta'}, False)
    rows = csv_rows(api, c)
    assert [(x['Shape'], x['Length / area unit']) for x in rows] == [('delta', 'm')]
    assert (float(rows[0]['First spot']), float(rows[0]['Second spot']), float(rows[0]['ΔT'])) == (
        round(r['first'], 3), round(r['second'], 3), round(r['delta_t'], 3))
    assert rows[0]['Mean'] == ''


def test_a_delta_t_on_a_frame_is_measured_as_converted_and_again_with_parameters_changed(api):
    c = analysed(converted(api)[0])
    rel = '100MEDIA/DJI_0002_T.JPG'
    with mock.patch('dji_thermal_cli.api.measure', side_effect=fake_measure):
        res = api.post("{}/{}/measurements".format(CONVERSIONS, c.id), {
            'name': 'Across', 'target': 'frame', 'frame': rel, 'shape': {'kind': 'delta'},
            'geometry': delta([2.5, 3.5], [7.5, 3.5])}, format='json')
        assert res.status_code == 201, res.data
        r = res.data['values']['result']
        # 20 °C plus the column: the spots' discs are centred on columns 2 and 7 (touching a pixel more east)
        assert (r['first'], r['second']) == (pytest.approx(22.0, abs=0.25), pytest.approx(27.0, abs=0.25))
        assert (r['delta_t'], r['length']) == (pytest.approx(5.0), 5.0)
        again = api.patch("{}/{}/measurements/{}".format(CONVERSIONS, c.id, res.data['id']),
                          {'parameters': {'emissivity': 0.93}}, format='json')
        assert again.status_code == 200, again.data
        v = again.data['values']
        assert v['shape'] == {'kind': 'delta'}
        assert (v['changed']['first'], v['changed']['delta_t']) == (pytest.approx(r['first'] + 2, abs=1e-4),
                                                                   pytest.approx(5.0, abs=1e-4))


def test_a_saved_measurement_is_measured_again_with_other_parameters(api):
    c = analysed(converted(api)[0])
    url = "{}/{}/measurements".format(CONVERSIONS, c.id)
    m = api.post(url, {'name': 'Warm', 'target': 'as_converted', 'geometry': mosaic_square(32, 16, 48, 32),
                       'isotherm': 'above,22', 'shape': {'kind': 'box'}}, format='json').data
    detail = "{}/{}".format(url, m['id'])
    res = api.patch(detail, {'parameters': {'emissivity': 0.85}}, format='json')
    assert res.status_code == 200, res.data
    v = res.data['values']
    assert (res.data['name'], res.data['parameters']) == ('Warm', {'emissivity': 0.85})
    assert v['approximate']
    assert v['result']['mean'] < m['values']['result']['mean']
    # The isotherm and how it was drawn are kept
    assert (v['isotherm'], v['shape']) == ('above,22', {'kind': 'box'})
    assert 'isotherm' in v['result']
    # Back to the conversion's own
    v = api.patch(detail, {'parameters': {}}, format='json').data['values']
    assert not v['approximate']
    assert v['result']['mean'] == pytest.approx(m['values']['result']['mean'], abs=1e-6)
    assert api.patch(detail, {'parameters': {'emissivity': 3}}, format='json').status_code == 400
    assert api.patch(detail, {}, format='json').status_code == 400
    assert ThermalMeasurement.objects.get(pk=m['id']).parameters == {}

    # On a frame, measured again by dji-thermal-cli, the line's profile too
    rel = '100MEDIA/DJI_0002_T.JPG'
    with mock.patch('dji_thermal_cli.api.measure', side_effect=fake_measure):
        f = api.post(url, {'name': 'Row', 'target': 'frame', 'frame': rel, 'geometry': {
            'type': 'LineString', 'coordinates': [[0.5, 3.5], [9.5, 3.5]]}}, format='json').data
        p = f['values']['result']['profile']
        assert (p['distance'], p['values']) == ([float(i) for i in range(10)], [float(20 + i) for i in range(10)])
        assert (p['points'][1], 'frames' in p) == ([1.5, 3.5], False)
        assert 'changed' not in f['values']
        res = api.patch("{}/{}".format(url, f['id']), {'parameters': {'emissivity': 0.93}}, format='json')
        assert res.status_code == 200, res.data
        changed = res.data['values']['changed']['profile']['values']
        assert changed[0] - p['values'][0] == pytest.approx(2.0, abs=1e-4)
        rows = csv_rows(api, c)
    row = [r for r in rows if r['Name'] == 'Row (parameters changed)']
    assert (row[0]['Shape'], len(row), row[1]['Length / area unit']) == ('LineString', 11, 'px')


def test_the_frames_list_says_where_the_flights_visual_photos_were_taken(api):
    c = analysed(converted(api)[0])
    rows = c.dataset.analysis['files'] + [
        {'path': '100MEDIA/DJI_0001_V.JPG', 'kind': 'not_thermal', 'lat': 42.1, 'lon': -88.07},
        {'path': '100MEDIA/DJI_0002_V.JPG', 'kind': 'not_thermal', 'reason': 'not an R-JPEG'},     # read before 1.11
        {'path': '100MEDIA/photo.jpg', 'kind': 'not_thermal', 'lat': 42.1, 'lon': -88.07}]          # not DJI's visual
    ThermalDataset.objects.filter(pk=c.dataset_id).update(analysis={'files': rows})
    frames = api.get("{}/{}/frames".format(CONVERSIONS, c.id)).data
    assert frames['visual_photos'] == [{'path': '100MEDIA/DJI_0001_V.JPG', 'lat': 42.1, 'lon': -88.07}]
    assert len(frames['frames']) == 2


def test_frames_are_measured_as_converted_and_again_with_parameters_changed(api):
    c = analysed(converted(api)[0])
    frames = api.get("{}/{}/frames".format(CONVERSIONS, c.id)).data
    assert [(f['path'], f['mosaic'], f['converted']) for f in frames['frames']] == \
        [('100MEDIA/DJI_0001_T.JPG', 0, True), ('100MEDIA/DJI_0002_T.JPG', 1, True)]
    assert frames['frames'][0]['recorded']['lrf'] == 21.4
    # Where they were taken, for the frame page's map
    assert (frames['frames'][0]['lat'], frames['frames'][0]['lon']) == (42.1, -88.07)
    assert (frames['unit'], frames['normalized'], frames['default_palette']) == ('C', False, 'dji_ironred')
    # dji-thermal-cli's pitch limit, as the conversion sets none
    assert frames['max_pitch'] == -80.0

    rel = '100MEDIA/DJI_0002_T.JPG'
    frame = "{}/{}/frame".format(CONVERSIONS, c.id)
    with mock.patch('dji_thermal_cli.api.measure', side_effect=fake_measure) as measure:
        info = api.get(frame, {'frame': rel}).data
        assert (info['width'], info['height'], info['distance_source']) == (10, 8, 'rangefinder')
        # The no-data marker is left out
        assert (info['stats']['valid_pixels'], info['stats']['min']) == (79, 20.0)
        assert 'changed' not in info
        changed = api.get(frame, {'frame': rel, 'emissivity': '0.95'}).data
        assert changed['changed']['stats']['min'] - changed['stats']['min'] == pytest.approx(4.0, abs=1e-4)
        assert changed['changed']['params']['emissivity'] == pytest.approx(0.95)
        assert measure.call_args.args[1].emissivity == pytest.approx(0.95)

        point = api.get(frame + "/point", {'frame': rel, 'x': '3.5', 'y': '2.5', 'emissivity': '0.95'}).data
        assert (point['temperature'], point['inside']) == (23.0, True)
        assert point['changed'] == pytest.approx(27.0, abs=1e-4)
        assert api.get(frame + "/point", {'frame': rel, 'x': 0, 'y': 0}).data['temperature'] is None

        # A 3 x 2 px area, measured as converted and again
        res = api.post("{}/{}/measure".format(CONVERSIONS, c.id), {
            'target': 'frame', 'frame': rel, 'parameters': {'emissivity': 0.93, 'humidity': ''},
            'geometry': {'type': 'Polygon', 'coordinates': [[[4.2, 2.2], [6.8, 2.2], [6.8, 3.8], [4.2, 3.8]]]}},
            format='json')
        assert res.status_code == 200, res.data
        assert (res.data['result']['valid_pixels'], res.data['result']['mean']) == (6, 25.0)
        assert res.data['changed']['mean'] == pytest.approx(27.0, abs=1e-4)
        assert res.data['result']['max_location'] == [6.5, 2.5]

        for bad in ({'frame': '../../../etc/passwd'}, {'frame': 'nope.JPG'}, {'frame': rel, 'emissivity': '7'},
                    {'frame': rel, 'distance': 'far'}):
            assert api.get(frame, bad).status_code == 400, bad
    # Measured once per frame and settings: the page asks for the same one again for its values and each point
    calls = measure.call_count
    with mock.patch('dji_thermal_cli.api.measure', side_effect=fake_measure) as again:
        api.get(frame, {'frame': rel})
    assert again.call_count == 0
    assert calls > 0


def test_a_normalized_conversions_frames_are_measured_as_it_converted_them(api):
    def process(path, output_dir, **kw):
        report = fake_process(path, output_dir, **kw)
        report.normalization = SimpleNamespace(ambient_c=25.0, reflected_c=26.0, frames=2, without_offset=0,
                                               offsets_c={report.results[1].src: 0.75})
        return report

    d = uploaded(api)
    with mock.patch('dji_thermal_cli.api.process', side_effect=process):
        res = api.post("{}/{}/conversions".format(DATASETS, d.id), {'settings': {'normalize': True, 'mosaics': False}},
                       format='json')
    c = analysed(ThermalConversion.objects.get(pk=res.data['id']))
    assert [f['offset_c'] for f in c.results['files']] == [None, 0.75]
    with mock.patch('dji_thermal_cli.api.measure', side_effect=fake_measure) as measure:
        info = api.get("{}/{}/frame".format(CONVERSIONS, c.id), {'frame': '100MEDIA/DJI_0002_T.JPG'}).data
    # The flight's normalized ambient and reflected temperatures, and the frame's offset subtracted
    assert (measure.call_args.args[1].ambient_temp, measure.call_args.args[1].reflected_temp) == (25.0, 26.0)
    assert (info['offset'], info['offset_known']) == (0.75, True)
    assert info['stats']['min'] == pytest.approx(20 - 0.75, abs=1e-4)
    assert info['stats']['max'] == pytest.approx(28 - 0.75, abs=1e-4)


def test_a_frame_is_sent_as_its_temperatures_measured_again_with_the_changes_asked(api):
    from dji_thermal_ui.analyzer import api as api_module
    c = analysed(converted(api)[0])
    rel = '100MEDIA/DJI_0002_T.JPG'
    url = "{}/{}/frame/data".format(CONVERSIONS, c.id)
    with mock.patch('dji_thermal_cli.api.measure', side_effect=fake_measure):
        res = api.get(url, {'frame': rel})
        assert (res.status_code, res['Content-Type']) == (200, 'application/octet-stream')
        assert (res['X-Width'], res['X-Height']) == ('10', '8')
        values = np.frombuffer(res.content, dtype='<f4').reshape(8, 10)
        # Row by row, with no data where dji-thermal-cli marked none (its top left pixel)
        assert values[0, 0] == np.float32(api_module.NO_DATA)
        assert (values[0, 1], values[1, 9]) == (21, 29)
        warmer = np.frombuffer(api.get(url, {'frame': rel, 'emissivity': '0.95'}).content, dtype='<f4').reshape(8, 10)
        assert warmer[1, 9] > values[1, 9]
        assert api.get(url, {'frame': rel, 'emissivity': 'x'}).status_code == 400
        assert api.get(url, {'frame': 'nope.JPG'}).status_code == 400


def test_a_spot_or_area_far_from_the_mosaic_measures_nothing(api):
    c, _ = converted(api)
    url = "{}/{}/measure".format(CONVERSIONS, c.id)
    for geometry in ({'type': 'Point', 'coordinates': [0, 0]},
                     {'type': 'Polygon', 'coordinates': [[[0, 0], [0.001, 0], [0.001, 0.001], [0, 0]]]}):
        res = api.post(url, {'target': 'as_converted', 'geometry': geometry}, format='json')
        assert res.status_code == 200, res.data
        assert (res.data['result']['valid_pixels'], res.data['result']['reason']) == (0, 'outside_raster')


def test_a_download_named_with_letters_beyond_ascii_keeps_them(api):
    d = dataset(name="Žilina")
    c = ThermalConversion.objects.create(dataset=d, name="Krov")
    res = api.get("{}/{}/measurements.csv".format(CONVERSIONS, c.id))
    assert res['Content-Disposition'] == "attachment; filename*=UTF-8''%C5%BDilina-Krov-measurements.csv"
