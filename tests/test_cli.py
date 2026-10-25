import os
import socket
import sqlite3
import subprocess
import sys
import threading
import time
import urllib.request

import pytest

from dji_thermal_ui import __version__, cli

TIMEOUT = 30


def get(url):
    with urllib.request.urlopen(url, timeout=TIMEOUT) as r:
        return r.status, r.read()


def free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind((cli.HOST, 0))
        return s.getsockname()[1]


def test_version_prints_the_version(capsys):
    with pytest.raises(SystemExit) as e:
        cli.main(["--version"])
    assert e.value.code == 0
    assert capsys.readouterr().out.strip() == "dji-thermal-ui " + __version__


def test_a_port_in_use_is_reported_and_exits_with_1(capsys):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind((cli.HOST, 0))
        s.listen()
        assert cli.main(["--port", str(s.getsockname()[1]), "--no-browser"]) == 1
    assert "in use" in capsys.readouterr().err


@pytest.mark.django_db(transaction=True)
def test_the_server_serves_the_home_page(threaded_jobs):
    server = cli.make_server(0)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    try:
        url = "http://%s:%d/" % (cli.HOST, int(server.effective_port))
        status, body = get(url)
        assert status == 200
        assert b"Thermal Analyzer" in body
        status, body = get(url + "static/vendor/leaflet/leaflet.css")
        assert status == 200
        assert b".leaflet-container" in body
    finally:
        server.close()


def run_app(data_dir, port):
    """Runs the command as a user would, until it serves the home page"""
    env = {k: v for k, v in os.environ.items() if k not in ("DJANGO_SETTINGS_MODULE", "DJI_THERMAL_UI_DATA_DIR")}
    proc = subprocess.Popen([sys.executable, "-m", "dji_thermal_ui", "--data-dir", str(data_dir), "--port", str(port),
                             "--no-browser"], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    deadline = time.monotonic() + TIMEOUT
    while True:
        try:
            assert get("http://%s:%d/" % (cli.HOST, port))[0] == 200
            return proc
        except OSError:
            if proc.poll() is not None or time.monotonic() > deadline:
                proc.kill()
                pytest.fail("the server did not start:\n" + proc.communicate()[0])
            time.sleep(0.2)


def stop(proc):
    proc.terminate()
    proc.communicate(timeout=TIMEOUT)


def test_the_command_makes_its_data_folder_and_keeps_its_secret_key_across_restarts(tmp_path):
    data = tmp_path / "data"
    port = free_port()
    stop(run_app(data, port))
    key = (data / "secret_key").read_text(encoding="utf-8")
    assert (data / "datasets").is_dir()
    with sqlite3.connect(data / "db.sqlite3") as db:
        assert db.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
    db.close()

    stop(run_app(data, port))
    assert (data / "secret_key").read_text(encoding="utf-8") == key
