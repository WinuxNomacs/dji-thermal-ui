"""Moving the data folder from the Storage page: the target checked, the files moved by the command before it opens
the database (what the target held set aside), the projects chosen from it imported, and the server restarted"""

import hashlib
import json
import os
import shutil
import sqlite3
import sys
from pathlib import Path

import pytest
from django.db import connection, connections

from dji_thermal_ui import cli, datadir, move
from dji_thermal_ui.analyzer import storage
from dji_thermal_ui.analyzer.models import Project, ThermalConversion, ThermalDataset
from tests.fakes import dataset
from tests.test_api_import import flight, tree

STORAGE = "/api/storage"


def write(path, data=b"x"):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return path


def data_folder(path, projects=(), migrations=None):
    """A data folder of this app as it looks on disk: a database naming its projects and flights, a secret key and the
    flights' files (a project: (name, {flight id: bytes of its files}))"""
    write(path / "secret_key", b"key")
    db = sqlite3.connect(path / "db.sqlite3")
    db.executescript("CREATE TABLE analyzer_project (id INTEGER PRIMARY KEY, name TEXT, description TEXT DEFAULT '');"
                     "CREATE TABLE analyzer_thermaldataset (id INTEGER PRIMARY KEY, project_id INTEGER);"
                     "CREATE TABLE django_migrations (app TEXT, name TEXT);")
    for pid, (name, flights) in enumerate(projects, 1):
        db.execute("INSERT INTO analyzer_project (id, name) VALUES (?, ?)", (pid, name))
        for fid, size in flights.items():
            db.execute("INSERT INTO analyzer_thermaldataset VALUES (?, ?)", (fid, pid))
            write(path / "datasets" / str(fid) / "images" / "a_T.JPG", b"x" * size)
    for name in migrations or ["0001_initial"]:
        db.execute("INSERT INTO django_migrations VALUES ('analyzer', ?)", (name,))
    db.commit()
    db.close()
    return path


def current(path):
    """The data folder in use: a database, a secret key and a flight's image"""
    write(path / "db.sqlite3", b"db")
    write(path / "secret_key", b"mine")
    write(path / "datasets" / "1" / "images" / "a_T.JPG", b"jpeg")
    return path


def test_a_new_or_empty_folder_can_take_the_data_folder(tmp_path):
    source = current(tmp_path / "data")
    new = move.inspect(str(tmp_path / "new" / "deeper"), source)
    assert (new['kind'], new['problems'], new['same_drive'], new['needed']) == ('new', [], True, 0)
    assert new['free'] > 0
    (tmp_path / "empty").mkdir()
    assert move.inspect(str(tmp_path / "empty"), source)['kind'] == 'empty'


@pytest.mark.parametrize("target, problem", [
    ("", "full path"), ("relative/folder", "full path"),
    ("{data}", "the data folder"), ("{data}/datasets", "the data folder"),
    ("{tmp}", "data folder is inside"), ("{tmp}/a-file", "a file"), ("{tmp}/other", "other files"),
])
def test_a_folder_that_cannot_take_it_is_refused_with_why(tmp_path, target, problem):
    source = current(tmp_path / "data")
    write(tmp_path / "a-file")
    write(tmp_path / "other" / "notes.txt")
    found = move.inspect(target.format(data=source, tmp=tmp_path), source)
    assert len(found['problems']) == 1 and problem in found['problems'][0]


def test_another_drive_needs_room_for_the_whole_folder(tmp_path, monkeypatch):
    source = current(tmp_path / "data")
    monkeypatch.setattr(move, "drive", lambda p: "usb" if Path(p) == tmp_path else "disk")
    found = move.inspect(str(tmp_path / "new"), source)
    assert found['same_drive'] is False and found['needed'] == len(b"db" + b"mine" + b"jpeg")
    monkeypatch.setattr(move.shutil, "disk_usage", lambda p: shutil._ntuple_diskusage(100, 99, 5))
    assert "not enough room" in move.inspect(str(tmp_path / "new"), source)['problems'][0]


