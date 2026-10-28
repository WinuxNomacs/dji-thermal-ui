"""dji-thermal-ui.sh: it builds a clone, starts the app in the background, says whether it runs and stops it. Each
test runs a copy of the script in a clone of its own, with uv, npm and curl replaced by stubs that record their calls"""
import os
import shutil
import socket
import subprocess
import urllib.request
from pathlib import Path

import pytest

from dji_thermal_ui import cli

pytestmark = pytest.mark.skipif(os.name == "nt" or not shutil.which("bash"), reason="the script is for bash")

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "dji-thermal-ui.sh"
MANIFEST = Path("src/dji_thermal_ui/static/dist/manifest.json")
TIMEOUT = 90


def free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind((cli.HOST, 0))
        return s.getsockname()[1]


def stub(bin_dir, name, body):
    """A command that records how it was called in calls.log, then runs the body"""
    f = bin_dir / name
    f.write_text('#!/bin/sh\necho "%s $*" >> "%s"\n%s\n' % (name, bin_dir.parent / "calls.log", body))
    f.chmod(0o755)


def tools(bin_dir, *names):
    """Links the real commands into bin_dir, for a PATH that has only these"""
    for n in names:
        (bin_dir / n).symlink_to(shutil.which(n))


@pytest.fixture
def clone(tmp_path):
    d = tmp_path / "clone"
    d.mkdir()
    shutil.copy(SCRIPT, d)
    (tmp_path / "bin").mkdir()
    (tmp_path / "home").mkdir()
    return d


def built(d):
    """What build leaves: the environment (the real one), node_modules and the pages' manifest"""
    (d / ".venv").symlink_to(ROOT / ".venv")
    (d / "node_modules").mkdir()
    (d / MANIFEST).parent.mkdir(parents=True)
    (d / MANIFEST).write_text("{}")


def run(d, *args, path=None):
    env = {k: v for k, v in os.environ.items() if k not in ("DJANGO_SETTINGS_MODULE", "DJI_THERMAL_UI_DATA_DIR")}
    env.update(DJI_THERMAL_UI_DATA_DIR=str(d.parent / "data"), HOME=str(d.parent / "home"),
               PATH=path or "%s:%s" % (d.parent / "bin", env["PATH"]))
    return subprocess.run([shutil.which("bash"), str(d / SCRIPT.name), *args], env=env, capture_output=True,
                          text=True, timeout=TIMEOUT)


def calls(d):
    log = d.parent / "calls.log"
    return log.read_text().splitlines() if log.exists() else []


def test_start_runs_the_app_in_the_background_and_stop_stops_it(clone):
    built(clone)
    port = free_port()
    url = "http://%s:%d/" % (cli.HOST, port)
    try:
        r = run(clone, "start", "--port", str(port), "--no-browser")
        assert r.returncode == 0, r.stdout + r.stderr
        assert "running" in r.stdout and url in r.stdout
        with urllib.request.urlopen(url + "api/preferences", timeout=30) as res:
            assert res.status == 200
        r = run(clone, "status")
        assert r.returncode == 0 and url in r.stdout
        assert "already running" in run(clone, "start", "--port", str(port)).stdout
        assert "serving " + url in run(clone, "logs").stdout
    finally:
        r = run(clone, "stop")
    assert r.returncode == 0 and "stopped" in r.stdout
    assert cli.port_free(port)
    assert not (clone / ".run" / "dji-thermal-ui.pid").exists()
    r = run(clone, "status")
    assert r.returncode == 3 and "not running" in r.stdout
    assert calls(clone) == []


def test_a_start_that_fails_shows_the_log(clone):
    built(clone)
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind((cli.HOST, 0))
        s.listen()
        r = run(clone, "start", "--port", str(s.getsockname()[1]), "--no-browser")
    assert r.returncode == 1
    assert "in use" in r.stderr and "did not start" in r.stderr
    assert not (clone / ".run" / "dji-thermal-ui.pid").exists()


def test_build_syncs_installs_and_builds_and_rebuild_does_the_same(clone):
    bin_dir = clone.parent / "bin"
    stub(bin_dir, "uv", "")
    stub(bin_dir, "npm", "")
    assert run(clone, "build").returncode == 0
    assert run(clone, "rebuild").returncode == 0
    assert calls(clone) == ["uv sync --locked", "npm ci", "npm run build"] * 2


def test_start_builds_a_clone_never_built_first(clone):
    bin_dir = clone.parent / "bin"
    stub(bin_dir, "uv", 'ln -s "%s" .venv' % (ROOT / ".venv"))
    stub(bin_dir, "npm", '[ "$1" = ci ] && mkdir node_modules\n'
                         '[ "$1" = run ] && mkdir -p "%s" && echo {} > "%s"\ntrue' % (MANIFEST.parent, MANIFEST))
    port = free_port()
    try:
        r = run(clone, "start", "--port", str(port), "--no-browser")
        assert r.returncode == 0, r.stdout + r.stderr
    finally:
        run(clone, "stop")
    assert calls(clone) == ["uv sync --locked", "npm ci", "npm run build"]


def test_build_installs_uv_when_it_is_missing(clone):
    bin_dir = clone.parent / "bin"
    tools(bin_dir, "dirname", "sh", "env", "cat", "mkdir", "cp")
    stub(bin_dir, "uv", "")
    (bin_dir / "uv").rename(clone.parent / "uv")
    # the installer the stub curl gives records whether it was asked not to edit the shell's startup files
    stub(bin_dir, "curl", "cat <<'EOF'\n"
                          'echo "installer UV_NO_MODIFY_PATH=$UV_NO_MODIFY_PATH" >> "%s"\n'
                          'mkdir -p "$HOME/.local/bin" && cp "%s" "$HOME/.local/bin/uv"\nEOF'
         % (clone.parent / "calls.log", clone.parent / "uv"))
    stub(bin_dir, "npm", "")
    r = run(clone, "build", path=str(bin_dir))
    assert r.returncode == 0, r.stdout + r.stderr
    assert calls(clone)[:3] == ["curl -LsSf https://astral.sh/uv/0.12.5/install.sh", "installer UV_NO_MODIFY_PATH=1",
                                "uv sync --locked"]
    assert "not on your PATH" in r.stdout


def test_build_stops_and_says_where_to_get_node_when_npm_is_missing(clone):
    bin_dir = clone.parent / "bin"
    tools(bin_dir, "dirname")
    stub(bin_dir, "uv", "")
    r = run(clone, "build", path=str(bin_dir))
    assert r.returncode == 1
    assert "npm is not installed" in r.stderr and "nodejs.org" in r.stderr
    assert calls(clone) == []
