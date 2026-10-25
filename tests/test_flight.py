"""Checks with real R-JPEGs (set DJI_THERMAL_FLIGHT_DIR)"""

import shutil

import dji_thermal_cli
import pytest

pytestmark = pytest.mark.flight


@pytest.mark.django_db(transaction=True)
def test_a_job_on_the_runner_converts_frames_with_worker_processes(threaded_jobs, flight_frames, tmp_path):
    images = tmp_path / "images"
    images.mkdir()
    for f in flight_frames[:4]:
        shutil.copy(f, images)
    out = tmp_path / "out"
    reports = []

    def convert(pk, run_id):
        reports.append(dji_thermal_cli.process(images, out, jobs=2))

    threaded_jobs.submit(convert, 1, "flight")
    threaded_jobs.join()
    assert len(reports) == 1
    assert reports[0].processed == 4
    assert len(list(out.rglob("*.tif*"))) == 4
    assert len(list(out.rglob("*.png"))) == 4
