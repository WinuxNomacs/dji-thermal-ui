"""Projects through the API: the Default Project, made whenever there is none; making, changing and deleting a project
(its datasets with it); a dataset made in a project or moved to another; and the migration that put the datasets made
before projects into the Default Project"""

import os

import pytest
from django.db import connection
from django.db.migrations.executor import MigrationExecutor

from dji_thermal_ui.analyzer import thermal_analysis
from dji_thermal_ui.analyzer.models import Project, ThermalConversion, ThermalDataset, ThermalMeasurement
from tests.fakes import CONVERSIONS, DATASETS, dataset, server_folder

PROJECTS = "/api/projects"


def test_the_default_project_is_made_when_there_is_none(api):
    # The migrations made one: gone, as after deleting the last project outside the API
    Project.objects.all().delete()
    listed = api.get(PROJECTS).data['projects']
    assert [p['name'] for p in listed] == ["Default Project"]
    assert listed[0]['location'] is None and listed[0]['dataset_count'] == 0
    # Listing again makes no other
    assert len(api.get(PROJECTS).data['projects']) == 1
    # A dataset made without a project goes into the first
    assert dataset().project_id == listed[0]['id']


def test_a_project_is_made_changed_and_listed_oldest_first(api):
    default = Project.default()
    res = api.post(PROJECTS, {'name': "  Silos  ", 'description': "North farm\n",
                              'location': {'lon': -88.07, 'lat': 42.1, 'label': " 1 Farm Rd "}}, format='json')
    assert res.status_code == 201
    p = res.data
    assert (p['name'], p['description']) == ("Silos", "North farm")
    assert p['location'] == {'lon': -88.07, 'lat': 42.1, 'label': "1 Farm Rd"}
    assert [x['name'] for x in api.get(PROJECTS).data['projects']] == [default.name, "Silos"]

    # Renamed, alone: the rest is kept
    res = api.patch("{}/{}".format(PROJECTS, p['id']), {'name': "Grain silos"}, format='json')
    assert (res.data['name'], res.data['description'], res.data['location']['label']) == \
        ("Grain silos", "North farm", "1 Farm Rd")
    # The location cleared
    res = api.patch("{}/{}".format(PROJECTS, p['id']), {'location': None}, format='json')
    assert res.data['location'] is None and res.data['name'] == "Grain silos"
    # The Default Project is an ordinary project: renamed and described
    res = api.patch("{}/{}".format(PROJECTS, default.id), {'name': "Home", 'description': "Barns"}, format='json')
    assert (res.data['name'], res.data['description']) == ("Home", "Barns")
    assert api.get("{}/99999".format(PROJECTS)).status_code == 404


@pytest.mark.parametrize("data, field, message", [
    ({}, 'name', "A name is required"),
    ({'name': "  "}, 'name', "A name is required"),
    ({'name': "P", 'description': 5}, 'description', "A description is text"),
    ({'name': "P", 'description': "x" * 10001}, 'description', "That is longer than 10000 characters"),
    ({'name': "P", 'location': "here"}, 'location', "A location is a point (lon, lat) with its label"),
    ({'name': "P", 'location': {'lon': "x", 'lat': 1}}, 'location', "A location is a point (lon, lat) with its label"),
    ({'name': "P", 'location': {'lon': 181, 'lat': 1}}, 'location',
     "That point is not on the Earth (lon -180 to 180, lat -90 to 90)"),
    ({'name': "P", 'location': {'lon': 1, 'lat': "nan"}}, 'location',
     "That point is not on the Earth (lon -180 to 180, lat -90 to 90)"),
])
def test_a_project_without_a_name_or_with_a_bad_description_or_location_is_refused(api, data, field, message):
    res = api.post(PROJECTS, data, format='json')
    assert (res.status_code, str(res.data[field])) == (400, message)
    assert not Project.objects.filter(name="P").exists()


def test_a_project_says_what_its_datasets_hold_and_the_space_they_take(api, tmp_path):
    p = Project.objects.create(name="Silos")
    uploaded = dataset(project=p, size=2.0)
    folder = dataset(project=p, source='folder', folder=server_folder(tmp_path), size=100.0)
    c = ThermalConversion.objects.create(dataset=folder, name="C", options={}, size=1.5, mosaic_status='ready')
    ThermalConversion.objects.create(dataset=uploaded, name="D", options={}, size=0.5)
    ThermalMeasurement.objects.create(conversion=c, name="Spot", target='harmonized',
                                      geometry={'type': 'Point', 'coordinates': [0, 0]})
    dataset(name="Elsewhere", size=50.0)
    s = api.get("{}/{}".format(PROJECTS, p.id)).data
    assert (s['dataset_count'], s['conversion_count'], s['mosaic_count'], s['measurement_count']) == (2, 2, 1, 1)
    # The uploads and the outputs: a folder dataset's images stay where they are
    assert s['size'] == 4 * 1024 * 1024


def test_a_project_shows_where_each_of_its_datasets_was_flown(api):
    p = Project.objects.create(name="Silos")
    rows = [{'kind': 'thermal', 'lon': lon, 'lat': lat} for lon, lat in
            [(0, 0), (1, 0), (1, 1), (0, 1), (0.5, 0.5), (0.2, 0.8)]]
    flown = dataset(project=p, name="Flown", analysis={'files': rows + [{'kind': 'not_thermal', 'lon': 9, 'lat': 9}]})
    dataset(project=p, name="Not analyzed")
    areas = api.get("{}/{}".format(PROJECTS, p.id)).data['areas']
    assert areas == [{'dataset': flown.id, 'name': "Flown",
                      'ring': [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]}]


