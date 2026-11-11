"""The findings through the API: a spot or an area of a dataset saved with its temperatures and the frames that saw it,
from a shape drawn on a mosaic or from a saved measurement; changed, deleted, and counted on the dataset and project"""

from unittest import mock

import pytest

from dji_thermal_ui.analyzer.models import Finding, ThermalConversion
from tests.fakes import CONVERSIONS, DATASETS, analysed, converted, mosaic_lonlat, mosaic_square, mosaic_temperature
from tests.test_api_sources import FILES, FakeModels, centre


@pytest.fixture
def conversion(api):
    c, _make = converted(api)
    return analysed(c)


def url(c, fid=None):
    return "{}/{}/findings".format(DATASETS, c.dataset_id) + ("/{}".format(fid) if fid else "")


def drawn(c, geometry, **over):
    return dict({'name': "Hot joint", 'conversion': c.id, 'tab': 'as_converted', 'geometry': geometry}, **over)


def test_a_spot_drawn_on_a_mosaic_is_saved_with_its_temperatures_and_every_frame_that_saw_it(api, conversion):
    c = conversion
    with mock.patch('dji_thermal_cli.api.read_frame_models', return_value=FakeModels()):
        res = api.post(url(c), drawn(c, centre(32, 20), notes=" Loose. ", severity='high'), format='json')
    assert res.status_code == 201, res.data
    f = res.data
    assert (f['name'], f['notes'], f['severity'], f['status']) == ("Hot joint", "Loose.", 'high', 'open')
    assert (f['conversion'], f['conversion_name'], f['tab'], f['models']) == (c.id, c.name, 'as_converted', True)
    t = f['temperatures']
    assert t['value'] == pytest.approx(mosaic_temperature(32), abs=1e-3)
    assert (t['unit'], t['approximate']) == ('C', False) and t['valid_pixels'] > 0
    # Every frame that saw it, the mosaic's first, then by view angle, all kept
    assert [(x['frame'], x['used'], x['kept']) for x in f['frames']] == [
        (FILES[1], True, True), (FILES[2], False, True), (FILES[0], False, True)]
    assert f['frames'][0]['time'] == '2026:10:12 18:29:51'
    assert [x['id'] for x in api.get(url(c)).data['findings']] == [f['id']]


def test_an_area_keeps_the_frames_picked_and_its_box_and_is_changed_later(api, conversion):
    c = conversion
    with mock.patch('dji_thermal_cli.api.read_frame_models', return_value=FakeModels()):
        res = api.post(url(c), drawn(c, mosaic_square(32, 16, 48, 32), tab='harmonized', shape={'kind': 'box'},
                                     kept=[FILES[2]]), format='json')
    assert res.status_code == 201, res.data
    f = res.data
    assert (f['shape'], f['tab']) == ({'kind': 'box'}, 'harmonized')
    # The harmonized mosaic is half a degree warmer
    assert f['temperatures']['mean'] == pytest.approx(mosaic_temperature(39.5) + 0.5, abs=1e-3)
    assert {x['frame']: x['kept'] for x in f['frames']} == {FILES[0]: False, FILES[1]: False, FILES[2]: True}

    res = api.patch(url(c, f['id']), {'name': "Roof", 'notes': "Seen again", 'severity': 'critical',
                                      'status': 'reviewed', 'kept': [FILES[0], FILES[2]]}, format='json')
    assert res.status_code == 200, res.data
    g = res.data
    assert (g['name'], g['notes'], g['severity'], g['status']) == ("Roof", "Seen again", 'critical', 'reviewed')
    assert {x['frame']: x['kept'] for x in g['frames']} == {FILES[0]: True, FILES[1]: False, FILES[2]: True}
    # What it measured is kept as it was
    assert g['temperatures'] == f['temperatures'] and g['geometry'] == f['geometry']
    assert g['updated_at'] >= f['updated_at']


def test_a_saved_spot_or_area_measurement_is_saved_as_a_finding_with_its_figures(api, conversion):
    c = conversion
    m = api.post("{}/{}/measurements".format(CONVERSIONS, c.id), {
        'name': "Box", 'target': 'as_converted', 'geometry': mosaic_square(32, 16, 48, 32), 'shape': {'kind': 'box'},
        'parameters': {'emissivity': 0.9}}, format='json').data
    res = api.post(url(c), {'name': "From the box", 'measurement': m['id']}, format='json')
    assert res.status_code == 201, res.data
    f = res.data
    assert (f['geometry'], f['shape'], f['conversion'], f['tab']) == (m['geometry'], {'kind': 'box'}, c.id, 'as_converted')
    r = m['values']['result']
    assert (f['temperatures']['min'], f['temperatures']['max'], f['temperatures']['mean']) == (r['min'], r['max'], r['mean'])
    assert 'surroundings' not in f['temperatures'] and 'delta_t' not in f['temperatures']
    assert f['temperatures']['approximate'] is True and f['temperatures']['parameters'] == {'emissivity': 0.9}
    # Without frame models, the frames the mosaic used: the box is in the second's half
    assert f['models'] is False and [x['frame'] for x in f['frames']] == [FILES[1]]