def test_a_data_folder_there_offers_its_projects_with_their_size(tmp_path):
    source = current(tmp_path / "data")
    target = data_folder(tmp_path / "old", [("Roof", {4: 30, 5: 12}), ("Barn", {})])
    found = move.inspect(str(target), source)
    assert found['kind'] == 'data' and found['problems'] == []
    assert found['projects'] == [{'id': 2, 'name': "Barn", 'flights': 0, 'size': 0},
                                 {'id': 1, 'name': "Roof", 'flights': 2, 'size': 42}]


def test_the_empty_default_project_the_app_made_there_is_not_offered(tmp_path):
    from dji_thermal_ui.analyzer.models import DEFAULT_PROJECT_NAME
    assert move.DEFAULT_PROJECT == DEFAULT_PROJECT_NAME
    target = data_folder(tmp_path / "old", [(DEFAULT_PROJECT_NAME, {}), (DEFAULT_PROJECT_NAME, {3: 5}), ("Barn", {})])
    found = move.inspect(str(target), current(tmp_path / "data"))
    assert [(p['id'], p['name']) for p in found['projects']] == [(3, "Barn"), (2, DEFAULT_PROJECT_NAME)]


def test_a_data_folder_of_a_newer_app_or_a_database_unread_is_refused(tmp_path):
    source = current(tmp_path / "data")
    newer = data_folder(tmp_path / "newer", migrations=["0001_initial", "9999_from_the_future"])
    assert "newer dji-thermal-ui" in move.inspect(str(newer), source)['problems'][0]
    write(tmp_path / "broken" / "db.sqlite3", b"not a database")
    assert "could not be read" in move.inspect(str(tmp_path / "broken"), source)['problems'][0]


def test_the_folder_is_moved_and_remembered_and_the_old_one_removed(tmp_path, monkeypatch):
    monkeypatch.delenv(datadir.ENV_VAR)
    source = current(tmp_path / "data")
    write(source / "imports" / "abc" / "part", b"half an import")
    result = move.perform({'from': str(source), 'to': str(tmp_path / "new"), 'projects': []})
    target = tmp_path / "new"
    assert (result['state'], result['replaced'], result['error']) == ('moved', None, None)
    assert tree(target) == {"db.sqlite3": b"db", "secret_key": b"mine", os.path.join("datasets", "1", "images", "a_T.JPG"): b"jpeg"}
    assert not source.exists()
    assert datadir.pointer() == target and datadir.chosen() == (target, 'moved')


def test_moving_to_another_drive_copies_then_removes_the_originals(tmp_path, monkeypatch):
    source = current(tmp_path / "data")
    real = move.inspect
    monkeypatch.setattr(move, "inspect", lambda t, s: dict(real(t, s), same_drive=False))
    assert move.perform({'from': str(source), 'to': str(tmp_path / "new"), 'projects': []})['state'] == 'moved'
    assert tree(tmp_path / "new") == {"db.sqlite3": b"db", "secret_key": b"mine", os.path.join("datasets", "1", "images", "a_T.JPG"): b"jpeg"}
    assert not source.exists()


def test_what_the_target_held_is_set_aside_with_nothing_deleted(tmp_path):
    source = current(tmp_path / "data")
    target = data_folder(tmp_path / "old", [("Roof", {4: 30})])
    write(target / "replaced-2020-01-01" / "db.sqlite3", b"an older one")
    before = tree(target)
    result = move.perform({'from': str(source), 'to': str(target), 'projects': []})
    replaced = Path(result['replaced'])
    assert result['state'] == 'moved' and replaced.parent == target and replaced.name.startswith("replaced-20")
    assert tree(replaced) == {k: v for k, v in before.items() if not k.startswith("replaced-2020")}
    assert (target / "replaced-2020-01-01" / "db.sqlite3").read_bytes() == b"an older one"
    assert (target / "secret_key").read_bytes() == b"mine"


