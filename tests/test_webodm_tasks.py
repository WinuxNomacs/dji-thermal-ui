"""Process in WebODM: a task made in WebODM from a conversion's temperature TIFFs, through its API (made waiting for its
images, the TIFFs uploaded in batches, then committed), the checks carried over from the plugin, the projects, nodes,
options and presets offered, the task followed on the conversion, and its orthophoto brought back and shown beside
the conversion's mosaics, and its DSM brought back for the mosaics to be projected onto. WebODM is a fake keeping its projects, tasks, presets and results."""

import io
import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
from unittest import mock

import pytest

from dji_thermal_ui.analyzer import envfile, jobs, webodm, webodm_tasks
from dji_thermal_ui.analyzer.models import Preferences, ThermalConversion, ThermalDataset, WebODMTask
from tests.fakes import (CONVERSIONS, DATASETS, MOSAIC_ORIGIN, converted, fake_make_mosaic, mosaic_lonlat,
                         mosaic_square)

URL = "http://127.0.0.1:8001"
PLAN = {'process_args': ["-o", "temp_c:tiff", "--max-pitch", "-80", "--normalize"],
        'recommended': {'radiometric-calibration': {'value': "none", 'reason': "the TIFFs hold temperatures"}},
        'consider': {'fast-orthophoto': {'value': True, 'reason': "flat ground"}}}
OPTIONS = [{'name': "radiometric-calibration", 'type': "enum", 'value': "camera", 'domain': ["none", "camera"],
            'help': "Calibration"},
           {'name': "orthophoto-resolution", 'type': "float", 'value': "5", 'domain': "positive float", 'help': "cm/px"},
           {'name': "fast-orthophoto", 'type': "bool", 'value': "false", 'domain': "", 'help': "Skip"}]


class Answer(io.BytesIO):
    status = 200
    headers = {}


def multipart_names(req):
    return re.findall(rb'filename="([^"]+)"', req.data)


@pytest.fixture
def wo(settings, tmp_path, monkeypatch):
    """A WebODM taking the login in .env, with one project of the account's and one shared with it read-only"""
    settings.ENV_FILES = [tmp_path / ".env"]
    envfile.write({'WEBODM_URL': URL, 'WEBODM_USERNAME': "thermaltest", 'WEBODM_PASSWORD': "pw"})
    fake = {'projects': {1: {'name': "Roof survey", 'permissions': ["add", "change", "delete", "view"]},
                         2: {'name': "Shared site", 'permissions': ["view"]}},
            'tasks': {}, 'presets': [{'id': 1, 'name': "DSM + DTM", 'system': True,
                                      'options': [{'name': "dsm", 'value': True}]}],
            'uploads': [], 'calls': [], 'fail': {}, 'next': 10, 'status': 10, 'hold': None, 'assets': {},
            'on_download': None}

    def answer(code, data, url):
        if code >= 400:
            raise urllib.error.HTTPError(url, code, "No", {}, io.BytesIO(json.dumps(data).encode()))
        return Answer(json.dumps(data).encode() if data is not None else b"")

    def open_(req, timeout):
        method, url = req.get_method(), req.full_url
        path = url[len(URL):]
        fake['calls'].append((method, path))
        if path == "/api/token-auth/":
            return Answer(b'{"token": "tok"}')
        for prefix, code in fake['fail'].items():
            if (method + " " + path).startswith(prefix):
                return answer(code, {'detail': "Refused."}, url)
        body = json.loads(req.data) if req.data and req.get_header('Content-type') == 'application/json' else None
        if path == "/api/processingnodes/":
            return answer(200, [{'id': 1, 'label': "node-odx-1", 'online': True}], url)
        if path == "/api/processingnodes/options/":
            return answer(200, OPTIONS, url)
        if path == "/api/projects/?ordering=-created_at":
            return answer(200, [{'id': i, **p} for i, p in sorted(fake['projects'].items(), reverse=True)], url)
        if method == "POST" and path == "/api/projects/":
            fake['next'] += 1
            fake['projects'][fake['next']] = {'name': body['name'], 'permissions': ["add", "change", "delete", "view"]}
            return answer(201, {'id': fake['next'], 'name': body['name']}, url)
        if path == "/api/presets/":
            if method == "POST":
                preset = {'id': len(fake['presets']) + 1, 'system': False, **body}
                fake['presets'].append(preset)
                return answer(201, preset, url)
            return answer(200, fake['presets'], url)
        m = re.match(r'^/api/presets/(\d+)/$', path)
        if m and method == "PATCH":
            preset = next(p for p in fake['presets'] if p['id'] == int(m[1]))
            preset.update(body)
            return answer(200, preset, url)
        m = re.match(r'^/api/projects/(\d+)/$', path)
        if m and method == "DELETE":
            fake['projects'].pop(int(m[1]))
            return answer(204, None, url)
        m = re.match(r'^/api/projects/(\d+)/tasks/([\w-]+)/download/([\w.]+)$', path)
        if m:
            data = fake['assets'].get((m[2], m[3]))
            if data is None:
                return answer(404, {'detail': "Not found."}, url)
            if fake['on_download']:
                fake['on_download']()
            res = Answer(data)
            res.headers = {'Content-Length': str(len(data))}
            return res
        m = re.match(r'^/api/projects/(\d+)/tasks/(?:([\w-]+)/(?:(\w+)/)?)?$', path)
        if m:
            project, task, action = int(m[1]), m[2], m[3]
            if project not in fake['projects']:
                return answer(404, {'detail': "Not found."}, url)
            if method == "POST" and not task:
                tid = "task-%d" % (len(fake['tasks']) + 1)
                fake['tasks'][tid] = dict(body, project=project, images=[], status=None, committed=False)
                return answer(201, {'id': tid}, url)
            t = fake['tasks'].get(task)
            if t is None:
                return answer(404, {'detail': "Not found."}, url)
            if action == "upload":
                if fake['hold']:
                    fake['hold'][0].set()
                    fake['hold'][1].wait(10)
                t['images'] += multipart_names(req)
                fake['uploads'].append(len(multipart_names(req)))
                return answer(200, {'success': True}, url)
            if action == "commit":
                t.update(committed=True, status=fake['status'])
                return answer(200, {'id': task, 'status': fake['status']}, url)
            if action == "remove":
                fake['tasks'].pop(task)
                return answer(200, {'success': True}, url)
            return answer(200, {'id': task, 'status': t['status'], 'running_progress': t.get('progress', 0),
                                'last_error': t.get('error')}, url)
        return answer(404, {'detail': "Not found."}, url)

    monkeypatch.setattr(webodm._opener, 'open', open_)
    webodm._tokens.clear()
    yield fake
    webodm._tokens.clear()


