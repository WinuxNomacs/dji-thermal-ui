"""Datasets through the API: listing, creating, uploading, analyzing, canceling (ported from LuxODM's
app/tests/test_thermal_analyzer_plugin.py, commit a2a81052, without its projects, sharing and quota)"""

import io
import os
from datetime import timedelta
from types import SimpleNamespace
from unittest import mock

from dji_thermal_ui.analyzer import api as analyzer_api
from dji_thermal_ui.analyzer import thermal_analysis
from dji_thermal_ui.analyzer.models import ThermalConversion, ThermalDataset, ThermalMeasurement
from tests.fakes import DATASETS, JPEG, dataset, image, server_folder, thermal_report


def test_datasets_are_listed_newest_first(api):
    dataset(name="Older")
    dataset(name="Newer")
    res = api.get(DATASETS)
    assert res.status_code == 200
    assert [d['name'] for d in res.data['datasets']] == ["Newer", "Older"]
    assert 'can_change' not in res.data['datasets'][0]
    assert api.get("{}/{}".format(DATASETS, 99999)).status_code == 404


def test_the_list_says_while_a_dataset_converts_and_what_goes_with_it(api):
    d = dataset(name="Roof")

    def listed():
        return api.get(DATASETS).data['datasets'][0]

    def counts():
        r = listed()
        return r['busy'], r['conversion_count'], r['mosaic_count'], r['measurement_count']

    assert counts() == (False, 0, 0, 0)

    with mock.patch.object(analyzer_api.jobs, 'alive', return_value=True):
        c = ThermalConversion.objects.create(dataset=d, name="Run", options={}, run_id="run")
        assert listed()['busy']                     # converting
        c.status, c.mosaic_status = 'ready', 'building'
        c.save()
        assert listed()['busy']                     # building its mosaics
    c.mosaic_status, c.run_id = 'ready', ""
    c.save()
    failed = ThermalConversion.objects.create(dataset=d, name="Failed", options={}, status='failed')
    ThermalMeasurement.objects.create(conversion=c, name="Spot", target='harmonized',
                                      geometry={'type': 'Point', 'coordinates': [0, 0]})
    assert counts() == (False, 2, 1, 1)
    # Ready of all, and the last thing done: here the failed conversion's start
    assert listed()['conversions_ready'] == 1
    assert listed()['last_activity'] == failed.created_at
    c.finished_at = failed.created_at + timedelta(minutes=5)
    c.save()
    assert listed()['last_activity'] == c.finished_at

    # A conversion whose job stopped is not busy: it is marked failed
    stopped = ThermalConversion.objects.create(dataset=d, name="Stopped", options={}, run_id="gone")
    with mock.patch.object(analyzer_api.jobs, 'alive', return_value=False):
        assert not listed()['busy']
    assert ThermalConversion.objects.get(pk=stopped.pk).status == 'failed'


def test_the_files_tab_gets_small_thumbnails_of_the_files_the_analysis_lists_only(api, tmp_path):
    folder = server_folder(tmp_path, files=('sub/DJI_0001_T.JPG', 'notes.txt'))
    d = dataset(source='folder', folder=folder, analysis={'files': [
        {'path': 'sub/DJI_0001_T.JPG', 'kind': 'thermal'}, {'path': 'notes.txt', 'kind': 'other'}]})
    url = "{}/{}/thumbnail".format(DATASETS, d.id)
    res = api.get(url, {'file': 'sub/DJI_0001_T.JPG'})
    assert res.status_code == 200
    assert res['Content-Type'] == 'image/jpeg'
    assert 'max-age' in res['Cache-Control']
    from PIL import Image
    with Image.open(io.BytesIO(res.content)) as im:
        assert max(im.size) <= 96

    # Not an image, not listed, outside the dataset, or gone: none is served
    assert api.get(url, {'file': 'notes.txt'}).status_code == 404
    assert api.get(url, {'file': 'DJI_0001_T.JPG'}).status_code == 404
    assert api.get(url).status_code == 404
    d.analysis = {'files': [{'path': '../outside.JPG', 'kind': 'thermal'}]}
    d.save()
    assert api.get(url, {'file': '../outside.JPG'}).status_code == 404