def test_a_move_that_fails_is_undone_and_the_pointer_left_as_it_was(tmp_path, monkeypatch):
    source = current(tmp_path / "data")
    target = data_folder(tmp_path / "old", [("Roof", {4: 30})])
    before_source, before_target = tree(source), tree(target)
    real = Path.rename

    def rename(self, to):
        if self.name == "secret_key" and self.parent == source:
            raise PermissionError(13, "Permission denied")
        return real(self, to)
    monkeypatch.setattr(Path, "rename", rename)
    result = move.perform({'from': str(source), 'to': str(target), 'projects': []})
    assert result['state'] == 'failed' and "Permission denied" in result['error']
    assert (tree(source), tree(target)) == (before_source, before_target)
    assert datadir.pointer() is None


def test_a_move_whose_target_changed_since_it_was_asked_is_not_made(tmp_path):
    source = current(tmp_path / "data")
    write(tmp_path / "new" / "notes.txt")
    result = move.perform({'from': str(source), 'to': str(tmp_path / "new"), 'projects': []})
    assert result['state'] == 'failed' and "other files" in result['error']
    assert (source / "secret_key").exists()


def test_a_moved_data_folder_whose_drive_is_away_is_said_rather_than_made_again(tmp_path, monkeypatch):
    monkeypatch.delenv(datadir.ENV_VAR)
    datadir.set_pointer(tmp_path / "unplugged")
    with pytest.raises(datadir.DataDirError, match="is missing"):
        datadir.data_dir()
    assert not (tmp_path / "unplugged").exists()


def test_moving_back_to_the_default_folder_forgets_the_pointer(tmp_path, monkeypatch):
    monkeypatch.setattr(datadir, "default_dir", lambda: tmp_path / "default")
    datadir.set_pointer(tmp_path / "elsewhere")
    datadir.set_pointer(tmp_path / "default")
    assert datadir.pointer() is None


def test_a_plan_is_taken_once(config_folder):
    move.write_plan("/a", "/b", [3])
    assert move.take_plan()['projects'] == [3]
    assert move.take_plan() is None


@pytest.mark.django_db(transaction=True)
def test_the_projects_chosen_from_a_set_aside_folder_are_imported_with_their_files(api, tmp_path):
    c = flight(api)
    old = Project.objects.get(pk=c.dataset.project_id)
    other = Project.objects.create(name="Not chosen")
    replaced = tmp_path / "replaced-2026-10-28"
    replaced.mkdir()
    db = sqlite3.connect(connection.settings_dict['NAME'])
    db.backup(sqlite3.connect(replaced / "db.sqlite3"))
    db.close()
    files = tree(c.dataset.data_dir())
    shutil.move(c.dataset.data_dir(), replaced / "datasets" / str(c.dataset_id))
    digest = hashlib.sha256((replaced / "db.sqlite3").read_bytes()).hexdigest()

    out = storage.import_replaced(replaced, [old.id])
    assert out == {'imported': [{'name': old.name + " (2)", 'flights': 1}], 'error': None}
    new = Project.objects.get(name=old.name + " (2)")
    d = new.datasets.get()
    assert d.id != c.dataset_id and tree(d.data_dir()) != {}
    assert tree(d.data_dir()).keys() == {k.replace(os.sep + str(c.id) + os.sep, os.sep + str(d.conversions.get().id) + os.sep)
                                         for k in files}
    assert d.conversions.get().measurements.count() == 1 and d.findings.count() == 1
    assert not Project.objects.filter(name="Not chosen (2)").exists() and other.id
    # its files moved out of the folder set aside; its database not touched (a copy was brought up to date)
    assert not (replaced / "datasets" / str(c.dataset_id)).exists()
    assert hashlib.sha256((replaced / "db.sqlite3").read_bytes()).hexdigest() == digest
    assert not hasattr(connections._connections, storage.REPLACED) and not any(Path(connection.settings_dict['NAME']).parent.glob("move-*"))