def ready(api, **settings):
    """A converted dataset of two frames, its flight analysed with the WebODM plan"""
    c, _ = converted(api, dict({'outputs': ['temp_c:tiff'], 'normalize': True, 'max_pitch': -80}, **settings))
    ThermalDataset.objects.filter(pk=c.dataset_id).update(analysis={'webodm': PLAN})
    c.refresh_from_db()
    return c


def start(api, c, **over):
    return api.post("%s/%d/webodm" % (CONVERSIONS, c.id), dict({'project': 1, 'options': [
        {'name': "radiometric-calibration", 'value': "none"}]}, **over), format='json')


def test_the_panel_offers_the_plans_options_the_names_and_the_frames_without_asking_webodm(api, wo):
    c = ready(api)
    Preferences.objects.update_or_create(pk=1, defaults={'data': {'webodm_preset': 1}})
    res = api.get("%s/%d/webodm" % (CONVERSIONS, c.id))
    assert res.status_code == 200
    assert res.data == {
        'configured': True, 'problems': [], 'warnings': [],
        'options': [{'name': "radiometric-calibration", 'value': "none", 'reason': "the TIFFs hold temperatures",
                     'recommended': True},
                    {'name': "fast-orthophoto", 'value': True, 'reason': "flat ground", 'recommended': False}],
        'frames': 2, 'bytes': 2000, 'name': "Roof - " + c.name, 'project_name': "Default Project",
        'process_args': PLAN['process_args'], 'preset': 1}
    assert wo['calls'] == []


def test_what_stops_a_task_or_warns_against_it_is_said(api, wo):
    c = ready(api, strip_location=True, normalize=False, max_pitch=None, emissivity=0.9)
    ThermalDataset.objects.filter(pk=c.dataset_id).update(analysis={'webodm': dict(
        PLAN, process_args=PLAN['process_args'] + ["--emissivity", "0.95"])})
    data = api.get("%s/%d/webodm" % (CONVERSIONS, c.id)).data
    assert data['problems'] == ["The dataset's frames had their location removed: ODM needs it to place them"]
    assert data['warnings'] == ["Not normalized: the frames' offsets show as seams where ODM blends them",
                                "Oblique frames kept: the plan leaves out frames above -80° pitch",
                                "Emissivity 0.9, the plan's is 0.95"]
    res = start(api, c)
    assert res.status_code == 400 and "location removed" in res.data['error']
    assert not WebODMTask.objects.exists()

    c2, _ = converted(api)
    ThermalConversion.objects.filter(pk=c2.pk).update(results={'files': [
        {'path': "DJI_0001_T.JPG", 'ok': True, 'outputs': ["DJI_0001_T_pseudo.png"]}]})
    assert api.get("%s/%d/webodm" % (CONVERSIONS, c2.id)).data['problems'] == [
        "The dataset has no temperature TIFFs (temp_c:tiff): convert one with them"]
    ThermalConversion.objects.filter(pk=c2.pk).update(status='converting')
    assert api.get("%s/%d/webodm" % (CONVERSIONS, c2.id)).data['problems'] == ["The dataset is not converted yet"]


def test_a_task_is_made_waiting_for_its_images_the_tiffs_uploaded_then_committed(api, wo):
    c = ready(api)
    res = start(api, c, name="Roof thermal", node=1, preset=1)
    assert res.status_code == 201, res.data
    task = WebODMTask.objects.get()
    assert (task.status, task.project_id, task.project_name, task.name, task.node, task.total, task.uploaded,
            task.progress, task.half_made) == ("queued", 1, "Roof survey", "Roof thermal", "node-odx-1", 2000, 2000, 0,
                                               False)
    made = wo['tasks'][task.task_id]
    assert (made['partial'], made['name'], made['processing_node'], made['auto_processing_node'], made['options']) == \
        (True, "Roof thermal", 1, False, [{'name': "radiometric-calibration", 'value': "none"}])
    assert sorted(made['images']) == [b"DJI_0001_T_temp_c.tiff", b"DJI_0002_T_temp_c.tiff"] and made['committed']
    assert res.data['link'] == URL + "/dashboard/?project_task_open=1&project_task_expanded=" + task.task_id
    assert Preferences.load().data['webodm_preset'] == 1
    # The card lists it
    listed = api.get("%s/%d" % (CONVERSIONS, c.id)).data['webodm_tasks']
    assert [(t['name'], t['status']) for t in listed] == [("Roof thermal", "queued")]


