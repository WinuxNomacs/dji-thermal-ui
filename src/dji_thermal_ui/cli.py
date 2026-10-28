"""The dji-thermal-ui command: serves the app on 127.0.0.1 and opens the browser."""

import argparse
import os
import signal
import socket
import subprocess
import sys
import threading
import time
import webbrowser

from . import move
from ._version import __version__
from .datadir import ENV_VAR, DataDirError

HOST = "127.0.0.1"
PORT = 8080
RESTARTED_FROM = "DJI_THERMAL_UI_RESTARTED_FROM"     # the process a Windows restart replaces, waited for
WINDOWS = os.name == "nt"


def parse_args(argv=None):
    p = argparse.ArgumentParser(prog="dji-thermal-ui",
                                description="Analyze, convert, mosaic and measure DJI thermal flights in the browser.")
    p.add_argument("--data-dir", help="the folder for the database and the flights (default: the user data folder)")
    p.add_argument("--port", type=int, default=PORT,
                   help="the port to serve on, on 127.0.0.1 (default: %d)" % PORT)
    p.add_argument("--no-browser", action="store_true", help="do not open the browser")
    p.add_argument("--version", action="version", version="%(prog)s " + __version__)
    return p.parse_args(argv)


def port_free(port):
    """Whether nothing listens on the port already"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        if os.name != "nt":
            # as waitress binds: connections left from a server just stopped do not hold the port
            s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind((HOST, port))
        except OSError:
            return False
    return True


def setup(data_dir=None):
    """Points Django at the data folder, sets it up and brings the database up to date"""
    if data_dir:
        os.environ[ENV_VAR] = os.path.abspath(os.path.expanduser(data_dir))
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "dji_thermal_ui.settings")
    import django
    django.setup()
    from django.core.management import call_command
    call_command("migrate", interactive=False, verbosity=0)


def make_server(port):
    """Starts the job runner and returns the waitress server, ready to run"""
    from waitress.server import create_server

    from .analyzer import jobs, restore
    from .wsgi import application

    n = jobs.mark_interrupted()
    if n:
        print("Marked %d job(s) left running by a closed server as failed" % n)
    restore.clear_imports()
    jobs.start()
    return create_server(application, host=HOST, port=port, threads=8)


def wait_for_port(port, seconds):
    """Whether the port is free within seconds (the server restarting closes it as the new one starts)"""
    end = time.monotonic() + seconds
    while not port_free(port):
        if time.monotonic() > end:
            return False
        time.sleep(0.2)
    return True


def wait_for_exit(pid, seconds):
    """Waits for the process a restart on Windows replaces to end: until it does, it holds the database's files"""
    import ctypes
    kernel32 = ctypes.windll.kernel32
    handle = kernel32.OpenProcess(0x00100000, False, pid)          # SYNCHRONIZE
    if handle:
        kernel32.WaitForSingleObject(handle, int(seconds * 1000))
        kernel32.CloseHandle(handle)


def moved(plan):
    """Moves the data folder as the Storage page asked (move.perform), before the database is opened"""
    print("Moving the data folder from %s to %s..." % (plan.get('from'), plan.get('to')))
    result = move.perform(plan)
    print("Moved." if result['state'] == 'moved' else result['error'])
    return result


def imported(result, projects):
    """The projects chosen from what the new data folder held, imported now that the database is open"""
    from .analyzer import storage
    print("Importing %d project(s) from %s..." % (len(projects), result['replaced']))
    out = storage.import_replaced(result['replaced'], projects)
    result.update(imported=out['imported'], error=out['error'])
    if out['error']:
        print("Could not import them all: %s" % out['error'], file=sys.stderr)


def restart(argv):
    """Starts the command again, with the same options (but no browser opened again): the same process on POSIX,
    so a PID file stays true; a new one on Windows, whose exec does not quote its arguments"""
    args = [sys.executable, "-m", "dji_thermal_ui", *(sys.argv[1:] if argv is None else argv)]
    if "--no-browser" not in args:
        args.append("--no-browser")
    print("Restarting...", flush=True)
    sys.stderr.flush()
    if WINDOWS:
        subprocess.Popen(args, env=dict(os.environ, **{RESTARTED_FROM: str(os.getpid())}))
        return 0
    os.execv(sys.executable, args)


def main(argv=None):
    args = parse_args(argv)
    replaced = os.environ.pop(RESTARTED_FROM, "")
    if replaced.isdigit() and WINDOWS:
        wait_for_exit(int(replaced), 30)
    plan = None if args.data_dir or os.environ.get(ENV_VAR) else move.take_plan()
    if not wait_for_port(args.port, 30 if plan else 0):
        print("Port %d on %s is in use: is dji-thermal-ui already running? Use --port to pick another." %
              (args.port, HOST), file=sys.stderr)
        return 1
    result = moved(plan) if plan else None
    try:
        setup(args.data_dir)
    except DataDirError as e:
        print(e, file=sys.stderr)
        return 1
    if result:
        if result['state'] == 'moved' and plan.get('projects') and result['replaced']:
            imported(result, plan['projects'])
        move.write_json(move.RESULT, result)
    from django.conf import settings
    server = make_server(args.port)
    url = "http://%s:%d/" % (HOST, args.port)
    print("dji-thermal-ui %s serving %s (data in %s). Press Ctrl+C to stop." % (__version__, url, settings.DATA_DIR))
    if not args.no_browser:
        threading.Timer(1.0, webbrowser.open, args=(url,)).start()
    # stopped like Ctrl+C when sent SIGTERM (as dji-thermal-ui.sh stop does), so the server closes
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    move.SERVING = True
    try:
        server.run()
    except KeyboardInterrupt:
        pass
    finally:
        server.close()
    if move.RESTART.is_set():
        return restart(argv)
    return 0
