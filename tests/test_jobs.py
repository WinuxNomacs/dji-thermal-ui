import logging
import threading

import pytest

from dji_thermal_ui.analyzer import jobs
from dji_thermal_ui.analyzer.models import ThermalConversion, ThermalDataset

TIMEOUT = 10


def test_an_eager_job_runs_when_submitted(db):
    ran = []
    jobs.submit(lambda pk, run_id: ran.append((pk, run_id)), 1, "r")
    assert ran == [(1, "r")]


@pytest.mark.django_db(transaction=True)
def test_jobs_run_on_the_worker_thread_in_the_order_submitted(threaded_jobs):
    ran = []

    def job(pk, run_id):
        ran.append((pk, threading.current_thread().name))

    for pk in range(5):
        threaded_jobs.submit(job, pk, "r%d" % pk)
    threaded_jobs.join()
    assert ran == [(pk, "dji-thermal-ui-jobs") for pk in range(5)]


def stepping_job(reached, go):
    """A job that writes half its progress, waits, then finishes while the run is still its own"""
    def job(pk, run_id):
        ThermalDataset.objects.filter(pk=pk, run_id=run_id).update(progress=0.5)
        reached.set()
        go.wait(TIMEOUT)
        ThermalDataset.objects.filter(pk=pk, run_id=run_id).update(status="ready", progress=1)
    return job


@pytest.mark.django_db(transaction=True)
def test_a_job_writes_its_progress_to_its_row_and_is_alive_until_it_ends(threaded_jobs):
    ds = ThermalDataset.objects.create(name="d", status="analyzing", run_id="run1")
    reached, go = threading.Event(), threading.Event()
    threaded_jobs.submit(stepping_job(reached, go), ds.pk, "run1")
    assert reached.wait(TIMEOUT)
    ds.refresh_from_db()
    assert (ds.status, ds.progress) == ("analyzing", 0.5)
    assert threaded_jobs.alive("run1")
    go.set()
    threaded_jobs.join()
    ds.refresh_from_db()
    assert (ds.status, ds.progress) == ("ready", 1)
    assert not threaded_jobs.alive("run1")


@pytest.mark.django_db(transaction=True)
def test_changing_the_run_id_cancels_a_job_at_its_next_check(threaded_jobs):
    ds = ThermalDataset.objects.create(name="d", status="analyzing", run_id="run1")
    reached, go = threading.Event(), threading.Event()
    threaded_jobs.submit(stepping_job(reached, go), ds.pk, "run1")
    assert reached.wait(TIMEOUT)
    ThermalDataset.objects.filter(pk=ds.pk).update(status="canceled", run_id="")
    go.set()
    threaded_jobs.join()
    ds.refresh_from_db()
    assert (ds.status, ds.progress) == ("canceled", 0.5)


def test_a_run_id_never_submitted_or_empty_is_not_alive():
    assert not jobs.alive("never")
    assert not jobs.alive("")


@pytest.mark.django_db(transaction=True)
def test_a_failing_job_is_logged_and_the_worker_goes_on(threaded_jobs, caplog):
    ran = []

    def failing(pk, run_id):
        raise RuntimeError("boom")

    with caplog.at_level(logging.ERROR, logger="dji_thermal_ui"):
        threaded_jobs.submit(failing, 1, "a")
        threaded_jobs.submit(lambda pk, run_id: ran.append(pk), 2, "b")
        threaded_jobs.join()
    assert ran == [2]
    assert "boom" in caplog.text
    assert not threaded_jobs.alive("a")


def test_rows_left_running_by_a_closed_server_are_marked_interrupted(db):
    analyzing = ThermalDataset.objects.create(name="a", status="analyzing", run_id="r1", progress=0.3)
    ready = ThermalDataset.objects.create(name="b", status="ready")
    converting = ThermalConversion.objects.create(dataset=ready, name="c", status="converting", run_id="r2",
                                                  progress=0.4)
    building = ThermalConversion.objects.create(dataset=ready, name="m", status="ready", mosaic_status="building",
                                                run_id="r3", mosaic_progress=0.5)
    built = ThermalConversion.objects.create(dataset=ready, name="n", status="ready", mosaic_status="ready")

    assert jobs.mark_interrupted() == 3

    for row in (analyzing, ready, converting, building, built):
        row.refresh_from_db()
    assert (analyzing.status, analyzing.error, analyzing.run_id, analyzing.progress) == \
        ("failed", jobs.INTERRUPTED, "", 0)
    assert (converting.status, converting.error, converting.run_id) == ("failed", jobs.INTERRUPTED, "")
    assert (building.status, building.mosaic_status, building.mosaic_error, building.run_id) == \
        ("ready", "failed", jobs.INTERRUPTED, "")
    assert ready.status == "ready"
    assert (built.status, built.mosaic_status) == ("ready", "ready")