def test_a_new_project_is_made_named_after_the_apps_unless_changed_and_webodm_chooses_the_node(api, wo):
    c = ready(api)
    assert start(api, c, project=None).status_code == 201
    assert start(api, c, project=None, project_name="Thermal 2026").status_code == 201
    assert [p['name'] for p in wo['projects'].values()][2:] == ["Default Project", "Thermal 2026"]
    first = WebODMTask.objects.order_by('id').first()
    assert (first.project_id, first.name, first.node) == (11, "Roof - " + c.name, "")
    assert wo['tasks'][first.task_id]['auto_processing_node'] is True


def test_a_project_or_node_the_account_cannot_use_and_bad_options_are_refused_before_uploading(api, wo):
    c = ready(api)
    assert "Can change Project" in start(api, c, project=2).data['project']
    assert "no such project" in start(api, c, project=9).data['project']
    assert "cannot see that processing node" in start(api, c, node=5).data['node']
    assert "needs a value" in start(api, c, options=[{'name': "dsm", 'value': ""}]).data['options']
    assert "given twice" in start(api, c, options=[{'name': "dsm", 'value': True}] * 2).data['options']
    assert "like orthophoto-resolution" in start(api, c, options=[{'name': "--dsm", 'value': 1}]).data['options']
    assert not WebODMTask.objects.exists() and not wo['tasks']


def test_an_upload_webodm_refuses_fails_and_removes_the_half_made_task_and_the_project_it_made(api, wo):
    c = ready(api)
    wo['fail']["POST /api/projects/11/tasks/task-1/upload/"] = 500
    assert start(api, c, project=None).status_code == 201
    task = WebODMTask.objects.get()
    assert (task.status, task.error, task.task_id, task.project_id, task.half_made) == \
        ("failed", "WebODM answered 500: try again later", "", None, False)
    assert wo['tasks'] == {} and 11 not in wo['projects']


def test_a_task_that_could_not_be_removed_stays_half_made_and_is_removed_when_the_server_starts_again(api, wo):
    c = ready(api)
    wo['fail'].update({"POST /api/projects/1/tasks/task-1/upload/": 500,
                       "POST /api/projects/1/tasks/task-1/remove/": 502})
    start(api, c)
    task = WebODMTask.objects.get()
    assert (task.status, task.task_id, task.half_made) == ("failed", "task-1", True)
    del wo['fail']["POST /api/projects/1/tasks/task-1/remove/"]
    webodm_tasks.remove_half_made()
    task.refresh_from_db()
    assert (task.task_id, task.half_made, task.project_id) == ("", False, 1)
    assert wo['tasks'] == {}


def test_uploads_are_sent_in_batches_with_their_progress(api, wo, monkeypatch):
    c = ready(api)
    monkeypatch.setattr(webodm_tasks, 'BATCH_FILES', 1)
    start(api, c)
    assert wo['uploads'] == [1, 1]
    monkeypatch.setattr(webodm_tasks, 'BATCH_FILES', 50)
    monkeypatch.setattr(webodm_tasks, 'BATCH_BYTES', 30)
    assert [len(b) for b in webodm_tasks.batches([("a", "a", 10), ("b", "b", 10), ("c", "c", 40), ("d", "d", 1)])] == \
        [2, 1, 1]


@pytest.mark.django_db(transaction=True)
def test_an_upload_runs_on_its_own_worker_and_canceling_it_removes_the_half_made_task(api, wo, request):
    c = ready(api)              # converted inline, with dji-thermal-cli faked
    threaded_jobs = request.getfixturevalue('threaded_jobs')
    reached, go = threading.Event(), threading.Event()
    wo['hold'] = (reached, go)
    res = start(api, c)
    assert res.status_code == 201 and res.data["status"] == "uploading", res.data
    assert reached.wait(10)
    assert threaded_jobs.alive(WebODMTask.objects.get().run_id)
    # The conversions' worker is free meanwhile
    ran = []
    threaded_jobs.submit(lambda pk, run_id: ran.append(threading.current_thread().name), 1, "other")
    deadline = time.time() + 10
    while not ran and time.time() < deadline:
        time.sleep(0.02)
    assert ran == ["dji-thermal-ui-jobs"]

    res = api.post("/api/webodm-tasks/%d/cancel" % res.data['id'])
    assert res.data['status'] == "canceled"
    go.set()
    threaded_jobs.join()
    task = WebODMTask.objects.get()
    assert (task.status, task.task_id, task.half_made) == ("canceled", "", False)
    assert wo['tasks'] == {}
    assert webodm_tasks.summary(task)['link'] is None


def test_a_closed_server_leaves_an_upload_failed_and_half_made_for_removal(db):
    from tests.fakes import dataset
    conv = ThermalConversion.objects.create(dataset=dataset(), name="c", status='ready')
    WebODMTask.objects.create(conversion=conv, url=URL, project_id=1, project_name="p", task_id="t", name="n",
                              status='uploading', run_id="r", half_made=True)
    assert jobs.mark_interrupted() == 1
    task = WebODMTask.objects.get()
    assert (task.status, task.error, task.half_made) == ("failed", jobs.INTERRUPTED, True)
    with mock.patch.object(webodm_tasks.jobs, 'submit') as submit:
        webodm_tasks.remove_half_made()
    assert submit.call_args[0][1:] == (task.pk, "", jobs.UPLOADS)


