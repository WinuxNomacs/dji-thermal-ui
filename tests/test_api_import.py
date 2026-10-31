"""A project's import: an exported archive sent in pieces, unpacked as they come, then made into a new project with
new ids and its files moved into place; a damaged or foreign archive refused, its staging folder removed"""

import io
import json
import os
import tarfile
from unittest import mock

import pytest

from django.conf import settings

from dji_thermal_ui.analyzer import restore
from dji_thermal_ui.analyzer.models import Finding, Project, ThermalConversion, ThermalDataset, ThermalMeasurement
from tests.fakes import converted, dataset, server_folder

PROJECTS = "/api/projects"
IMPORTS = "/api/imports"


def exported(api, project_id, **params):
    res = api.get("{}/{}/export.tar".format(PROJECTS, project_id), params)
    assert res.status_code == 200, getattr(res, 'data', None)
    return b''.join(res.streaming_content)


def start(api, data):
    res = api.post(IMPORTS, {'size': len(data)}, format='json')
    assert res.status_code == 201, res.data
    return res.data['id']


def put(api, import_id, data, offset):
    return api.put("{}/{}?offset={}".format(IMPORTS, import_id, offset), data,
                   content_type='application/octet-stream')


def send(api, data, piece=1000):
    """The archive sent in pieces: the import's id and the last response"""
    import_id = start(api, data)
    for offset in range(0, len(data), piece):
        res = put(api, import_id, data[offset:offset + piece], offset)
        assert res.status_code == 200, res.data
    return import_id, res


def staged():
    folder = restore.imports_dir()
    return sorted(os.listdir(folder)) if os.path.isdir(folder) else []


@pytest.fixture(autouse=True)
def no_imports():
    yield
    for i in list(restore.IMPORTS.values()):
        restore.discard(i)
    restore.clear_imports()


def same_files(new, old):
    """A flight's images and its conversions' outputs the same as another's"""
    assert tree(new.images_dir()) == tree(old.images_dir())
    for a, b in zip(new.conversions.order_by('created_at', 'id'), old.conversions.order_by('created_at', 'id')):
        assert tree(a.data_dir()) == tree(b.data_dir()) != {}


def flight(api):
    """A flight converted, with a measurement, a finding, and a mosaic report leaving one out and hiding the other"""
    c, _make = converted(api)
    m = ThermalMeasurement.objects.create(conversion=c, name="Joint", target='as_converted',
                                          geometry={'type': 'Point', 'coordinates': [0, 0]})
    f = Finding.objects.create(dataset=c.dataset, conversion=c, name="Hot joint",
                               geometry={'type': 'Point', 'coordinates': [0, 0]})
    c.report = {'title': "Roof survey", 'left_out': [m.id], 'view': {'tab': 'as_converted', 'hidden': [f.id]}}
    c.save(update_fields=['report'])
    return c


def tree(root):
    out = {}
    for dirpath, _dirs, files in os.walk(root):
        for name in files:
            p = os.path.join(dirpath, name)
            with open(p, 'rb') as f:
                out[os.path.relpath(p, root)] = f.read()
    return out


def test_an_exported_project_comes_back_as_a_new_project_with_new_ids_and_its_files(api):
    c = flight(api)
    old = Project.objects.get(pk=c.dataset.project_id)
    data = exported(api, old.id)
    import_id, res = send(api, data)
    assert res.data['received'] == len(data)
    assert res.data['project']['name'] == old.name and res.data['project']['proposed'] == old.name + " (2)"
    assert res.data['project']['flights'] == [{'name': "Roof", 'file_count': 2, 'conversions': 1}]

    res = api.post("{}/{}".format(IMPORTS, import_id), {'name': old.name + " (2)"}, format='json')
    assert res.status_code == 201, res.data
    new = Project.objects.get(pk=res.data['id'])
    assert new.name == old.name + " (2)" and res.data['dataset_count'] == 1
    d = new.datasets.get()
    assert d.id != c.dataset_id and (d.name, d.source, d.status) == ("Roof", 'upload', c.dataset.status)
    assert d.analysis == c.dataset.analysis and d.created_at == c.dataset.created_at
    conv = d.conversions.get()
    assert conv.id != c.id and (conv.name, conv.options, conv.mosaics, conv.results) == (c.name, c.options, c.mosaics, c.results)
    m = conv.measurements.get()
    f = d.findings.get()
    assert (m.name, f.name, f.conversion_id) == ("Joint", "Hot joint", conv.id)
    assert conv.report == {'title': "Roof survey", 'left_out': [m.id], 'view': {'tab': 'as_converted', 'hidden': [f.id]}}
    same_files(d, c.dataset)
    assert (d.file_count, conv.file_count) == (c.dataset.file_count, c.file_count) and conv.size > 0
    assert staged() == [] and ThermalDataset.objects.count() == 2