def test_a_dataset_is_created_with_a_name(api):
    res = api.post(DATASETS, {'name': "Roof"}, format='json')
    assert res.status_code == 201
    d = ThermalDataset.objects.get(pk=res.data['id'])
    assert (d.source, d.status) == ('upload', 'new')
    assert api.post(DATASETS, {'name': " "}, format='json').status_code == 400
    assert api.post(DATASETS, {'name': "X", 'source': 'ftp'}, format='json').status_code == 400


def test_a_folder_dataset_is_analyzed_in_place_and_its_folder_kept_when_deleted(api, tmp_path):
    folder = server_folder(tmp_path, ['thermal/DJI_0001_T.JPG', 'notes.txt'])
    body = {'name': "Flight", 'source': 'folder', 'folder': folder}
    res = api.post(DATASETS, dict(body, folder=folder + "/nope"), format='json')
    assert res.status_code == 400
    assert 'folder' in res.data
    res = api.post(DATASETS, body, format='json')
    assert res.status_code == 201

    # Analyzed straight away (jobs run inline in tests), with dji-thermal-cli itself
    d = ThermalDataset.objects.get(pk=res.data['id'])
    assert d.status == 'ready', d.error
    assert d.file_count == 2
    assert d.run_id == ""
    rows = {r['path']: r for r in d.analysis['files']}
    assert rows['thermal/DJI_0001_T.JPG']['kind'] == 'not_thermal'
    assert rows['notes.txt']['kind'] == 'not_jpeg'
    assert d.analysis['summary']['files'] == {'not_thermal': 1}
    assert d.analysis['cameras'] == []

    assert api.get("{}/{}".format(DATASETS, d.id)).data['folder'] == folder
    assert api.delete("{}/{}".format(DATASETS, d.id)).status_code == 204
    assert os.path.isfile(os.path.join(folder, 'thermal', 'DJI_0001_T.JPG'))
    assert ThermalDataset.objects.count() == 0


def test_uploads_keep_their_subfolders_and_are_deleted_with_the_dataset(api):
    d = dataset()
    res = api.post("{}/{}/upload".format(DATASETS, d.id), {
        'images': [image('a.JPG'), image('b.jpeg'), image('notes.txt'), image('c.JPG')],
        'paths': ['100MEDIA/DJI_0001_T.JPG', '101MEDIA/DJI_0001_T.JPG', 'notes.txt', '../../../escape.JPG'],
    }, format='multipart')
    assert res.status_code == 200
    assert res.data['saved'] == 3
    assert res.data['skipped'] == ['notes.txt']

    images = d.images_dir()
    assert os.path.isfile(os.path.join(images, '100MEDIA', 'DJI_0001_T.JPG'))
    assert os.path.isfile(os.path.join(images, '101MEDIA', 'DJI_0001_T.JPG'))
    assert os.path.isfile(os.path.join(images, 'escape.JPG'))

    d.refresh_from_db()
    assert d.file_count == 3
    assert abs(d.size - len(JPEG) * 3 / 1024.0 / 1024.0) < 1e-9
    assert res.data['size'] == int(d.size * 1024 * 1024)

    # Without paths (an older client), the file's own name
    api.post("{}/{}/upload".format(DATASETS, d.id), {'images': [image('d.JPG')]}, format='multipart')
    assert os.path.isfile(os.path.join(images, 'd.JPG'))

    # Deleting the dataset removes its images
    api.delete("{}/{}".format(DATASETS, d.id))
    assert not os.path.exists(images)


def test_images_are_not_added_while_the_dataset_is_analyzed_nor_to_a_folder_dataset(api, tmp_path):
    d = dataset(status='analyzing')
    with mock.patch.object(analyzer_api.jobs, 'alive', return_value=True):
        res = api.post("{}/{}/upload".format(DATASETS, d.id), {'images': [image()]}, format='multipart')
    assert res.status_code == 400
    f = dataset(source='folder', folder=server_folder(tmp_path))
    res = api.post("{}/{}/upload".format(DATASETS, f.id), {'images': [image()]}, format='multipart')
    assert res.status_code == 400