def test_a_task_is_followed_in_webodm_at_most_every_few_seconds_and_kept_when_its_conversion_goes(api, wo):
    c = ready(api)
    tid = start(api, c).data['id']
    task = WebODMTask.objects.get()
    wo['tasks'][task.task_id].update(status=20, progress=0.42)
    # Just committed: not asked again yet
    assert api.get("/api/webodm-tasks/%d" % tid).data['status'] == "queued"
    WebODMTask.objects.update(checked_at=None)
    data = api.get("/api/webodm-tasks/%d" % tid).data
    assert (data['status'], data['progress'], data['check_error']) == ("running", 0.42, "")

    wo['tasks'][task.task_id].update(status=30, error="Not enough images")
    WebODMTask.objects.update(checked_at=None)
    data = api.get("/api/webodm-tasks/%d" % tid).data
    assert (data['status'], data['error']) == ("failed", "Not enough images")

    # Removed in WebODM meanwhile
    WebODMTask.objects.update(status='running', checked_at=None)
    wo['tasks'].clear()
    assert api.get("/api/webodm-tasks/%d" % tid).data['status'] == "gone"

    # WebODM out of reach: said, not kept
    WebODMTask.objects.update(status='running', checked_at=None)
    wo['fail']["GET /api/projects/1/tasks/"] = 503
    data = api.get("/api/webodm-tasks/%d" % tid).data
    assert (data['status'], data['check_error']) == ("running", "WebODM answered 503: try again later")

    # Taken off the list, or its conversion deleted: WebODM is not asked to remove anything
    calls = len(wo['calls'])
    assert api.delete("%s/%d" % (CONVERSIONS, c.id)).status_code == 204
    assert not WebODMTask.objects.exists()
    assert not [x for x in wo['calls'][calls:] if "remove" in x[1] or x[0] == "DELETE"]


def test_a_task_off_the_list_is_kept_in_webodm_but_not_while_it_uploads(api, wo):
    c = ready(api)
    tid = start(api, c).data['id']
    WebODMTask.objects.update(status='uploading', run_id="r")
    with mock.patch.object(webodm_tasks.jobs, 'alive', return_value=True):
        assert api.delete("/api/webodm-tasks/%d" % tid).status_code == 409
    assert api.delete("/api/webodm-tasks/%d" % tid).status_code == 204    # its job gone: it failed
    assert len(wo['tasks']) == 1


def test_the_projects_nodes_options_and_presets_offered(api, wo):
    data = api.get("/api/webodm/projects").data
    assert data == {'count': 2, 'projects': [{'id': 2, 'name': "Shared site", 'can_add': False},
                                             {'id': 1, 'name': "Roof survey", 'can_add': True}]}
    assert [p['name'] for p in api.get("/api/webodm/projects?search=ROOF").data['projects']] == ["Roof survey"]
    data = api.get("/api/webodm/choices").data
    assert data['nodes'] == [{'id': 1, 'label': "node-odx-1", 'online': True}]
    assert [o['name'] for o in data['options']] == [o['name'] for o in OPTIONS]
    assert data['presets'] == [{'id': 1, 'name': "DSM + DTM", 'system': True, 'options': [{'name': "dsm", 'value': True}]}]


def test_options_are_kept_as_a_preset_of_the_accounts_own_changed_when_named_again(api, wo):
    opts = [{'name': "fast-orthophoto", 'value': True}]
    res = api.post("/api/webodm/presets", {'name': "Thermal", 'options': opts}, format='json')
    assert res.status_code == 200 and res.data['id'] == 2
    res = api.post("/api/webodm/presets", {'name': "Thermal", 'options': opts[:0] + [{'name': "dsm", 'value': True}]},
                   format='json')
    assert res.data['id'] == 2 and [p['name'] for p in res.data['presets']] == ["DSM + DTM", "Thermal"]
    assert wo['presets'][1]['options'] == [{'name': "dsm", 'value': True}]
    # A system preset's name makes one of the account's own
    assert api.post("/api/webodm/presets", {'name': "DSM + DTM", 'options': opts}, format='json').data['id'] == 3
    assert "Type the preset's name" in api.post("/api/webodm/presets", {'name': " ", 'options': opts},
                                                format='json').data['name']


def test_without_webodm_set_up_it_is_said_where_to_set_it_up(api, settings, tmp_path):
    settings.ENV_FILES = [tmp_path / ".env"]
    res = api.get("/api/webodm/choices")
    assert res.status_code == 400 and "System Settings › WebODM" in res.data['error']


def orthophoto_bytes(tmp_path, colours=False):
    """WebODM's orthophoto of the fake mosaic's place: 2 bands of floats (°C rising from 10 to 30 to the east, its
    alpha 0 on column 40), or 4 bands of colours"""
    import numpy as np
    import rasterio
    from rasterio.enums import ColorInterp
    from rasterio.transform import from_origin
    path = tmp_path / "odm.tif"
    count, dtype = (4, 'uint8') if colours else (2, 'float32')
    with rasterio.open(path, 'w', driver='GTiff', width=64, height=64, count=count, dtype=dtype, crs='EPSG:32616',
                       transform=from_origin(*MOSAIC_ORIGIN, 0.05, 0.05)) as dst:
        if colours:
            dst.write(np.full((4, 64, 64), 200, 'uint8'))
            dst.colorinterp = [ColorInterp.red, ColorInterp.green, ColorInterp.blue, ColorInterp.alpha]
        else:
            dst.write(np.tile(10 + 20 * np.arange(64, dtype='float32') / 63, (64, 1)), 1)
            alpha = np.full((64, 64), 255, 'float32')
            alpha[:, 40] = 0
            dst.write(alpha, 2)
            dst.colorinterp = [ColorInterp.gray, ColorInterp.alpha]
    return path.read_bytes()