def test_a_delta_t_is_saved_as_a_finding_with_its_two_spots_and_the_frames_along_it(api, conversion):
    c = conversion
    line = {'type': 'LineString', 'coordinates': [mosaic_lonlat(10.5, 30.5), mosaic_lonlat(50.5, 30.5)]}
    with mock.patch('dji_thermal_cli.api.read_frame_models', return_value=FakeModels()):
        res = api.post(url(c), drawn(c, line, shape={'kind': 'delta'}), format='json')
    assert res.status_code == 201, res.data
    f = res.data
    t = f['temperatures']
    assert (f['shape'], f['geometry']['type']) == ({'kind': 'delta'}, 'LineString')
    assert t['first'] == pytest.approx(mosaic_temperature(10), abs=0.05)
    assert t['delta_t'] == pytest.approx(t['second'] - t['first'], abs=1e-9)
    assert t['length'] == pytest.approx(2.0, abs=1e-3)
    assert sorted(x['frame'] for x in f['frames']) == list(FILES)

    # From a saved Delta T: its figures copied
    m = api.post("{}/{}/measurements".format(CONVERSIONS, c.id), {
        'name': "Joint", 'target': 'as_converted', 'geometry': line, 'shape': {'kind': 'delta'}}, format='json').data
    res = api.post(url(c), {'name': "From the joint", 'measurement': m['id']}, format='json')
    assert res.status_code == 201, res.data
    assert res.data['shape'] == {'kind': 'delta'}
    assert {k: res.data['temperatures'][k] for k in ('first', 'second', 'delta_t')} == {
        k: m['values']['result'][k] for k in ('first', 'second', 'delta_t')}


def test_a_line_or_a_frame_measurement_is_not_saved_as_a_finding(api, conversion):
    c = conversion
    base = "{}/{}/measurements".format(CONVERSIONS, c.id)
    line = api.post(base, {'name': "Line", 'target': 'as_converted', 'geometry': {
        'type': 'LineString', 'coordinates': [mosaic_lonlat(20, 30), mosaic_lonlat(40, 30)]}}, format='json').data
    frame = api.post(base, {'name': "Frame", 'target': 'frame', 'frame': FILES[0],
                            'geometry': {'type': 'Point', 'coordinates': [10, 10]}}, format='json')
    for mid in (line['id'], frame.data.get('id'), 999999):
        if mid is None:
            continue
        res = api.post(url(c), {'name': "No", 'measurement': mid}, format='json')
        assert res.status_code == 400 and 'measurement' in res.data
    assert not Finding.objects.exists()


@pytest.mark.parametrize('over, field', [
    ({'name': ""}, 'name'),
    ({'name': "x" * 256}, 'name'),
    ({'severity': 'urgent'}, 'severity'),
    ({'status': 'closed'}, 'status'),
    ({'notes': ["a list"]}, 'notes'),
    ({'tab': 'source_frame'}, 'tab'),
    ({'conversion': 999999}, 'conversion'),
    ({'kept': "all"}, 'kept'),
    ({'geometry': {'type': 'LineString', 'coordinates': [[0, 0], [1, 1]]}}, 'error'),
    ({'geometry': {'type': 'Point', 'coordinates': [0, 0]}}, 'error'),
])
def test_a_finding_with_a_bad_value_or_outside_the_mosaic_is_refused(api, conversion, over, field):
    c = conversion
    res = api.post(url(c), dict(drawn(c, centre(32, 20)), **over), format='json')
    assert res.status_code == 400 and field in res.data, res.data
    assert not Finding.objects.exists()


def test_a_finding_is_only_changed_or_deleted_through_its_own_dataset(api, conversion):
    c = conversion
    f = api.post(url(c), drawn(c, centre(32, 20)), format='json').data
    other, _make = converted(api)
    wrong = "{}/{}/findings/{}".format(DATASETS, other.dataset_id, f['id'])
    assert api.patch(wrong, {'name': "x"}, format='json').status_code == 404
    assert api.delete(wrong).status_code == 404
    assert api.patch(url(c, f['id']), {'severity': 'none'}, format='json').status_code == 400
    assert api.patch(url(c, f['id']), {}, format='json').status_code == 400
    assert api.delete(url(c, f['id'])).status_code == 204
    assert not Finding.objects.exists()


def test_a_finding_outlives_its_conversion_but_not_its_dataset(api, conversion):
    c = conversion
    f = api.post(url(c), drawn(c, centre(32, 20)), format='json').data
    assert api.delete("{}/{}".format(CONVERSIONS, c.id)).status_code == 204
    kept = api.get(url(c)).data['findings'][0]
    assert (kept['id'], kept['conversion'], kept['conversion_name']) == (f['id'], None, "")
    assert api.delete("{}/{}".format(DATASETS, c.dataset_id)).status_code == 204
    assert not Finding.objects.exists()


def test_the_dataset_and_its_project_count_their_findings_and_the_project_lists_them(api, conversion):
    c = conversion
    f = api.post(url(c), drawn(c, centre(32, 20)), format='json').data
    project = c.dataset.project_id
    assert api.get("{}/{}".format(DATASETS, c.dataset_id)).data['finding_count'] == 1
    assert api.get("/api/projects").data['projects'][0]['finding_count'] == 1
    listed = api.get("/api/projects/{}".format(project)).data['findings']
    assert [(x['id'], x['dataset_name'], x['opens']) for x in listed] == [(f['id'], c.dataset.name, c.id)]

    # Its conversion's mosaics gone, it opens on the dataset's latest with mosaics; with none, on nothing
    second, _make = converted(api)
    ThermalConversion.objects.filter(pk=second.id).update(dataset=c.dataset)
    ThermalConversion.objects.filter(pk=c.id).update(mosaic_status='failed')
    assert api.get("/api/projects/{}".format(project)).data['findings'][0]['opens'] == second.id
    ThermalConversion.objects.filter(pk=second.id).update(mosaic_status='')
    assert api.get("/api/projects/{}".format(project)).data['findings'][0]['opens'] is None