def test_adding_images_marks_an_analyzed_dataset_as_needing_a_new_analysis(api):
    d = dataset()
    assert api.post("{}/{}/analyze".format(DATASETS, d.id)).status_code == 400    # nothing to analyze
    api.post("{}/{}/upload".format(DATASETS, d.id), {'images': [image()]}, format='multipart')
    res = api.post("{}/{}/analyze".format(DATASETS, d.id))
    assert res.status_code == 200
    assert res.data['status'] == 'ready'
    assert res.data['not_thermal'] == 1

    api.post("{}/{}/upload".format(DATASETS, d.id), {'images': [image('DJI_0002_T.JPG')]}, format='multipart')
    res = api.get("{}/{}".format(DATASETS, d.id))
    assert res.data['status'] == 'new'
    assert res.data['analyzed']     # the earlier analysis stays until the next


def test_a_folder_dataset_whose_folder_is_gone_is_not_analyzed(api, tmp_path):
    d = dataset(source='folder', folder=str(tmp_path / "gone"))
    assert api.post("{}/{}/analyze".format(DATASETS, d.id)).status_code == 400


def test_the_analysis_keeps_a_compact_row_per_file_with_paths_inside_the_dataset():
    root = "/data/flight"
    result = SimpleNamespace(
        reports=[thermal_report(root + "/thermal/DJI_0002_T.JPG"),
                 SimpleNamespace(path=root + "/rgb/DJI_0002_V.JPG", info=None,
                                 status=SimpleNamespace(kind='not_thermal', reason='not an R-JPEG'))],
        scan=SimpleNamespace(others=[root + "/flight.srt"]),
        findings=[SimpleNamespace(severity='warning', code='temperature_max_outlier', message="hot",
                                  files=[root + "/thermal/DJI_0002_T.JPG"], suggestion="--replace-above")],
        summary={'files': {'thermal': 1, 'not_thermal': 1}, 'error': 0, 'warning': 1, 'info': 0},
        webodm=None)

    a = thermal_analysis.compact(result, root)
    rows = {r['path']: r for r in a['files']}
    assert sorted(rows) == ['flight.srt', 'rgb/DJI_0002_V.JPG', 'thermal/DJI_0002_T.JPG']
    t = rows['thermal/DJI_0002_T.JPG']
    assert (t['model'], t['tmin'], t['alt'], t['pitch'], t['distance'], t['lrf'], t['gps']) == \
        ('M4T', 17.25, 21.14, -90.0, 5.0, 21.4, 'RTK')
    assert t['tmax'] is None     # NaN: JSON has none
    # Both clocks: the flight's time zone is found from them
    assert (t['time'], t['utc']) == ('2026:10:12 18:29:50', '2026-10-12T23:30:09.6')
    assert thermal_analysis.flight_zone(a) == {'offset': -300}
    assert rows['flight.srt']['kind'] == 'not_jpeg'
    assert a['cameras'] == [{'model': 'M4T', 'serial': 'SN1', 'width': 640, 'height': 512, 'frames': 1}]
    assert a['findings'][0]['files'] == ['thermal/DJI_0002_T.JPG']
    assert root not in str(a)


def test_a_canceled_or_replaced_analysis_writes_nothing(db, tmp_path):
    d = dataset(source='folder', folder=server_folder(tmp_path), status='canceled', run_id="")
    assert thermal_analysis.analyze_dataset(d.id, "old-run") == {'canceled': True}
    d.refresh_from_db()
    assert (d.status, d.analysis) == ('canceled', {})

    # Canceled while it runs: its next progress write finds the run gone and stops
    ThermalDataset.objects.filter(pk=d.id).update(status='analyzing', run_id="run1")

    def check(path, progress=None, **kw):
        ThermalDataset.objects.filter(pk=d.id).update(status='canceled', run_id="")
        progress(SimpleNamespace(kind='file'))
        raise AssertionError("the run should have stopped")

    with mock.patch.object(thermal_analysis, 'PROGRESS_INTERVAL', 0), \
            mock.patch('dji_thermal_cli.api.check', side_effect=check):
        assert thermal_analysis.analyze_dataset(d.id, "run1") == {'canceled': True}
    d.refresh_from_db()
    assert (d.status, d.analysis) == ('canceled', {})