def completed(api, wo, c, tmp_path, **over):
    """A task of the conversion's that WebODM completed, with its orthophoto"""
    task = WebODMTask.objects.get(pk=start(api, c).data['id'])
    WebODMTask.objects.filter(pk=task.pk).update(status='completed', **over)
    wo['assets'][(task.task_id, 'orthophoto.tif')] = orthophoto_bytes(tmp_path)
    task.refresh_from_db()
    return task


def bring(api, task):
    return api.post("/api/webodm-tasks/%d/orthophoto" % task.id)


def test_a_completed_tasks_orthophoto_is_brought_back_as_temperatures_and_shown_beside_the_mosaics(api, wo, tmp_path):
    import rasterio
    c = ready(api, unit='F')
    task = completed(api, wo, c, tmp_path)
    res = bring(api, task)
    assert res.status_code == 200
    c.refresh_from_db()
    assert c.orthophoto['task'] == task.id and c.orthophoto['task_name'] == task.name
    assert c.orthophoto['raster'] == "webodm/orthophoto-%d.tif" % task.id
    assert os.listdir(os.path.join(c.data_dir(), "webodm")) == ["orthophoto-%d.tif" % task.id]
    with rasterio.open(os.path.join(c.data_dir(), c.orthophoto['raster'])) as src:
        assert src.count == 3 and src.overviews(1) == []
    # In the conversion's unit (°F), the alpha's no-data left out
    assert c.orthophoto['unit'] == 'F'
    assert c.orthophoto['temperature']['min'] == pytest.approx(50.0, abs=0.01)
    assert c.orthophoto['temperature']['max'] == pytest.approx(30 * 1.8 + 32, abs=0.01)
    summary = api.get("%s/%d" % (CONVERSIONS, c.id)).data
    assert summary['orthophoto']['task'] == task.id and summary['webodm_tasks'][0]['orthophoto_status'] == ""
    # A tab of the viewer after the mosaics', and a mosaic to compare; without mosaics of the conversion's own too
    viewer = api.get("%s/%d/mosaics" % (CONVERSIONS, c.id)).data
    assert [t['tab'] for t in viewer['tabs']][-2:] == ['view_angle', 'webodm']
    ThermalConversion.objects.filter(pk=c.pk).update(mosaics={}, mosaic_status="")
    viewer = api.get("%s/%d/mosaics" % (CONVERSIONS, c.id)).data
    assert [t['tab'] for t in viewer['tabs']] == ['webodm'] and viewer['unit'] == 'F'
    assert 'raster' not in viewer['kinds']['webodm']
    assert api.get("%s/%d/comparable" % (CONVERSIONS, c.id)).data[0]['tabs'] == ['webodm']
    nav = api.get("/api/navigation").data['projects'][0]['datasets'][0]['conversions'][0]
    assert nav['mosaics']
    lon, lat = mosaic_lonlat(31.5, 10.5)
    point = api.get("%s/%d/mosaics/webodm/point?lon=%r&lat=%r" % (CONVERSIONS, c.id, lon, lat)).data
    assert point['temperature'] == pytest.approx((10 + 20 * 31 / 63) * 1.8 + 32, abs=0.01)
    assert point['frame'] is None and point['view_angle'] is None
    lon, lat = mosaic_lonlat(40.5, 10.5)
    assert api.get("%s/%d/mosaics/webodm/point?lon=%r&lat=%r" % (CONVERSIONS, c.id, lon, lat)).data['valid'] is False
    # Measured, and saved as a finding, as on a mosaic; no frames are said to have seen it while WebODM has no cameras
    # for the task (test_webodm_cameras has those that do)
    area = mosaic_square(30, 8, 34, 12)
    res = api.post("%s/%d/measure" % (CONVERSIONS, c.id), {'target': 'webodm', 'geometry': area}, format='json')
    assert res.status_code == 200 and res.data['result']['max'] > res.data['result']['min']
    line = {'type': 'LineString', 'coordinates': [mosaic_lonlat(5.5, 5.5), mosaic_lonlat(30.5, 5.5)]}
    assert api.post("%s/%d/measure" % (CONVERSIONS, c.id), {'target': 'webodm', 'geometry': line},
                    format='json').status_code == 200
    sources = api.post("%s/%d/mosaics/webodm/sources" % (CONVERSIONS, c.id), {'geometry': area}, format='json').data
    assert sources['frames'] == [] and sources['reason'] == 'no_cameras'
    res = api.post("%s/%d/findings" % (DATASETS, c.dataset_id), {'name': "Hot", 'conversion': c.id, 'tab': 'webodm',
                                                                 'geometry': area}, format='json')
    assert res.status_code == 201 and res.data['tab'] == 'webodm'
    # Rebuilding the conversion's mosaics keeps it
    ThermalConversion.objects.filter(pk=c.pk).update(mosaics={}, mosaic_status='building')
    assert [t['tab'] for t in api.get("%s/%d/mosaics" % (CONVERSIONS, c.id)).data['tabs']] == ['webodm']