@pytest.mark.django_db(transaction=True)
def test_an_import_that_fails_leaves_the_set_aside_files_where_they_were(api, tmp_path, monkeypatch):
    c = flight(api)
    replaced = tmp_path / "replaced"
    replaced.mkdir()
    db = sqlite3.connect(connection.settings_dict['NAME'])
    db.backup(sqlite3.connect(replaced / "db.sqlite3"))
    db.close()
    shutil.move(c.dataset.data_dir(), replaced / "datasets" / str(c.dataset_id))
    files = tree(replaced / "datasets")
    monkeypatch.setattr(ThermalConversion, "update_size", lambda self: (_ for _ in ()).throw(OSError("disk gone")))
    out = storage.import_replaced(replaced, [c.dataset.project_id])
    assert out['imported'] == [] and "disk gone" in out['error']
    assert tree(replaced / "datasets") == files
    assert ThermalDataset.objects.count() == 1


@pytest.fixture
def movable(settings, tmp_path):
    """The data folder is one the page may move (not set by --data-dir or the environment)"""
    settings.DATA_DIR = current(tmp_path / "data")
    settings.DATA_DIR_SET_BY = 'default'
    yield settings.DATA_DIR
    move.RESTART.clear()


def test_the_page_is_told_what_chose_the_folder_and_how_the_last_move_went(api, movable):
    res = api.get(STORAGE)
    assert (res.data['set_by'], res.data['last_move']) == ('default', None)
    move.write_json(move.RESULT, {'state': 'moved', 'to': "/new"})
    assert api.get(STORAGE).data['last_move'] == {'state': 'moved', 'to': "/new"}
    assert api.delete(STORAGE + "/move").status_code == 204
    assert api.get(STORAGE).data['last_move'] is None


def test_a_folder_is_checked_before_moving(api, movable, tmp_path):
    res = api.post(STORAGE + "/check", {'path': str(tmp_path / "new")}, format='json')
    assert res.status_code == 200 and (res.data['kind'], res.data['problems']) == ('new', [])
    assert api.post(STORAGE + "/check", {}, format='json').status_code == 400


def test_a_folder_set_by_the_command_or_a_job_running_stops_a_move(api, movable, settings, tmp_path):
    settings.DATA_DIR_SET_BY = 'environment'
    assert "--data-dir" in api.post(STORAGE + "/check", {'path': str(tmp_path / "new")}, format='json').data['problems'][0]
    settings.DATA_DIR_SET_BY = 'default'
    d = dataset(name="Busy")
    ThermalDataset.objects.filter(pk=d.pk).update(status='analyzing')
    res = api.post(STORAGE + "/move", {'path': str(tmp_path / "new")}, format='json')
    assert res.status_code == 409 and "job is running" in res.data['problems'][0]
    assert move.read_json(move.PLAN) is None and not move.RESTART.is_set()


def test_a_move_asked_is_planned_and_the_server_restarted(api, movable, tmp_path):
    target = data_folder(tmp_path / "old", [("Roof", {4: 30}), ("Barn", {})])
    assert api.post(STORAGE + "/move", {'path': str(target), 'projects': [7]}, format='json').status_code == 400
    assert api.post(STORAGE + "/move", {'path': str(target), 'projects': "all"}, format='json').status_code == 400
    res = api.post(STORAGE + "/move", {'path': str(target), 'projects': [1]}, format='json')
    assert res.status_code == 202 and res.data['kind'] == 'data'
    plan = move.read_json(move.PLAN)
    assert (plan['from'], plan['to'], plan['projects']) == (str(movable), str(target), [1])
    assert move.RESTART.is_set()


