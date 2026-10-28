"""A project's export: a tar of its manifest and its flights' files (all, or those chosen), streamed with its length
known, and what each flight adds to it"""

import io
import json
import tarfile

from dji_thermal_ui.analyzer.models import Finding, Project, ThermalConversion, ThermalDataset, ThermalMeasurement
from tests.fakes import converted, dataset, server_folder

PROJECTS = "/api/projects"


def archive(res):
    assert res.status_code == 200, getattr(res, 'data', None)
    data = b''.join(res.streaming_content)
    assert int(res['Content-Length']) == len(data)
    return tarfile.open(fileobj=io.BytesIO(data))


def manifest(tar):
    return json.load(tar.extractfile('manifest.json'))


def flight(api):
    """A flight converted, with a measurement and a finding"""
    c, _make = converted(api)
    ThermalMeasurement.objects.create(conversion=c, name="Joint", geometry={'type': 'Point', 'coordinates': [0, 0]})
    Finding.objects.create(dataset=c.dataset, conversion=c, name="Hot joint",
                           geometry={'type': 'Point', 'coordinates': [0, 0]})
    return c


def test_a_project_is_exported_as_a_tar_of_its_manifest_then_its_flights_images_and_outputs(api):
    c = flight(api)
    project = Project.objects.get(pk=c.dataset.project_id)
    res = api.get("{}/{}/export.tar".format(PROJECTS, project.id))
    assert res['Content-Type'] == 'application/x-tar'
    assert res['Content-Disposition'] == 'attachment; filename={}.tar'.format(project.name.replace(' ', '_'))
    tar = archive(res)
    names = tar.getnames()
    assert names[0] == 'manifest.json'
    base = 'datasets/{}/'.format(c.dataset_id)
    assert [n for n in names if n.startswith(base + 'images/')] == [
        base + 'images/100MEDIA/DJI_0001_T.JPG', base + 'images/100MEDIA/DJI_0002_T.JPG']
    outputs = sorted(n[len(base + 'conversions/{}/'.format(c.id)):] for n in names if '/conversions/' in n)
    assert outputs and 'mosaics/as_converted/mosaic_temp_c.tif' in outputs
    with open(c.data_dir() + '/mosaics/as_converted/mosaic_temp_c.tif', 'rb') as f:
        assert tar.extractfile(base + 'conversions/{}/mosaics/as_converted/mosaic_temp_c.tif'.format(c.id)).read() == f.read()

    m = manifest(tar)
    assert (m['format'], m['version']) == ('dji-thermal-ui project', 1)
    assert (m['project']['id'], m['project']['name']) == (project.id, project.name)
    [f] = m['flights']
    assert (f['id'], f['name'], f['project_id'], f['source']) == (c.dataset_id, "Roof", project.id, 'upload')
    [conv] = f['conversions']
    assert (conv['id'], conv['dataset_id'], conv['mosaics']) == (c.id, c.dataset_id, c.mosaics)
    assert [x['name'] for x in conv['measurements']] == ["Joint"]
    assert [(x['name'], x['conversion_id']) for x in f['findings']] == [("Hot joint", c.id)]


def test_only_the_flights_chosen_are_exported_and_none_leaves_the_project_alone(api):
    c = flight(api)
    other = dataset(name="Wall", project_id=c.dataset.project_id)
    url = "{}/{}/export.tar".format(PROJECTS, c.dataset.project_id)
    tar = archive(api.get(url, {'flights': str(other.id)}))
    assert [f['name'] for f in manifest(tar)['flights']] == ["Wall"]
    assert not [n for n in tar.getnames() if n.startswith('datasets/{}/'.format(c.dataset_id))]
    tar = archive(api.get(url, {'flights': ''}))
    assert tar.getnames() == ['manifest.json'] and manifest(tar)['flights'] == []
    assert len(manifest(archive(api.get(url)))['flights']) == 2


def test_flights_not_in_the_project_or_not_ids_are_refused(api):
    c = flight(api)
    elsewhere = dataset(name="Barn", project=Project.objects.create(name="Farm"))
    url = "{}/{}/export.tar".format(PROJECTS, c.dataset.project_id)
    assert api.get(url, {'flights': str(elsewhere.id)}).status_code == 400
    assert api.get(url, {'flights': 'one'}).status_code == 400
    assert api.get("{}/999/export.tar".format(PROJECTS)).status_code == 404
    assert api.get("{}/999/export".format(PROJECTS)).status_code == 404


def test_a_folder_flight_s_images_are_copied_from_its_folder_without_the_other_files(api, tmp_path):
    root = server_folder(tmp_path / "flight", ('DJI_0001_T.JPG', 'sub/DJI_0002_T.jpg', 'notes.txt'))
    d = dataset(source='folder', folder=root)
    tar = archive(api.get("{}/{}/export.tar".format(PROJECTS, d.project_id)))
    base = 'datasets/{}/images/'.format(d.id)
    assert [n for n in tar.getnames() if n != 'manifest.json'] == [base + 'DJI_0001_T.JPG', base + 'sub/DJI_0002_T.jpg']
    assert tar.extractfile(base + 'DJI_0001_T.JPG').read() == (tmp_path / "flight" / 'DJI_0001_T.JPG').read_bytes()
    assert manifest(tar)['flights'][0]['folder'] == root


def test_each_flight_s_size_is_what_it_adds_to_the_archive(api):
    c = flight(api)
    empty = dataset(name="Wall", project_id=c.dataset.project_id)
    res = api.get("{}/{}/export".format(PROJECTS, c.dataset.project_id))
    assert res.status_code == 200
    sizes = {f['id']: f for f in res.data['flights']}
    assert sizes[empty.id] == {'id': empty.id, 'name': "Wall", 'busy': False, 'bytes': 0}
    tar = archive(api.get("{}/{}/export.tar".format(PROJECTS, c.dataset.project_id)))
    added = sum(m.offset_data - m.offset + -(-m.size // 512) * 512 for m in tar.getmembers() if m.name != 'manifest.json')
    assert sizes[c.dataset_id]['bytes'] == added > 0


def test_a_flight_still_analyzed_or_converted_is_not_offered_and_not_exported(api):
    c = flight(api)
    project = c.dataset.project_id
    for busy in [lambda: ThermalDataset.objects.filter(pk=c.dataset_id).update(status='analyzing'),
                 lambda: ThermalConversion.objects.filter(pk=c.id).update(status='converting'),
                 lambda: ThermalConversion.objects.filter(pk=c.id).update(mosaic_status='building')]:
        busy()
        [f] = api.get("{}/{}/export".format(PROJECTS, project)).data['flights']
        assert (f['busy'], f['bytes']) == (True, None)
        res = api.get("{}/{}/export.tar".format(PROJECTS, project))
        assert res.status_code == 409 and "Roof" in res.data['flights'][0]
        ThermalDataset.objects.filter(pk=c.dataset_id).update(status='ready')
        ThermalConversion.objects.filter(pk=c.id).update(status='ready', mosaic_status='ready')
    assert archive(api.get("{}/{}/export.tar".format(PROJECTS, project), {'flights': ''})).getnames() == ['manifest.json']
