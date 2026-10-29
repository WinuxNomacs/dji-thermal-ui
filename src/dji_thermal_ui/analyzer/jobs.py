"""The job runner: analyses, conversions and mosaics run one at a time on a worker thread in the server process, and
uploads to WebODM on a second one, so that a long upload doesn't hold up a conversion.

dji-thermal-cli starts its own processes for the heavy work, so one thread for it is enough. A job is a function called with
a row's pk and the run_id it was started with; it writes its progress to the row, and stops when the row's run_id is
no longer its own (canceling or deleting changes it). The runner knows which run_ids are queued or running, so a row
whose job is gone is seen as such (alive()); rows left running by a closed server are marked failed on start
(mark_interrupted()).
"""

import itertools
import logging
import queue
import threading

from django.conf import settings
from django.db import close_old_connections, connections

logger = logging.getLogger('dji_thermal_ui')

INTERRUPTED = "Interrupted: the server stopped before the job finished"

MAIN = 'main'               # analyses, conversions and mosaics
UPLOADS = 'uploads'         # uploads to WebODM
_queues = {MAIN: queue.Queue(), UPLOADS: queue.Queue()}
_names = {MAIN: "dji-thermal-ui-jobs", UPLOADS: "dji-thermal-ui-uploads"}
_lock = threading.Lock()
_alive = {}                 # run_id -> the number of its jobs queued or running
_ids = itertools.count(1)
_workers = {}


def start():
    """Starts the worker threads (once)"""
    with _lock:
        for line, q in _queues.items():
            if line in _workers and _workers[line].is_alive():
                continue
            _workers[line] = threading.Thread(target=_work, args=(q,), name=_names[line], daemon=True)
            _workers[line].start()


def submit(fn, pk, run_id, line=MAIN):
    """Queues fn(pk, run_id) on a worker (MAIN or UPLOADS) and returns the job's id. With THERMAL_JOBS_EAGER (the
    tests), it runs now instead."""
    job_id = next(_ids)
    if settings.THERMAL_JOBS_EAGER:
        _run(fn, pk, run_id)
        return job_id
    with _lock:
        _alive[run_id] = _alive.get(run_id, 0) + 1
    _queues[line].put((fn, pk, run_id))
    return job_id


def alive(run_id):
    """Whether a job started with this run_id is queued or running"""
    with _lock:
        return bool(run_id) and _alive.get(run_id, 0) > 0


def join():
    """Waits until every job queued has run (the tests)"""
    for q in _queues.values():
        q.join()


def mark_interrupted():
    """Marks the analyses, conversions, mosaics, uploads and downloads a closed server left running as failed (the tasks half
    made in WebODM are removed once the workers start: webodm_tasks.remove_half_made)"""
    from .models import ThermalConversion, ThermalDataset, WebODMTask
    n = ThermalDataset.objects.filter(status='analyzing').update(status='failed', error=INTERRUPTED, run_id="",
                                                                 progress=0)
    n += ThermalConversion.objects.filter(mosaic_status='building').update(mosaic_status='failed',
                                                                            mosaic_error=INTERRUPTED, run_id="",
                                                                            mosaic_progress=0)
    n += ThermalConversion.objects.filter(status='converting').update(status='failed', error=INTERRUPTED, run_id="",
                                                                      progress=0)
    n += WebODMTask.objects.filter(status='uploading').update(status='failed', error=INTERRUPTED, run_id="")
    n += WebODMTask.objects.filter(orthophoto_status='downloading').update(orthophoto_status='failed',
                                                                         orthophoto_error=INTERRUPTED, run_id="")
    return n


def _work(q):
    while True:
        fn, pk, run_id = q.get()
        try:
            _run(fn, pk, run_id)
        finally:
            with _lock:
                left = _alive.get(run_id, 0) - 1
                if left > 0:
                    _alive[run_id] = left
                else:
                    _alive.pop(run_id, None)
            q.task_done()


def _run(fn, pk, run_id):
    """Runs a job; a failure is logged (the job reports it on its row) and never stops the worker"""
    eager = settings.THERMAL_JOBS_EAGER
    if not eager:
        close_old_connections()
    try:
        fn(pk, run_id)
    except Exception:
        logger.exception("Job %s(%s, %s) failed", getattr(fn, '__name__', fn), pk, run_id)
    finally:
        if not eager:                      # the worker thread's own connection
            connections.close_all()
