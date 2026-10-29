"""Conversions and the saved settings through the API (ported from LuxODM's app/tests/test_thermal_analyzer_plugin.py,
commit a2a81052, without its sharing and quota; the settings and the unit are the app's, not a user's)"""

import io
import os
import zipfile
from types import SimpleNamespace
from unittest import mock

from dji_thermal_ui.analyzer import api as analyzer_api
from dji_thermal_ui.analyzer import thermal_conversion as conversion
from dji_thermal_ui.analyzer.models import ThermalConversion
from tests.fakes import CONVERSIONS, DATASETS, PREFERENCES, converted, dataset, fake_process, uploaded


def test_settings_are_checked_and_completed_from_dji_thermal_clis_defaults():
    assert conversion.parse_settings({}) == (conversion.DEFAULTS, {})

    s, errors = conversion.parse_settings({'distance': '12.5', 'emissivity': '0.95', 'humidity': '', 'unit': 'f',
                                           'range_min': 50, 'range_max': 120, 'palette': 'ironred',
                                           'replace_above': 200, 'replace_above_value': 'NoData',
                                           'outputs': ['temp_c:tif', 'gray16', 'pseudo:png', 'temp_c:tiff']})
    assert errors == {}
    assert (s['distance'], s['emissivity'], s['humidity'], s['unit'], s['replace_above_value']) == \
        (12.5, 0.95, None, 'F', 'nodata')
    assert s['outputs'] == ['temp_c:tiff', 'gray16:png', 'pseudo:png']

    s, errors = conversion.parse_settings({'distance': 'far', 'humidity': 140, 'emissivity': 'x', 'unit': 'R',
                                           'palette': 'neon', 'outputs': ['temp_c:png'], 'compression': 'zip',
                                           'rjpeg_picture': 'mine'})
    assert sorted(errors) == ['compression', 'distance', 'emissivity', 'humidity', 'outputs', 'palette',
                              'rjpeg_picture', 'unit']
    assert conversion.parse_settings({'outputs': []})[1] == {'outputs': "Choose at least one output"}

    # What dji-thermal-cli's Settings refuses: half a range, a temperature below absolute zero
    assert 'settings' in conversion.parse_settings({'range_min': 10})[1]
    assert 'settings' in conversion.parse_settings({'ambient_temp': -300})[1]


def test_conversions_are_kept_side_by_side_with_their_settings_results_and_downloads(api):
    d = uploaded(api)
    url = "{}/{}/conversions".format(DATASETS, d.id)
    with mock.patch('dji_thermal_cli.api.process', side_effect=fake_process) as process:
        res = api.post(url, {'settings': {'emissivity': 0.95, 'normalize': True, 'max_pitch': -80,
                                          'outputs': ['temp_c:tiff', 'rjpeg:jpeg'], 'rjpeg_picture': 'original'}},
                       format='json')
        assert res.status_code == 201, res.data
        # Converted straight away (jobs run inline in tests), with the settings given
        kw = process.call_args.kwargs
        assert (kw['settings'].emissivity, kw['normalize'], kw['max_pitch'], kw['outputs'], kw['rjpeg_picture'],
                kw['jobs']) == (0.95, True, -80.0, ('temp_c:tiff', 'rjpeg:jpg'), 'original', 1)
        second = api.post(url, {'name': "Defaults", 'settings': {}}, format='json')
        assert second.status_code == 201

    first = ThermalConversion.objects.get(pk=res.data['id'])
    assert (first.status, first.name, first.file_count, first.run_id) == ('ready', "Dataset 1", 2, "")
    assert first.results['converted'] == 2
    row = first.results['files'][0]
    assert (row['path'], row['outputs'], row['distance_source']) == \
        ('100MEDIA/DJI_0001_T.JPG', ['100MEDIA/DJI_0001_T_temp_c.tiff'], 'lrf')
    assert first.data_dir().startswith(d.data_dir())
    assert first.data_dir() not in str(first.results)

    detail = api.get("{}/{}".format(DATASETS, d.id)).data
    listed = detail['conversions']
    assert [c['name'] for c in listed] == ["Defaults", "Dataset 1"]
    # With the defaults they're compared against, in the app's unit
    assert detail['defaults']['outputs'] == ['temp_c:tiff', 'pseudo:png']
    assert detail['defaults']['unit'] == 'F'
    assert listed[1]['settings']['emissivity'] == 0.95
    assert 'normalized' in listed[1]['description']

    res = api.get("{}/{}/download".format(CONVERSIONS, first.id))
    assert res.status_code == 200
    with zipfile.ZipFile(io.BytesIO(b"".join(res.streaming_content))) as z:
        assert sorted(z.namelist()) == ['100MEDIA/DJI_0001_T_temp_c.tiff', '100MEDIA/DJI_0002_T_temp_c.tiff']
    assert 'filename=Roof-Dataset_1.zip' in res['Content-Disposition']
    res = api.get("{}/{}/download".format(CONVERSIONS, first.id), {'file': '100MEDIA/DJI_0002_T_temp_c.tiff'})
    assert res.status_code == 200
    assert (b"".join(res.streaming_content) if res.streaming else res.content)[:3] == b'II*'
    assert api.get("{}/{}/download".format(CONVERSIONS, first.id),
                   {'file': '../../images/100MEDIA/DJI_0001_T.JPG'}).status_code == 404

    # Renamed, then deleted: its files go
    assert api.patch("{}/{}".format(CONVERSIONS, first.id), {'name': "Nadir"}, format='json').data['name'] == "Nadir"
    out_dir = first.data_dir()
    assert api.delete("{}/{}".format(CONVERSIONS, first.id)).status_code == 204
    assert not os.path.exists(out_dir)

    # Deleting the dataset deletes its conversions and their files
    out_dir = ThermalConversion.objects.get(pk=second.data['id']).data_dir()
    api.delete("{}/{}".format(DATASETS, d.id))
    assert not ThermalConversion.objects.exists()
    assert not os.path.exists(out_dir)


