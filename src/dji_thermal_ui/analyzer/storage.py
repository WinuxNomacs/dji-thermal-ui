"""The data folder's size on disk, measured when asked: the database, each project's flights (their images and
datasets, in datasets/<id>/), files left behind by a flight no longer there, and anything else (the secret key, an
import under way). A folder flight's images are read in place: they are measured apart, outside the data folder."""

import json
import os
import shutil
import sqlite3
import tempfile
from pathlib import Path

from django.conf import settings
from django.core.management import call_command
from django.db import connections

from .. import move
from ..move import folder_size
from . import backup, restore
from .models import Project, ThermalConversion, ThermalDataset

DATABASE_FILES = ('db.sqlite3', 'db.sqlite3-wal', 'db.sqlite3-shm')
REPLACED = 'replaced'           # a set-aside data folder's database while importing from it: this thread's own alias


def measure(root=None):
    """The data folder as it is now: {path, total, free, database, other, left_behind, projects: [{id, name, size,
    flights: [{id, name, size, files, in_place}]}]}, in bytes; in_place: a folder flight's images where it reads them
    (None for an uploaded flight, or a folder no longer there)"""
    root = Path(root or settings.DATA_DIR)
    database, other = 0, 0
    flights = {}                                # a datasets/<id> folder's id: (bytes, files)
    for entry in os.scandir(root):
        if entry.name == 'datasets' and entry.is_dir(follow_symlinks=False):
            for d in os.scandir(entry.path):
                if d.is_dir(follow_symlinks=False) and d.name.isdigit():
                    flights[int(d.name)] = folder_size(d.path)
                elif d.is_file(follow_symlinks=False):
                    other += d.stat().st_size
                elif d.is_dir(follow_symlinks=False):
                    other += folder_size(d.path)[0]
        elif entry.is_file(follow_symlinks=False):
            size = entry.stat().st_size
            if entry.name in DATABASE_FILES:
                database += size
            else:
                other += size
        elif entry.is_dir(follow_symlinks=False):
            other += folder_size(entry.path)[0]

    projects = []
    known = set()
    datasets = ThermalDataset.objects.only('id', 'name', 'project_id', 'source', 'folder').order_by('name', 'id')
    by_project = {}
    for d in datasets:
        known.add(d.id)
        size, files = flights.get(d.id, (0, 0))
        in_place = folder_size(d.folder)[0] if d.source == 'folder' and d.folder and os.path.isdir(d.folder) else None
        by_project.setdefault(d.project_id, []).append(
            {'id': d.id, 'name': d.name, 'size': size, 'files': files, 'in_place': in_place})
    for p in Project.objects.order_by('name', 'id'):
        rows = by_project.get(p.id, [])
        projects.append({'id': p.id, 'name': p.name, 'size': sum(f['size'] for f in rows), 'flights': rows})
    left_behind = sum(size for i, (size, _files) in flights.items() if i not in known)
    try:
        free = shutil.disk_usage(root).free
    except OSError:
        free = None
    return {'path': str(root), 'total': database + other + sum(size for size, _files in flights.values()),
            'free': free, 'database': database, 'other': other, 'left_behind': left_behind, 'projects': projects}


def busy():
    """Whether a job runs or an import is under way: the data folder cannot move meanwhile"""
    return (ThermalDataset.objects.filter(status='analyzing').exists() or
            ThermalConversion.objects.filter(status='converting').exists() or
            ThermalConversion.objects.filter(mosaic_status='building').exists() or bool(restore.IMPORTS))


def check(path):
    """What moving the data folder to path would do (move.inspect), with what else stops it: a folder chosen by
    --data-dir or the environment, and a job running"""
    out = move.inspect(path, settings.DATA_DIR)
    if settings.DATA_DIR_SET_BY == 'environment':
        out['problems'].insert(0, "The data folder is set by --data-dir or DJI_THERMAL_UI_DATA_DIR: change it there.")
    if busy():
        out['problems'].append("A job is running or a project is being imported: wait until it ends.")
    return out


def import_replaced(replaced, ids):
    """The projects chosen from a set-aside data folder made into projects here, with backup's manifest and restore:
    its database copied and brought up to date (the copy, not it), each project's flights' files moved from it.
    Returns {imported: [{name, flights}], error}."""
    out = {'imported': [], 'error': None}
    work = tempfile.mkdtemp(prefix='move-', dir=settings.DATA_DIR)
    copy = os.path.join(work, 'db.sqlite3')
    try:
        src = sqlite3.connect(Path(replaced, 'db.sqlite3').as_uri() + '?mode=ro', uri=True)
        dst = sqlite3.connect(copy)
        try:
            src.backup(dst)                     # with what is still in its WAL
        finally:
            src.close()
            dst.close()
        default = connections['default']
        connections[REPLACED] = type(default)(dict(default.settings_dict, NAME=copy), alias=REPLACED)
        call_command('migrate', database=REPLACED, interactive=False, verbosity=0)
        for project in Project.objects.using(REPLACED).filter(id__in=ids).order_by('name', 'id'):
            flights = ThermalDataset.objects.using(REPLACED).filter(project=project).prefetch_related(
                'conversions__measurements', 'findings').order_by('created_at', 'id')
            # as an archive's manifest reads: the rows written to JSON and read back
            m = json.loads(json.dumps(backup.manifest(project, flights), cls=backup.Encoder))
            restore.check_manifest(m)
            made = restore.make_project(m, replaced, restore.free_name(project.name), keep_folders=True)
            out['imported'].append({'name': made.name, 'flights': len(m['flights'])})
    except (restore.RestoreError, sqlite3.Error, OSError) as e:
        out['error'] = str(e)
    finally:
        if hasattr(connections._connections, REPLACED):
            connections[REPLACED].close()
            del connections[REPLACED]
        shutil.rmtree(work, ignore_errors=True)
    return out
