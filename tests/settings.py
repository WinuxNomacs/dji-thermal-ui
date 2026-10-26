"""The settings for the tests: a data folder of their own, removed when they end, and jobs run inline."""

import atexit
import os
import shutil
import tempfile
from pathlib import Path

_data = tempfile.mkdtemp(prefix="dji-thermal-ui-tests-")
atexit.register(shutil.rmtree, _data, ignore_errors=True)
os.environ["DJI_THERMAL_UI_DATA_DIR"] = _data

from dji_thermal_ui.settings import *  # noqa: E402,F403
from dji_thermal_ui.settings import DATA_DIR, DATABASES  # noqa: E402

# A file, not SQLite's shared memory database, so the runner's and waitress' threads see the same data
DATABASES["default"]["TEST"] = {"NAME": str(DATA_DIR / "test.sqlite3")}

THERMAL_JOBS_EAGER = True
THERMAL_PROCESSES = 1

# The pages load their scripts through a stub of the front end's build: the tests need no `npm run build`
VITE_MANIFEST = Path(__file__).parent / "data" / "vite-manifest.json"