def test_another_tasks_orthophoto_replaces_it_and_removing_it_or_its_task_removes_its_file(api, wo, tmp_path):
    c = ready(api)
    first, second = completed(api, wo, c, tmp_path), completed(api, wo, c, tmp_path)
    bring(api, first)
    bring(api, second)
    c.refresh_from_db()
    folder = os.path.join(c.data_dir(), "webodm")
    assert c.orthophoto['task'] == second.id and os.listdir(folder) == ["orthophoto-%d.tif" % second.id]
    # Taking the other task off the list leaves it; its own takes it away
    assert api.delete("/api/webodm-tasks/%d" % first.id).status_code == 204
    assert os.listdir(folder) == ["orthophoto-%d.tif" % second.id]
    assert api.delete("/api/webodm-tasks/%d" % second.id).status_code == 204
    c.refresh_from_db()
    assert c.orthophoto == {} and os.listdir(folder) == []
    # Removed from the card: the conversion's orthophoto, whichever task it came from
    third = completed(api, wo, c, tmp_path)
    bring(api, third)
    res = api.delete("%s/%d/orthophoto" % (CONVERSIONS, c.id))
    assert res.status_code == 200 and res.data['orthophoto'] is None and os.listdir(folder) == []
    assert WebODMTask.objects.filter(pk=third.pk).exists()


def test_an_orthophoto_is_brought_back_only_from_a_completed_task_and_one_in_colours_is_not_kept(api, wo, tmp_path):
    c = ready(api)
    task = completed(api, wo, c, tmp_path)
    WebODMTask.objects.filter(pk=task.pk).update(status='running')
    assert "once WebODM has completed it" in bring(api, task).data['error']
    WebODMTask.objects.filter(pk=task.pk).update(status='completed', orthophoto_status='downloading',
                                                 run_id="someone-else")
    with mock.patch.object(jobs, 'alive', return_value=True):
        assert bring(api, task).status_code == 409
    WebODMTask.objects.filter(pk=task.pk).update(orthophoto_status="", run_id="")
    wo['assets'][(task.task_id, 'orthophoto.tif')] = orthophoto_bytes(tmp_path, colours=True)
    data = bring(api, task).data
    assert data['orthophoto_status'] == 'failed' and "holds colours, not temperatures" in data['orthophoto_error']
    c.refresh_from_db()
    assert c.orthophoto == {} and os.listdir(os.path.join(c.data_dir(), "webodm")) == []
    # Gone from WebODM: said so
    wo['assets'].clear()
    data = bring(api, task).data
    assert data['orthophoto_status'] == 'failed' and "removed, or the account cannot see it" in data['orthophoto_error']


def test_a_download_canceled_part_way_leaves_nothing_and_one_a_closed_server_left_is_failed(api, wo, tmp_path):
    c = ready(api)
    task = completed(api, wo, c, tmp_path)
    wo['on_download'] = lambda: api.delete("/api/webodm-tasks/%d/orthophoto" % task.id)
    data = bring(api, task).data
    assert data['orthophoto_status'] == "" and data['orthophoto_error'] == ""
    c.refresh_from_db()
    assert c.orthophoto == {} and os.listdir(os.path.join(c.data_dir(), "webodm")) == []
    WebODMTask.objects.filter(pk=task.pk).update(orthophoto_status='downloading', run_id="gone")
    assert jobs.mark_interrupted() == 1
    task.refresh_from_db()
    assert task.orthophoto_status == 'failed' and task.orthophoto_error == jobs.INTERRUPTED and task.run_id == ""


def dsm_bytes(tmp_path):
    """WebODM's DSM of the fake mosaic's place: altitudes in metres, as ODM writes them (Deflate, the horizontal
    predictor, tiled, -9999 for no data on column 40)"""
    import numpy as np
    import rasterio
    from rasterio.transform import from_origin
    path = tmp_path / "dsm.tif"
    z = np.tile(200 + np.arange(64, dtype='float32') / 10, (64, 1))
    z[:, 40] = -9999
    with rasterio.open(path, 'w', driver='GTiff', width=64, height=64, count=1, dtype='float32', crs='EPSG:32616',
                       transform=from_origin(*MOSAIC_ORIGIN, 0.05, 0.05), nodata=-9999, compress='deflate',
                       predictor=2, tiled=True, blockxsize=32, blockysize=32) as dst:
        dst.write(z, 1)
    return path.read_bytes()


def with_dsm(api, wo, c, tmp_path):
    """A completed task of the conversion's that asked WebODM for a DSM, and has it"""
    task = WebODMTask.objects.get(pk=start(api, c, options=[{'name': "dsm", 'value': True}]).data['id'])
    WebODMTask.objects.filter(pk=task.pk).update(status='completed')
    wo['assets'][(task.task_id, 'dsm.tif')] = dsm_bytes(tmp_path)
    task.refresh_from_db()
    return task


def build_mosaics(api, c):
    with mock.patch('dji_thermal_cli.api.make_mosaic', side_effect=fake_make_mosaic) as make:
        assert api.post("%s/%d/mosaics" % (CONVERSIONS, c.id)).status_code == 200
    return make.call_args.args[3]