def test_the_project_is_known_as_soon_as_its_manifest_is_received(api):
    c = flight(api)
    data = exported(api, c.dataset.project_id)
    import_id = start(api, data)
    res = put(api, import_id, data[:512], 0)
    assert res.data == {'received': 512, 'project': None}
    res = put(api, import_id, data[512:200000], 512)
    assert res.data['project']['name'] == Project.objects.get().name
    assert res.data['project']['proposed'] == Project.objects.get().name + " (2)"


def test_a_piece_sent_again_is_read_from_where_the_last_stopped_and_a_gap_is_refused(api):
    c = flight(api)
    data = exported(api, c.dataset.project_id)
    import_id = start(api, data)
    assert put(api, import_id, data[:3000], 0).data['received'] == 3000
    assert put(api, import_id, data[1000:5000], 1000).data['received'] == 5000
    res = put(api, import_id, data[6000:7000], 6000)
    assert (res.status_code, res.data['received']) == (409, 5000)
    for offset in range(5000, len(data), 4000):
        assert put(api, import_id, data[offset:offset + 4000], offset).status_code == 200
    res = api.post("{}/{}".format(IMPORTS, import_id), {'name': "Again"}, format='json')
    assert res.status_code == 201, res.data
    same_files(Project.objects.get(name="Again").datasets.get(), c.dataset)


def test_a_name_in_use_is_refused_and_the_import_waits_for_another(api):
    c = flight(api)
    name = Project.objects.get().name
    import_id, _res = send(api, exported(api, c.dataset.project_id))
    res = api.post("{}/{}".format(IMPORTS, import_id), {'name': name}, format='json')
    assert res.status_code == 400 and 'name' in res.data
    assert api.post("{}/{}".format(IMPORTS, import_id), {'name': " "}, format='json').status_code == 400
    assert api.post("{}/{}".format(IMPORTS, import_id), {'name': "Roof, restored"}, format='json').status_code == 201
    assert sorted(Project.objects.values_list('name', flat=True)) == sorted([name, "Roof, restored"])


def test_a_name_taken_gets_the_next_number_free(api):
    Project.objects.create(name="Roof")
    Project.objects.create(name="Roof (2)")
    assert restore.free_name("Roof") == "Roof (3)"
    assert restore.free_name("Roof (2)") == "Roof (3)"
    assert restore.free_name("Barn") == "Barn"


