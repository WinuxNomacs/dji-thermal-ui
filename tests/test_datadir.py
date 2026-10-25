from pathlib import Path

import platformdirs

from dji_thermal_ui import datadir


def test_the_data_folder_is_the_one_in_the_environment_variable_with_its_datasets_folder(tmp_path, monkeypatch):
    monkeypatch.setenv(datadir.ENV_VAR, str(tmp_path / "data"))
    d = datadir.data_dir()
    assert d == (tmp_path / "data").resolve()
    assert (d / "datasets").is_dir()


def test_without_the_variable_the_data_folder_is_the_user_data_folder(tmp_path, monkeypatch):
    calls = []

    def user_data_dir(*args, **kwargs):
        calls.append((args, kwargs))
        return str(tmp_path / "user")

    monkeypatch.delenv(datadir.ENV_VAR, raising=False)
    monkeypatch.setattr(platformdirs, "user_data_dir", user_data_dir)
    assert datadir.data_dir() == (tmp_path / "user").resolve()
    assert calls == [(("dji-thermal-ui",), {"appauthor": False})]


def test_the_secret_key_is_made_once_and_kept_across_starts(tmp_path):
    key = datadir.secret_key(tmp_path)
    assert len(key) >= 50
    assert (tmp_path / "secret_key").read_text(encoding="utf-8") == key
    assert datadir.secret_key(tmp_path) == key


def test_the_secret_key_is_made_again_when_its_file_is_empty(tmp_path):
    (tmp_path / "secret_key").write_text("", encoding="utf-8")
    assert datadir.secret_key(tmp_path)
    assert Path(tmp_path / "secret_key").read_text(encoding="utf-8")