def test_canceling_through_the_api_ends_the_run(api):
    d = dataset(status='analyzing', run_id="run1", progress=0.5)
    with mock.patch.object(analyzer_api.jobs, 'alive', return_value=True):
        res = api.post("{}/{}/cancel".format(DATASETS, d.id))
    assert res.data['status'] == 'canceled'
    d.refresh_from_db()
    assert d.run_id == ""


def test_an_analysis_whose_job_is_gone_is_marked_failed(api):
    d = dataset(status='analyzing', run_id="gone")
    with mock.patch.object(analyzer_api.jobs, 'alive', return_value=False):
        res = api.get("{}/{}".format(DATASETS, d.id))
    assert res.data['status'] == 'failed'
    assert "stopped" in res.data['error']


def test_a_failed_analysis_says_why(db):
    d = dataset(source='folder', folder="/nowhere/at/all", status='analyzing', run_id="run1")
    assert 'error' in thermal_analysis.analyze_dataset(d.id, "run1")
    d.refresh_from_db()
    assert d.status == 'failed'
    assert "/nowhere/at/all" in d.error


def test_renaming_does_not_undo_what_a_running_analysis_wrote(api):
    d = dataset(status='analyzing', run_id="run1")
    stale = ThermalDataset.objects.get(pk=d.id)
    ThermalDataset.objects.filter(pk=d.id).update(status='ready', analysis={'files': []}, run_id="")
    with mock.patch.object(analyzer_api, 'get_dataset', return_value=stale):
        res = api.patch("{}/{}".format(DATASETS, d.id), {'name': "Roof, east"}, format='json')
    assert res.status_code == 200
    d.refresh_from_db()
    assert (d.name, d.status, d.analysis) == ("Roof, east", 'ready', {'files': []})
    assert api.patch("{}/{}".format(DATASETS, d.id), {'name': ""}, format='json').status_code == 400


def test_a_reports_text_is_saved_on_the_dataset_a_field_at_a_time(api):
    d = dataset(name="Roof")
    url = "{}/{}".format(DATASETS, d.id)
    assert api.get(url).data['report'] == {}
    res = api.patch(url, {'report': {'title': "Roof survey", 'date': "2026-10-28", 'appendix': True}}, format='json')
    assert res.status_code == 200
    res = api.patch(url, {'report': {'notes': "Wet insulation\nnear the north edge", 'date': ""}}, format='json')
    assert res.data['report'] == {'title': "Roof survey", 'date': "", 'appendix': True,
                                  'notes': "Wet insulation\nnear the north edge"}
    assert res.data['name'] == "Roof"        # the name is left as it was
    d.refresh_from_db()
    assert d.report['title'] == "Roof survey" and d.name == "Roof"


def test_a_reports_text_is_refused_when_it_is_not_what_the_report_holds(api):
    url = "{}/{}".format(DATASETS, dataset().id)
    for report in [{'title': "x" * 256}, {'notes': "x" * 10001}, {'author': 5}, {'date': "28.10.2026"},
                   {'date': "2026-02-30"}, {'appendix': "yes"}, {'colour': "red"}, ["title"]]:
        res = api.patch(url, {'report': report}, format='json')
        assert res.status_code == 400, report
        assert 'report' in res.data
    assert api.get(url).data['report'] == {}


def test_the_author_last_typed_on_a_report_is_kept_and_not_forgotten_by_a_blank_one(api):
    url = "{}/{}".format(DATASETS, dataset().id)
    api.patch(url, {'report': {'author': "  A. Inspector "}}, format='json')
    assert analyzer_api.report_author() == "A. Inspector"
    api.patch(url, {'report': {'author': ""}}, format='json')
    assert analyzer_api.report_author() == "A. Inspector"
