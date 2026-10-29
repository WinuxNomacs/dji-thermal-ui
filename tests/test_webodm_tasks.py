"""Process in WebODM: a task made in WebODM from a conversion's temperature TIFFs, through its API (made waiting for its
images, the TIFFs uploaded in batches, then committed), the checks carried over from the plugin, the projects, nodes,
options and presets offered, and the task followed on the conversion. WebODM is a fake keeping its projects, tasks
and presets."""

import io
import json
import re
import threading
import time
import urllib.error
import urllib.parse
from unittest import mock

import pytest

from dji_thermal_ui.analyzer import envfile, jobs, webodm, webodm_tasks
from dji_thermal_ui.analyzer.models import Preferences, ThermalConversion, ThermalDataset, WebODMTask
from tests.fakes import CONVERSIONS, converted

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
            'uploads': [], 'calls': [], 'fail': {}, 'next': 10, 'status': 10, 'hold': None}

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
