"""The job runner: analyses, conversions and mosaics run one at a time on a worker thread in the server process.

dji-thermal-cli starts its own processes for the heavy work, so one thread is enough. A job is a function called with
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

_queue = queue.Queue()
_lock = threading.Lock()
_alive = {}                 # run_id -> the number of its jobs queued or running
_ids = itertools.count(1)
_worker = None


def start():
    """Starts the worker thread (once)"""
    global _worker
    with _lock:
        if _worker is not None and _worker.is_alive():
            return
        _worker = threading.Thread(target=_work, name="dji-thermal-ui-jobs", daemon=True)
        _worker.start()


def submit(fn, pk, run_id):
    """Queues fn(pk, run_id) and returns the job's id. With THERMAL_JOBS_EAGER (the tests), it runs now instead."""
    job_id = next(_ids)
    if settings.THERMAL_JOBS_EAGER:
        _run(fn, pk, run_id)
        return job_id
    with _lock:
        _alive[run_id] = _alive.get(run_id, 0) + 1
    _queue.put((fn, pk, run_id))
    return job_id


def alive(run_id):
    """Whether a job started with this run_id is queued or running"""
    with _lock:
        return bool(run_id) and _alive.get(run_id, 0) > 0


def join():
    """Waits until every job queued has run (the tests)"""
    _queue.join()


def mark_interrupted():
    """Marks the analyses, conversions and mosaics a closed server left running as failed"""
    from .models import ThermalConversion, ThermalDataset
    n = ThermalDataset.objects.filter(status='analyzing').update(status='failed', error=INTERRUPTED, run_id="",
                                                                 progress=0)
    n += ThermalConversion.objects.filter(mosaic_status='building').update(mosaic_status='failed',
                                                                            mosaic_error=INTERRUPTED, run_id="",
                                                                            mosaic_progress=0)
    n += ThermalConversion.objects.filter(status='converting').update(status='failed', error=INTERRUPTED, run_id="",
                                                                      progress=0)
    return n


def _work():
    while True:
        fn, pk, run_id = _queue.get()
        try:
            _run(fn, pk, run_id)
        finally:
            with _lock:
                left = _alive.get(run_id, 0) - 1
                if left > 0:
                    _alive[run_id] = left
                else:
                    _alive.pop(run_id, None)
            _queue.task_done()


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