def test_a_completed_tasks_dsm_is_brought_back_as_written_and_the_mosaics_are_projected_onto_it(api, wo, tmp_path):
    c = ready(api)
    task = with_dsm(api, wo, c, tmp_path)
    assert api.get("/api/webodm-tasks/%d" % task.id).data['dsm_asked'] is True
    assert api.get("/api/webodm-tasks/%d" % completed(api, wo, c, tmp_path).id).data['dsm_asked'] is False
    data = api.post("/api/webodm-tasks/%d/dsm" % task.id).data
    assert data['dsm_status'] == "" and data['dsm_error'] == ""
    c.refresh_from_db()
    assert c.dsm['raster'] == "webodm/dsm-%d.tif" % task.id and c.dsm['task'] == task.id
    assert (c.dsm['use'], c.dsm['height_cell'], c.dsm['pixel_m']) == (True, webodm_tasks.DSM_CELL, 0.05)
    path = os.path.join(c.data_dir(), c.dsm['raster'])
    with open(path, 'rb') as f:
        assert f.read() == dsm_bytes(tmp_path)
    assert c.orthophoto == {}
    # Used the next time the mosaics are built, which say so
    options = build_mosaics(api, c)
    assert (os.path.normpath(options.dsm), options.height_cell) == (os.path.normpath(path), webodm_tasks.DSM_CELL)
    detail = api.get("%s/%d" % (CONVERSIONS, c.id)).data
    assert detail['dsm']['use'] is True and detail['dsm']['task_name'] == task.name
    assert detail['mosaics_dsm'] == {'task_name': task.name, 'height_cell': webodm_tasks.DSM_CELL}
    # Its cell changed, then not used: the mosaics are built on their own heights again
    url = "%s/%d/dsm" % (CONVERSIONS, c.id)
    assert api.patch(url, {'height_cell': 32}, format='json').data['dsm']['height_cell'] == 32
    assert build_mosaics(api, c).height_cell == 32
    assert api.patch(url, {'use': False}, format='json').data['dsm']['use'] is False
    options = build_mosaics(api, c)
    assert options.dsm is None and options.height_cell != 32
    assert api.get("%s/%d" % (CONVERSIONS, c.id)).data['mosaics_dsm'] is None
    for bad in ({'height_cell': 4}, {'height_cell': 2000}, {'height_cell': 16.5}, {'height_cell': True},
                {'use': "yes"}, {'raster': "../x.tif"}):
        assert api.patch(url, bad, format='json').status_code == 400, bad


def test_the_dsm_is_shown_on_a_heights_tab_and_gives_the_grounds_height_to_the_readout_and_measurements(api, wo, tmp_path):
    import rasterio
    c = ready(api)
    task = with_dsm(api, wo, c, tmp_path)
    api.post("/api/webodm-tasks/%d/dsm" % task.id)
    c.refresh_from_db()
    # Its copy: heights above its lowest ground (200 m on column 0), tiled, its no-data column left out
    assert c.dsm['heights_raster'] == "webodm/dsm-%d-heights.tif" % task.id and c.dsm['base_m'] == 200.0
    assert c.dsm['heights']['min'] == pytest.approx(0) and c.dsm['heights']['max'] == pytest.approx(6.3, abs=1e-4)
    with rasterio.open(os.path.join(c.data_dir(), c.dsm['heights_raster'])) as src:
        assert src.count == 1 and src.profile['tiled']
    viewer = api.get("%s/%d/mosaics" % (CONVERSIONS, c.id)).data
    tab = viewer['tabs'][-1]
    assert tab['tab'] == 'heights' and tab['stats']['max'] == pytest.approx(6.3, abs=1e-4)
    assert 'raster' not in viewer['kinds']['dsm']
    # Not a temperature tab: nothing to compare, no measurement, no finding
    assert 'heights' not in api.get("%s/%d/comparable" % (CONVERSIONS, c.id)).data[0]['tabs']
    area = mosaic_square(30, 8, 34, 12)
    assert api.post("%s/%d/measure" % (CONVERSIONS, c.id), {'target': 'heights', 'geometry': area},
                    format='json').status_code == 400
    # Its tiles hold the heights as they are
    import numpy as np
    from dji_thermal_ui.analyzer import api as api_module
    from tests.test_api_mosaics import data_tile, mosaic_tile
    (z, x, y), _ = mosaic_tile()
    t = data_tile(api.get("%s/%d/mosaics/heights/data/%d/%d/%d" % (CONVERSIONS, c.id, z, x, y)),
                  api_module.DATA_TILE_SIZE + 2 * api_module.DATA_GUTTER)
    shown = t[np.isfinite(t)]
    assert shown.size and shown.min() >= 0 and shown.max() <= 6.31
    # The readout: the height on the Heights tab, and beside the temperature on the others
    lon, lat = mosaic_lonlat(31.5, 10.5)
    point = api.get("%s/%d/mosaics/heights/point?lon=%r&lat=%r" % (CONVERSIONS, c.id, lon, lat)).data
    assert point['valid'] and point['height'] == pytest.approx(3.1, abs=1e-4) and point['base_m'] == 200.0
    assert 'temperature' not in point
    point = api.get("%s/%d/mosaics/as_converted/point?lon=%r&lat=%r" % (CONVERSIONS, c.id, lon, lat)).data
    assert point['temperature'] is not None and point['height'] == pytest.approx(3.1, abs=1e-4)
    lon, lat = mosaic_lonlat(40.5, 10.5)
    point = api.get("%s/%d/mosaics/heights/point?lon=%r&lat=%r" % (CONVERSIONS, c.id, lon, lat)).data
    assert point['valid'] is False and point['reason'] == 'nodata'
    # A spot measured gets the ground's height, an area its range; a line nothing
    spot = {'type': 'Point', 'coordinates': list(mosaic_lonlat(31.5, 10.5))}
    result = api.post("%s/%d/measure" % (CONVERSIONS, c.id), {'target': 'as_converted', 'geometry': spot},
                      format='json').data['result']
    assert result['height'] == pytest.approx(3.1, abs=1e-4)
    result = api.post("%s/%d/measure" % (CONVERSIONS, c.id), {'target': 'as_converted', 'geometry': area},
                      format='json').data['result']
    assert result['heights']['min'] == pytest.approx(3.0, abs=1e-4) and result["heights"]["max"] == pytest.approx(3.3, abs=1e-4)
    line = {'type': 'LineString', 'coordinates': [mosaic_lonlat(5.5, 5.5), mosaic_lonlat(30.5, 5.5)]}
    result = api.post("%s/%d/measure" % (CONVERSIONS, c.id), {'target': 'as_converted', 'geometry': line},
                      format='json').data['result']
    assert 'height' not in result and 'heights' not in result
    # Removed: the tab and the heights go with it
    api.delete("%s/%d/dsm" % (CONVERSIONS, c.id))
    assert 'heights' not in [t['tab'] for t in api.get("%s/%d/mosaics" % (CONVERSIONS, c.id)).data['tabs']]
    lon, lat = mosaic_lonlat(31.5, 10.5)
    assert 'height' not in api.get("%s/%d/mosaics/as_converted/point?lon=%r&lat=%r" % (CONVERSIONS, c.id, lon, lat)).data
    assert os.listdir(os.path.join(c.data_dir(), "webodm")) == []