def test_a_flight_area_needs_three_positions_apart():
    def area(points):
        return thermal_analysis.flight_area({'files': [{'kind': 'thermal', 'lon': x, 'lat': y} for x, y in points]})
    assert area([(0, 0), (1, 1)]) is None
    assert area([(0, 0), (1, 1), (2, 2)]) is None          # in a line
    assert area([(0, 0), (0, 0), (1, 0), (0, 1)]) == [[0, 0], [1, 0], [0, 1], [0, 0]]
    assert thermal_analysis.flight_area(None) is None


def test_deleting_a_project_deletes_its_datasets_and_their_folders(api, tmp_path):
    keep = Project.default()
    p = Project.objects.create(name="Silos")
    uploaded = dataset(project=p)
    os.makedirs(uploaded.images_dir())
    images = server_folder(tmp_path / "flight")
    folder = dataset(project=p, source='folder', folder=images)
    c = ThermalConversion.objects.create(dataset=folder, name="C", options={})
    os.makedirs(c.data_dir())
    other = dataset(project=keep)

    assert api.delete("{}/{}".format(PROJECTS, p.id)).status_code == 204
    assert not Project.objects.filter(pk=p.id).exists()
    assert list(ThermalDataset.objects.all()) == [other]
    assert not ThermalConversion.objects.exists()
    assert not os.path.exists(uploaded.data_dir()) and not os.path.exists(folder.data_dir())
    # A folder dataset's own images are the user's: kept
    assert os.path.isfile(os.path.join(images, 'DJI_0001_T.JPG'))


def test_deleting_the_last_project_makes_the_default_project_again(api):
    only = Project.default()
    only.name = "Renamed"
    only.save()
    dataset(project=only)
    assert api.delete("{}/{}".format(PROJECTS, only.id)).status_code == 204
    assert [p.name for p in Project.objects.all()] == ["Default Project"]
    assert not ThermalDataset.objects.exists()


def test_a_dataset_is_made_in_a_project_listed_with_it_and_moved(api, tmp_path):
    default = Project.default()
    p = Project.objects.create(name="Silos")
    res = api.post(DATASETS, {'name': "Roof", 'project': p.id}, format='json')
    assert res.status_code == 201 and res.data['project'] == p.id and res.data['project_name'] == "Silos"
    roof = res.data['id']
    other = api.post(DATASETS, {'name': "Field"}, format='json').data
    assert other['project'] == default.id

    def listed(project):
        return [d['name'] for d in api.get(DATASETS, {'project': project}).data['datasets']]
    assert listed(p.id) == ["Roof"] and listed(default.id) == ["Field"]
    assert len(api.get(DATASETS).data['datasets']) == 2
    assert api.get(DATASETS, {'project': 99999}).status_code == 404

    # Moved, keeping its name; then renamed, keeping its project
    res = api.patch("{}/{}".format(DATASETS, roof), {'project': default.id}, format='json')
    assert (res.status_code, res.data['project'], res.data['name']) == (200, default.id, "Roof")
    res = api.patch("{}/{}".format(DATASETS, roof), {'name': "Roof 2"}, format='json')
    assert (res.data['project'], res.data['name']) == (default.id, "Roof 2")

    for bad in (99999, "x", None):
        res = api.patch("{}/{}".format(DATASETS, roof), {'project': bad}, format='json')
        assert (res.status_code, str(res.data['project'])) == (400, "That project does not exist")
        res = api.post(DATASETS, {'name': "New", 'project': bad if bad is not None else "y"}, format='json')
        assert (res.status_code, str(res.data['project'])) == (400, "That project does not exist")
    assert ThermalDataset.objects.get(pk=roof).project_id == default.id


def test_compare_offers_the_projects_conversions_first(api):
    from dji_thermal_ui.analyzer import api as analyzer_api
    a = Project.objects.create(name="A")
    b = Project.objects.create(name="B")
    kinds = {'mosaics': {'kinds': {'as_converted': {'files': ['m.tif']}}}}
    in_a = ThermalConversion.objects.create(dataset=dataset(project=a, name="A1"), name="C", options={}, **kinds)
    in_b = ThermalConversion.objects.create(dataset=dataset(project=b, name="B1"), name="C", options={}, **kinds)
    listed = analyzer_api.comparable(in_b)
    assert [(c['id'], c['project_name']) for c in listed] == [(in_b.id, "B"), (in_a.id, "A")]
    assert [c['id'] for c in analyzer_api.comparable(in_a)] == [in_a.id, in_b.id]
    assert api.get("{}/{}/comparable".format(CONVERSIONS, in_b.id)).data[0]['project'] == b.id


@pytest.mark.django_db(transaction=True)
def test_the_migration_puts_the_datasets_made_before_projects_into_the_default_project():
    executor = MigrationExecutor(connection)
    executor.migrate([('analyzer', '0002_newest_first_by_id')])
    old = executor.loader.project_state([('analyzer', '0002_newest_first_by_id')]).apps
    OldDataset = old.get_model('analyzer', 'ThermalDataset')
    ids = [OldDataset.objects.create(name=n).id for n in ("Roof", "Field")]

    executor = MigrationExecutor(connection)
    executor.migrate(executor.loader.graph.leaf_nodes())
    assert [p.name for p in Project.objects.all()] == ["Default Project"]
    project = Project.objects.get()
    assert sorted(ThermalDataset.objects.filter(project=project).values_list('id', flat=True)) == sorted(ids)
