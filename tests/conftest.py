"""Test configuration. The suite runs with nothing configured; one optional setting, an environment variable, adds
the tests that need real data:

  DJI_THERMAL_FLIGHT_DIR   the R-JPEGs of one flight (marker `flight`); skipped without it.
"""

import os
from pathlib import Path

import pytest

FLIGHT_ENV = "DJI_THERMAL_FLIGHT_DIR"


@pytest.fixture
def flight_frames():
    """The flight's R-JPEGs, sorted"""
    d = os.environ.get(FLIGHT_ENV, "").strip()
    if not d or not Path(d).is_dir():
        pytest.skip("set %s to a folder of one flight's R-JPEGs" % FLIGHT_ENV)
    return sorted(p for p in Path(d).iterdir() if p.suffix.lower() in (".jpg", ".jpeg"))


@pytest.fixture
def threaded_jobs(settings):
    """Jobs run on the runner's worker thread, as when serving"""
    from dji_thermal_ui.analyzer import jobs
    settings.THERMAL_JOBS_EAGER = False
    jobs.start()
    yield jobs
    jobs.join()
