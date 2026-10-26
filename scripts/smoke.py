"""Run the installed command and check it serves: python scripts/smoke.py COMMAND...

COMMAND is how the app is started, such as `dji-thermal-ui` or `uvx --from dist/<wheel> dji-thermal-ui`. It is run
with --no-browser on a free port and a temporary data folder, which is removed afterwards. The script checks that
--version answers, then that the datasets page, a vendored file, a script and the preferences API are served, which
needs the templates, the static files and the migrations to be in the installed package. Standard library only.
"""

from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

HOST = "127.0.0.1"
START_TIMEOUT = 120         # the first run of a uvx command installs the wheel and its dependencies
TIMEOUT = 30


def get(url: str) -> tuple[int, bytes]:
    with urllib.request.urlopen(url, timeout=TIMEOUT) as r:
        return r.status, r.read()


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind((HOST, 0))
        return s.getsockname()[1]


def stop(proc: subprocess.Popen) -> None:
    """Stop the command and what it started. On Windows terminate() stops only the first process (uv), and the
    server it started would keep running and hold the output pipe open."""
    if os.name == "nt":
        subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)], capture_output=True)
    else:
        proc.terminate()


def check(base: str) -> list[str]:
    """What the running app gets wrong, if anything"""
    problems = []
    expect = [
        ("", b"Thermal Analyzer"),
        ("static/vendor/leaflet/leaflet.css", b".leaflet-container"),
        ("static/vendor/bootstrap/css/bootstrap.min.css", b"Bootstrap v3.4.1"),
        ("static/viewer.js", b"ThermalAnalyzerCore"),
    ]
    for path, needle in expect:
        status, body = get(base + path)
        if status != 200 or needle not in body:
            problems.append(f"/{path}: status {status}, {needle!r} {'found' if needle in body else 'missing'}")
    status, body = get(base + "api/preferences")
    if status != 200 or "unit" not in json.loads(body):
        problems.append(f"/api/preferences: status {status}, {body[:200]!r}")
    return problems


def main(argv: list[str]) -> int:
    command = argv[1:]
    if not command:
        print(__doc__.splitlines()[0])
        return 2
    version = subprocess.run([*command, "--version"], capture_output=True, text=True, timeout=START_TIMEOUT)
    print(version.stdout.strip() or version.stderr.strip())
    if version.returncode != 0 or not version.stdout.startswith("dji-thermal-ui "):
        return 1

    data_dir = tempfile.mkdtemp(prefix="dji-thermal-ui-smoke-")
    port = free_port()
    base = f"http://{HOST}:{port}/"
    env = {k: v for k, v in os.environ.items() if k not in ("DJANGO_SETTINGS_MODULE", "DJI_THERMAL_UI_DATA_DIR")}
    env["PYTHONUNBUFFERED"] = "1"           # so its output is shown though it is stopped
    proc = subprocess.Popen([*command, "--no-browser", "--port", str(port), "--data-dir", data_dir],
                            env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    try:
        deadline = time.monotonic() + START_TIMEOUT
        while True:
            try:
                get(base)
                break
            except OSError:
                if proc.poll() is not None or time.monotonic() > deadline:
                    print("the server did not start")
                    return 1
                time.sleep(0.5)
        problems = check(base)
    finally:
        stop(proc)
        try:
            output = proc.communicate(timeout=TIMEOUT)[0]
        except subprocess.TimeoutExpired:
            proc.kill()
            output = proc.communicate()[0]
        print(output.strip())
        shutil.rmtree(data_dir, ignore_errors=True)
    for p in problems:
        print(f"  {p}")
    print("smoke check:", "ok" if not problems else f"{len(problems)} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