def test_another_tasks_dsm_replaces_it_keeping_its_choices_and_removing_it_or_its_task_removes_its_file(
        api, wo, tmp_path):
    c = ready(api)
    first, second = with_dsm(api, wo, c, tmp_path), with_dsm(api, wo, c, tmp_path)
    api.post("/api/webodm-tasks/%d/dsm" % first.id)
    url = "%s/%d/dsm" % (CONVERSIONS, c.id)
    api.patch(url, {'use': False, 'height_cell': 24}, format='json')
    api.post("/api/webodm-tasks/%d/dsm" % second.id)
    c.refresh_from_db()
    folder = os.path.join(c.data_dir(), "webodm")
    kept = ["dsm-%d-heights.tif" % second.id, "dsm-%d.tif" % second.id]
    assert c.dsm['task'] == second.id and sorted(os.listdir(folder)) == kept
    assert (c.dsm['use'], c.dsm['height_cell']) == (False, 24)
    assert api.delete("/api/webodm-tasks/%d" % first.id).status_code == 204
    assert sorted(os.listdir(folder)) == kept
    assert api.delete("/api/webodm-tasks/%d" % second.id).status_code == 204
    c.refresh_from_db()
    assert c.dsm == {} and os.listdir(folder) == []
    assert api.patch(url, {'use': True}, format='json').status_code == 404
    # Removed from the card; a mosaic build that finds it gone says so
    third = with_dsm(api, wo, c, tmp_path)
    api.post("/api/webodm-tasks/%d/dsm" % third.id)
    os.remove(os.path.join(folder, "dsm-%d.tif" % third.id))
    with mock.patch('dji_thermal_cli.api.make_mosaic', side_effect=fake_make_mosaic):
        api.post("%s/%d/mosaics" % (CONVERSIONS, c.id))
    c.refresh_from_db()
    assert c.mosaic_status == 'ready' and "WebODM's DSM is missing" in c.mosaic_error      # the last ones are kept
    res = api.delete(url)
    assert res.status_code == 200 and res.data['dsm'] is None


def test_a_dsm_is_brought_back_one_download_at_a_time_and_one_that_cannot_be_read_is_not_kept(api, wo, tmp_path):
    c = ready(api)
    task = with_dsm(api, wo, c, tmp_path)
    WebODMTask.objects.filter(pk=task.pk).update(orthophoto_status='downloading', run_id="someone-else")
    with mock.patch.object(jobs, 'alive', return_value=True):
        assert api.post("/api/webodm-tasks/%d/dsm" % task.id).status_code == 409
    WebODMTask.objects.filter(pk=task.pk).update(orthophoto_status="", run_id="")
    wo['assets'][(task.task_id, 'dsm.tif')] = b"not a TIFF at all"
    data = api.post("/api/webodm-tasks/%d/dsm" % task.id).data
    assert data['dsm_status'] == 'failed' and "not a readable GeoTIFF" in data['dsm_error']
    c.refresh_from_db()
    assert c.dsm == {} and os.listdir(os.path.join(c.data_dir(), "webodm")) == []
    # Canceled part way: nothing left; left by a closed server: failed
    wo['assets'][(task.task_id, 'dsm.tif')] = dsm_bytes(tmp_path)
    wo['on_download'] = lambda: api.delete("/api/webodm-tasks/%d/dsm" % task.id)
    data = api.post("/api/webodm-tasks/%d/dsm" % task.id).data
    assert data['dsm_status'] == "" and data['dsm_error'] == ""
    assert os.listdir(os.path.join(c.data_dir(), "webodm")) == []
    WebODMTask.objects.filter(pk=task.pk).update(dsm_status='downloading', run_id="gone")
    assert jobs.mark_interrupted() == 1
    task.refresh_from_db()
    assert task.dsm_status == 'failed' and task.dsm_error == jobs.INTERRUPTED
