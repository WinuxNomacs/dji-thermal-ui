"""The data folder's size on disk, measured when asked: the database, each project's flights (their images and
datasets, in datasets/<id>/), files left behind by a flight no longer there, and anything else (the secret key, an
import under way). A folder flight's images are read in place: they are measured apart, outside the data folder."""

import os
import shutil
from pathlib import Path

from django.conf import settings

from .models import Project, ThermalDataset

DATABASE_FILES = ('db.sqlite3', 'db.sqlite3-wal', 'db.sqlite3-shm')


def folder_size(path):
    """The bytes and files under a folder (links not followed, files gone meanwhile left out): (bytes, files)"""
    total, count = 0, 0
    for dirpath, _dirnames, filenames in os.walk(path):
        for f in filenames:
            fp = os.path.join(dirpath, f)
            try:
                if not os.path.islink(fp):
                    total += os.path.getsize(fp)
                    count += 1
            except OSError:
                pass
    return total, count


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
