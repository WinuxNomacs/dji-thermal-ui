"""The Storage page's measurement: the data folder's size on disk now, the database, each project's flights, files
left behind and anything else, with a folder flight's images measured where it reads them"""

from dji_thermal_ui.analyzer import storage
from dji_thermal_ui.analyzer.models import Project
from tests.fakes import dataset, server_folder


def write(path, size):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"x" * size)


def test_the_data_folder_is_measured_by_project_and_flight_the_database_and_the_rest_apart(api, settings, tmp_path):
    settings.DATA_DIR = tmp_path
    roof = Project.objects.create(name="Roof")
    east, west = dataset(name="East", project=roof), dataset(name="West", project=roof)
    write(tmp_path / "db.sqlite3", 1000)
    write(tmp_path / "db.sqlite3-wal", 200)
    write(tmp_path / "secret_key", 50)
    write(tmp_path / "datasets" / str(east.id) / "images" / "a_T.JPG", 300)
    write(tmp_path / "datasets" / str(east.id) / "conversions" / "1" / "a_temp_c.tiff", 400)
    write(tmp_path / "datasets" / str(west.id) / "images" / "b_T.JPG", 70)
    write(tmp_path / "datasets" / "999" / "images" / "gone_T.JPG", 25)           # a flight no longer there
    write(tmp_path / "imports" / "abc" / "manifest.json", 5)                    # an import under way

    res = api.get("/api/storage")
    assert res.status_code == 200
    m = res.data
    assert m['path'] == str(tmp_path)
    assert (m['database'], m['other'], m['left_behind']) == (1200, 55, 25)
    assert m['total'] == 1200 + 55 + 700 + 70 + 25
    assert m['free'] > 0
    project = next(p for p in m['projects'] if p['id'] == roof.id)
    assert project == {'id': roof.id, 'name': "Roof", 'size': 770, 'flights': [
        {'id': east.id, 'name': "East", 'size': 700, 'files': 2, 'in_place': None},
        {'id': west.id, 'name': "West", 'size': 70, 'files': 1, 'in_place': None}]}
    # The default project, without flights, is listed too
    assert any(p['size'] == 0 and p['flights'] == [] for p in m['projects'] if p['id'] != roof.id)


def test_a_folder_flights_images_are_measured_where_it_reads_them_not_in_the_data_folder(api, settings, tmp_path):
    settings.DATA_DIR = tmp_path / "data"
    (tmp_path / "data").mkdir()
    folder = server_folder(tmp_path / "flight", files=('DJI_0001_T.JPG', 'DJI_0002_T.JPG'))
    d = dataset(name="Read in place", source='folder', folder=folder)
    write(tmp_path / "data" / "datasets" / str(d.id) / "conversions" / "1" / "a_temp_c.tiff", 90)
    gone = dataset(name="Folder gone", source='folder', folder=str(tmp_path / "nowhere"))

    flights = {f['id']: f for p in api.get("/api/storage").data['projects'] for f in p['flights']}
    assert flights[d.id]['size'] == 90
    assert flights[d.id]['in_place'] == (tmp_path / "flight" / "DJI_0001_T.JPG").stat().st_size * 2
    assert flights[gone.id]['in_place'] is None and flights[gone.id]['size'] == 0


def test_the_measurement_is_taken_again_each_time(api, settings, tmp_path):
    settings.DATA_DIR = tmp_path
    write(tmp_path / "db.sqlite3", 10)
    assert storage.measure()['total'] == 10
    write(tmp_path / "datasets" / "1" / "x", 5)
    assert storage.measure()['total'] == 15


def test_the_storage_page_is_served(client, db):
    res = client.get("/settings/storage")
    assert res.status_code == 200
    assert "<title>Storage · Thermal Analyzer</title>" in res.content.decode()