def test_converting_images_that_are_not_thermal_fails_with_each_images_reason(api):
    d = uploaded(api, ['DJI_0001_T.JPG'])
    res = api.post("{}/{}/conversions".format(DATASETS, d.id), {'settings': {}}, format='json')
    assert res.status_code == 201
    c = api.get("{}/{}".format(CONVERSIONS, res.data['id'])).data
    assert c['status'] == 'failed'
    assert "No image could be converted" in c['error']
    assert [(f['path'], f['ok']) for f in c['results']['files']] == [('DJI_0001_T.JPG', False)]
    assert c['results']['files'][0]['reason']


def test_a_conversion_needs_images_and_valid_settings(api):
    d = dataset()
    assert api.post("{}/{}/conversions".format(DATASETS, d.id), {'settings': {}}, format='json').status_code == 400
    d = uploaded(api)
    res = api.post("{}/{}/conversions".format(DATASETS, d.id),
                   {'settings': {'humidity': 400, 'outputs': ['nope']}}, format='json')
    assert res.status_code == 400
    assert sorted(res.data) == ['humidity', 'outputs']
    f = dataset(source='folder', folder="/nowhere/at/all")
    assert api.post("{}/{}/conversions".format(DATASETS, f.id), {'settings': {}}, format='json').status_code == 400
    assert not ThermalConversion.objects.exists()


def test_a_canceled_conversion_stops_and_what_it_wrote_is_counted(api):
    d = uploaded(api)
    c = ThermalConversion.objects.create(dataset=d, name="Run", options=conversion.DEFAULTS, run_id="run1")

    def process(path, output_dir, progress=None, **kw):
        os.makedirs(output_dir)
        with open(os.path.join(output_dir, 'partial.tiff'), 'wb') as f:
            f.write(b'0' * 1024)
        res = api.post("{}/{}/cancel".format(CONVERSIONS, c.id))
        assert res.data['status'] == 'canceled'
        assert res.data['file_count'] == 1
        progress(SimpleNamespace(kind='file'))
        raise AssertionError("the run should have stopped")

    with mock.patch.object(conversion, 'PROGRESS_INTERVAL', 0), \
            mock.patch('dji_thermal_cli.api.process', side_effect=process):
        assert conversion.convert(c.id, "run1") == {'canceled': True}
    c.refresh_from_db()
    assert (c.status, c.run_id, c.results, c.file_count) == ('canceled', "", {}, 1)
    assert abs(c.size - 1 / 1024.0) < 1e-9
    # A run that is no longer the conversion's writes nothing
    assert conversion.convert(c.id, "run1") == {'canceled': True}