def test_a_restart_is_only_asked_of_the_server_once_the_answer_is_sent(monkeypatch):
    timers = []
    monkeypatch.setattr(move.threading, "Timer", lambda delay, fn: timers.append((delay, fn)) or
                        type("T", (), {"start": lambda self: None})())
    monkeypatch.setattr(move, "SERVING", True)
    move.request_restart()
    assert timers == [(0.5, move._thread.interrupt_main)]
    move.RESTART.clear()


def test_the_command_restarts_with_the_same_options_and_no_browser(monkeypatch):
    calls = []
    monkeypatch.setattr(cli, "WINDOWS", False)
    monkeypatch.setattr(cli.os, "execv", lambda exe, args: calls.append((exe, args)))
    cli.restart(["--port", "9000"])
    assert calls == [(sys.executable, [sys.executable, "-m", "dji_thermal_ui", "--port", "9000", "--no-browser"])]


def test_on_windows_the_command_restarts_as_a_new_process_that_waits_for_this_one(monkeypatch):
    started = []
    monkeypatch.setattr(cli, "WINDOWS", True)
    monkeypatch.setattr(cli.subprocess, "Popen", lambda args, env: started.append((args, env)))
    assert cli.restart(["--port", "9000", "--no-browser"]) == 0
    (args, env), = started
    assert args == [sys.executable, "-m", "dji_thermal_ui", "--port", "9000", "--no-browser"]
    assert env[cli.RESTARTED_FROM] == str(os.getpid())


def test_the_command_moves_the_data_folder_asked_before_serving_from_it(tmp_path):
    """The command as a user runs it: a move planned by the page is made at start, the projects chosen imported"""
    from tests.test_cli import free_port, run_app, stop
    config, source, target = tmp_path / "config", tmp_path / "data", tmp_path / "old"
    env = {"DJI_THERMAL_UI_CONFIG_DIR": str(config)}
    stop(run_app(source, free_port(), extra_env=env))            # a data folder made by the app
    stop(run_app(target, free_port(), extra_env=env))            # and another, with a project of its own
    db = sqlite3.connect(target / "db.sqlite3")
    db.execute("INSERT INTO analyzer_project (name, description, location_label, created_at, updated_at) "
               "VALUES ('Barn', '', '', '2026-10-28 00:00:00', '2026-10-28 00:00:00')")
    barn = db.execute("SELECT id FROM analyzer_project WHERE name = 'Barn'").fetchone()[0]
    db.commit()
    db.close()
    key = (source / "secret_key").read_bytes()
    config.mkdir(exist_ok=True)
    (config / "data-dir").write_text(str(source), encoding="utf-8")
    (config / "move.json").write_text('{"from": "%s", "to": "%s", "projects": [%d]}' % (
        source.as_posix(), target.as_posix(), barn), encoding="utf-8")

    proc = run_app(None, free_port(), extra_env=env)
    stop(proc)
    result = json.loads((config / "move-result.json").read_text(encoding="utf-8"))
    assert result['state'] == 'moved' and result['error'] is None
    assert result['imported'] == [{'name': "Barn", 'flights': 0}]
    assert (target / "secret_key").read_bytes() == key and not source.exists()
    assert (config / "data-dir").read_text(encoding="utf-8") == str(target)
    assert not (config / "move.json").exists()
    assert Path(result['replaced'], "db.sqlite3").is_file()
    names = [n for (n,) in sqlite3.connect(target / "db.sqlite3").execute("SELECT name FROM analyzer_project")]
    assert "Barn" in names


def test_a_moved_data_folder_missing_stops_the_command_with_why(tmp_path, capsys, monkeypatch):
    monkeypatch.delenv(datadir.ENV_VAR)
    datadir.set_pointer(tmp_path / "unplugged")
    monkeypatch.setattr(cli, "setup", lambda d: datadir.data_dir())
    monkeypatch.setattr(cli, "port_free", lambda port: True)
    assert cli.main(["--no-browser", "--port", "1"]) == 1
    assert "is missing" in capsys.readouterr().err
