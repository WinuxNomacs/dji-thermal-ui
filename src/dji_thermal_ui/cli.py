"""The dji-thermal-ui command: serves the app on 127.0.0.1 and opens the browser."""

import argparse
import os
import signal
import socket
import sys
import threading
import webbrowser

from ._version import __version__
from .datadir import ENV_VAR

HOST = "127.0.0.1"
PORT = 8080


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

    from .analyzer import jobs
    from .wsgi import application

    n = jobs.mark_interrupted()
    if n:
        print("Marked %d job(s) left running by a closed server as failed" % n)
    jobs.start()
    return create_server(application, host=HOST, port=port, threads=8)


def main(argv=None):
    args = parse_args(argv)
    if not port_free(args.port):
        print("Port %d on %s is in use: is dji-thermal-ui already running? Use --port to pick another." %
              (args.port, HOST), file=sys.stderr)
        return 1
    setup(args.data_dir)
    from django.conf import settings
    server = make_server(args.port)
    url = "http://%s:%d/" % (HOST, args.port)
    print("dji-thermal-ui %s serving %s (data in %s). Press Ctrl+C to stop." % (__version__, url, settings.DATA_DIR))
    if not args.no_browser:
        threading.Timer(1.0, webbrowser.open, args=(url,)).start()
    # stopped like Ctrl+C when sent SIGTERM (as dji-thermal-ui.sh stop does), so the server closes
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    try:
        server.run()
    except KeyboardInterrupt:
        pass
    finally:
        server.close()
    return 0