def test_preferences_are_saved_once_for_the_app_and_reset_to_the_defaults(api):
    res = api.get(PREFERENCES)
    assert (res.data['settings'], res.data['saved']) == (dict(conversion.DEFAULTS, unit='F'), False)
    assert 'ironred' in res.data['palettes']
    assert {'product': 'temp_c', 'description': mock.ANY, 'formats': ['tiff', 'exr']} in res.data['products']
    assert {'product': 'rjpeg', 'description': mock.ANY, 'formats': ['jpg']} in res.data['products']

    assert api.put(PREFERENCES, {'settings': {'emissivity': 7}}, format='json').status_code == 400
    res = api.put(PREFERENCES, {'settings': {'emissivity': 0.9, 'normalize': True}}, format='json')
    assert res.status_code == 200
    res = api.get(PREFERENCES)
    assert res.data['saved']
    assert (res.data['settings']['emissivity'], res.data['settings']['normalize']) == (0.9, True)

    res = api.delete(PREFERENCES)
    assert (res.data['settings'], res.data['saved']) == (dict(conversion.DEFAULTS, unit='F'), False)
    assert not api.get(PREFERENCES).data['saved']


def test_temperatures_are_in_fahrenheit_until_another_unit_is_chosen(api):
    res = api.get(PREFERENCES)
    assert (res.data['unit'], res.data['settings']['unit'], res.data['defaults']['unit']) == ('F', 'F', 'F')
    assert api.put(PREFERENCES, {'unit': 'R'}, format='json').status_code == 400

    assert api.put(PREFERENCES, {'unit': 'K'}, format='json').data == {'unit': 'K'}
    res = api.get(PREFERENCES)
    assert (res.data['unit'], res.data['defaults']['unit'], res.data['saved']) == ('K', 'K', False)
    # Resetting the settings keeps the unit
    assert api.delete(PREFERENCES).data['settings'] == dict(conversion.DEFAULTS, unit='K')
    assert api.get(PREFERENCES).data['unit'] == 'K'

    # Saved settings keep the unit they were saved with
    api.put(PREFERENCES, {'settings': {'unit': 'C'}}, format='json')
    res = api.get(PREFERENCES)
    assert (res.data['settings']['unit'], res.data['unit']) == ('C', 'K')


def test_the_pages_follow_the_computers_theme_until_light_or_dark_is_chosen(api):
    res = api.get(PREFERENCES)
    assert (res.data['theme'], res.data['themes']) == ('system', ['system', 'light', 'dark'])
    assert api.put(PREFERENCES, {'theme': 'blue'}, format='json').status_code == 400

    assert api.put(PREFERENCES, {'theme': 'dark'}, format='json').data == {'theme': 'dark'}
    assert api.put(PREFERENCES, {'unit': 'C'}, format='json').data == {'unit': 'C'}
    api.delete(PREFERENCES)
    res = api.get(PREFERENCES)
    assert (res.data['theme'], res.data['unit'], res.data['saved']) == ('dark', 'C', False)


def test_a_mosaic_reports_text_view_and_measurements_left_out_are_saved_on_the_conversion(api):
    c, _ = converted(api)
    url = "{}/{}".format(CONVERSIONS, c.id)
    assert api.get(url).data['report'] == {}
    view = {'tab': 'harmonized', 'palette': 'ironbow', 'range': [10, 30.5],
            'adjust': {'gamma': 1.2, 'equalize': True, 'sharpen': 1}, 'findings': False, 'hidden': [3]}
    res = api.patch(url, {'report': {'title': "Roof, harmonized", 'author': "A. Inspector", 'view': view,
                                     'left_out': [7, 2, 7]}}, format='json')
    assert res.status_code == 200, res.data
    assert res.data['report'] == {'title': "Roof, harmonized", 'author': "A. Inspector", 'view': view, 'left_out': [2, 7]}
    assert res.data['name'] == c.name                   # the name is left as it was
    assert analyzer_api.report_author() == "A. Inspector"
    res = api.patch(url, {'report': {'left_out': [], 'view': None}}, format='json')
    assert res.data['report'] == {'title': "Roof, harmonized", 'author': "A. Inspector", 'left_out': []}
    # Renaming still works, and leaves the report as it was
    assert api.patch(url, {'name': "Nadir"}, format='json').data['report']['title'] == "Roof, harmonized"


def test_a_mosaic_report_refuses_what_it_does_not_hold(api):
    c, _ = converted(api)
    url = "{}/{}".format(CONVERSIONS, c.id)
    for report in [{'appendix': True}, {'colour': 1}, {'left_out': [0]}, {'left_out': ["3"]}, {'left_out': 3},
                   {'view': "tab=harmonized"}, {'view': {'zoom': 3}}, {'view': {'range': [30, 10]}},
                   {'view': {'range': [1]}}, {'view': {'tab': 5}}, {'view': {'adjust': {'gamma': "x"}}},
                   {'view': {'hidden': ["a"]}}, {'view': {'palette': "x" * 65}}, {'date': "yesterday"}]:
        res = api.patch(url, {'report': report}, format='json')
        assert res.status_code == 400, report
    assert api.get(url).data['report'] == {}