def test_an_archive_not_all_received_is_not_imported(api):
    c = flight(api)
    data = exported(api, c.dataset.project_id)
    import_id = start(api, data)
    put(api, import_id, data[:len(data) // 2], 0)
    res = api.post("{}/{}".format(IMPORTS, import_id), {'name': "Half"}, format='json')
    assert res.status_code == 400 and not Project.objects.filter(name="Half").exists()
    assert put(api, import_id, data[len(data) // 2:], len(data) // 2).status_code == 200
    assert api.post("{}/{}".format(IMPORTS, import_id), {'name': "Half"}, format='json').status_code == 201


def test_running_jobs_come_in_canceled_and_a_folder_flight_comes_in_uploaded(api, tmp_path):
    c = flight(api)
    ThermalDataset.objects.filter(pk=c.dataset_id).update(status='analyzing', run_id="a")
    ThermalConversion.objects.filter(pk=c.id).update(status='converting', mosaic_status='building', run_id="b")
    root = server_folder(tmp_path / "flight", ('DJI_0001_T.JPG', 'notes.txt'))
    folder = dataset(name="Wall", source='folder', folder=root, project_id=c.dataset.project_id)
    with mock.patch('dji_thermal_ui.analyzer.backup.busy', return_value=False):
        data = exported(api, c.dataset.project_id)
    import_id, _res = send(api, data, piece=50000)
    new = Project.objects.get(pk=api.post("{}/{}".format(IMPORTS, import_id), {'name': "Copy"}, format='json').data['id'])
    roof, wall = new.datasets.get(name="Roof"), new.datasets.get(name="Wall")
    assert (roof.status, roof.run_id) == ('canceled', "")
    conv = roof.conversions.get()
    assert (conv.status, conv.mosaic_status, conv.run_id) == ('canceled', 'canceled', "")
    assert (wall.source, wall.folder, wall.file_count) == ('upload', "", 1)
    assert os.listdir(wall.images_dir()) == ['DJI_0001_T.JPG']
    assert folder.folder == root and os.path.isfile(os.path.join(root, 'notes.txt'))


def test_webodms_orthophoto_and_dsm_come_in_kept_but_not_their_tasks(api):
    c = flight(api)
    shown = {'raster': "webodm/orthophoto-3.tif", 'task': 3, 'task_name': "Roof - C1", 'unit': 'C'}
    dsm = {'raster': "webodm/dsm-3.tif", 'task': 3, 'task_name': "Roof - C1", 'use': False, 'height_cell': 24}
    ThermalConversion.objects.filter(pk=c.id).update(orthophoto=shown, dsm=dsm)
    import_id, _res = send(api, exported(api, c.dataset.project_id), piece=50000)
    new = Project.objects.get(pk=api.post("{}/{}".format(IMPORTS, import_id), {'name': "Copy"}, format='json').data['id'])
    conv = new.datasets.get().conversions.get()
    assert conv.orthophoto == dict(shown, task=None) and conv.dsm == dict(dsm, task=None)


def test_a_project_without_flights_is_imported_too(api):
    p = Project.objects.create(name="Empty", description="Nothing yet", location_lon=1.5, location_lat=2.5)
    import_id, _res = send(api, exported(api, p.id))
    res = api.post("{}/{}".format(IMPORTS, import_id), {'name': "Empty (2)"}, format='json')
    assert res.status_code == 201
    assert (res.data['description'], res.data['location']['lon'], res.data['dataset_count']) == ("Nothing yet", 1.5, 0)


def test_an_archive_repacked_with_long_names_by_another_tar_is_read_too(api):
    c, _make = converted(api, names=['{}/DJI_0001_T.JPG'.format('a' * 120), '{}/DJI_0002_T.JPG'.format('b' * 120)])
    src = tarfile.open(fileobj=io.BytesIO(exported(api, c.dataset.project_id)))
    for fmt in (tarfile.GNU_FORMAT, tarfile.PAX_FORMAT):
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode='w', format=fmt) as out:
            for member in src.getmembers():
                out.addfile(member, src.extractfile(member))
        import_id, _res = send(api, buf.getvalue(), piece=777)
        res = api.post("{}/{}".format(IMPORTS, import_id), {'name': "Long {}".format(fmt)}, format='json')
        assert res.status_code == 201, res.data
        same_files(Project.objects.get(name="Long {}".format(fmt)).datasets.get(), c.dataset)


def tar_of(*members):
    """A tar of (name, bytes, type) members"""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode='w', format=tarfile.PAX_FORMAT) as out:
        for name, data, kind in members:
            info = tarfile.TarInfo(name)
            info.type = kind
            info.size = len(data) if kind == tarfile.REGTYPE else 0
            if kind == tarfile.SYMTYPE:
                info.linkname = '/etc/passwd'
            out.addfile(info, io.BytesIO(data) if kind == tarfile.REGTYPE else None)
    return buf.getvalue()


def manifest(**over):
    m = {'format': 'dji-thermal-ui project', 'version': 1, 'app': '0.7.0', 'project': {'id': 3, 'name': "Farm"},
         'flights': [{'id': 7, 'name': "Barn", 'conversions': [{'id': 9, 'measurements': []}], 'findings': []}]}
    m.update(over)
    return ('manifest.json', json.dumps(m).encode(), tarfile.REGTYPE)


def test_an_archive_that_is_damaged_or_not_a_project_s_is_refused_and_its_folder_removed(api):
    refused = {
        b'x' * 5000: "not a tar archive",
        tar_of(('notes.txt', b'hi', tarfile.REGTYPE)): "does not start with its manifest",
        tar_of(('manifest.json', b'{nope', tarfile.REGTYPE)): "manifest is damaged",
        tar_of(manifest(format='zip')): "not a project exported",
        tar_of(manifest(version=3, app='9.0.0')): "newer dji-thermal-ui (9.0.0)",
        tar_of(manifest(flights=[{'name': "No id"}])): "manifest is damaged",
        tar_of(manifest(), ('datasets/8/images/a.JPG', b'x', tarfile.REGTYPE)): "not its flights'",
        tar_of(manifest(), ('datasets/7/conversions/10/a.tif', b'x', tarfile.REGTYPE)): "not its flights'",
        tar_of(manifest(), ('datasets/7/images/../../../evil.JPG', b'x', tarfile.REGTYPE)): "not its flights'",
        tar_of(manifest(), ('/etc/evil', b'x', tarfile.REGTYPE)): "not its flights'",
        tar_of(manifest(), ('datasets/7/images/a.JPG', b'', tarfile.SYMTYPE)): "a link",
    }
    for data, why in refused.items():
        import_id = start(api, data)
        res = put(api, import_id, data, 0)
        assert res.status_code == 400 and why in res.data['error'], (why, res.data)
        assert staged() == [] and put(api, import_id, data, 0).status_code == 404
    assert not os.path.exists(os.path.join(settings.DATA_DIR, 'evil.JPG'))
    assert not Project.objects.exclude(name="Default Project").exists()


def test_an_archive_is_refused_when_its_rows_do_not_fit(api):
    data = tar_of(manifest(flights=[{'id': 7, 'name': "Barn", 'status': 'flying'}]))
    import_id, _res = send(api, data)
    res = api.post("{}/{}".format(IMPORTS, import_id), {'name': "Farm"}, format='json')
    assert res.status_code == 400 and "damaged" in res.data['error']
    assert not Project.objects.filter(name="Farm").exists() and ThermalDataset.objects.count() == 0 and staged() == []


def test_an_archive_too_large_for_the_data_folder_or_of_no_size_is_refused(api):
    with mock.patch('shutil.disk_usage', return_value=mock.Mock(free=10 ** 9)):
        res = api.post(IMPORTS, {'size': 3 * 10 ** 9}, format='json')
    assert res.status_code == 400 and res.data['error'] == "The data folder has 1.0 GB free, the archive needs 3.0 GB"
    assert api.post(IMPORTS, {'size': 0}, format='json').status_code == 400
    assert api.post(IMPORTS, {}, format='json').status_code == 400


def test_an_import_stopped_is_removed_and_an_unknown_one_is_not_found(api):
    data = tar_of(manifest())
    import_id = start(api, data)
    put(api, import_id, data[:1000], 0)
    assert staged() == [import_id]
    assert api.delete("{}/{}".format(IMPORTS, import_id)).status_code == 204
    assert staged() == []
    assert put(api, import_id, data, 0).status_code == 404
    assert api.post("{}/{}".format(IMPORTS, import_id), {'name': "X"}, format='json').status_code == 404


def test_imports_left_by_a_closed_server_are_cleared(api):
    start(api, tar_of(manifest()))
    restore.clear_imports()
    assert staged() == []
