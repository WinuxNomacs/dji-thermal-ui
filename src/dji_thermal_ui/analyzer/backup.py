"""
A project's backup: a plain tar of `manifest.json` (the project's rows, with their ids at the time) and its flights'
files under `datasets/<id>/`: the images in `images/` (a folder flight's copied from its folder) and each
conversion's outputs in `conversions/<id>/`. The tar is streamed as it is written, its length known beforehand.
"""
import json
import os
import tarfile
import time

from django.core.serializers.json import DjangoJSONEncoder
from dji_thermal_cli import api as cli

from .. import __version__
from .models import ThermalDataset

FORMAT = 'dji-thermal-ui project'
VERSION = 1
MANIFEST = 'manifest.json'
BLOCK = tarfile.BLOCKSIZE
CHUNK = 1024 * 1024


def busy(dataset):
    """Whether a job is still writing the flight: its analysis, a conversion or mosaics"""
    return dataset.status == 'analyzing' or any(c.status == 'converting' or c.mosaic_status == 'building'
                                                for c in dataset.conversions.all())


def row(obj):
    """A row's fields as they are stored, its foreign keys as ids"""
    return {f.attname: f.value_from_object(obj) for f in obj._meta.concrete_fields}


def image_files(dataset):
    """The images the flight's analysis reads (the JPEGs under its images folder), as (path, path in the folder)"""
    root = dataset.images_dir()
    if not os.path.isdir(root):
        return []
    return sorted((str(p), os.path.relpath(p, root).replace(os.sep, '/')) for p in cli.scan(root).jpegs)


def output_files(conversion):
    """Every file the conversion wrote (its viewer copies too), as (path, path in its folder)"""
    root = conversion.data_dir()
    out = []
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames.sort()
        for f in sorted(filenames):
            full = os.path.join(dirpath, f)
            if not os.path.islink(full):
                out.append((full, os.path.relpath(full, root).replace(os.sep, '/')))
    return out


def flight_files(dataset):
    """A flight's files in the archive, as (path, name in the archive)"""
    base = 'datasets/{}/'.format(dataset.id)
    files = [(p, base + 'images/' + rel) for p, rel in image_files(dataset)]
    for c in dataset.conversions.all():
        files += [(p, base + 'conversions/{}/'.format(c.id) + rel) for p, rel in output_files(c)]
    return files


def manifest(project, datasets):
    return {
        'format': FORMAT, 'version': VERSION, 'app': __version__, 'exported_at': time.time(),
        'project': row(project),
        'flights': [dict(row(d), conversions=[dict(row(c), measurements=[row(m) for m in c.measurements.all()])
                                              for c in d.conversions.all()],
                         findings=[row(f) for f in d.findings.all()]) for d in datasets],
    }


def header(name, size, mtime):
    info = tarfile.TarInfo(name)
    info.size = size
    info.mtime = int(mtime)
    info.mode = 0o644
    return info.tobuf(tarfile.PAX_FORMAT, 'utf-8', 'surrogateescape')


def padding(size):
    return b'\0' * (-size % BLOCK)


class Archive:
    """The tar of a project with the flights chosen: len() is its size in bytes, iterating it writes it"""

    def __init__(self, project, datasets):
        data = json.dumps(manifest(project, datasets), cls=DjangoJSONEncoder, indent=1).encode('utf-8')
        now = time.time()
        self.parts = [(header(MANIFEST, len(data), now), data, None, len(data))]
        for d in datasets:
            for path, name in flight_files(d):
                st = os.stat(path)
                self.parts.append((header(name, st.st_size, st.st_mtime), None, path, st.st_size))

    def __len__(self):
        return sum(len(h) + size + len(padding(size)) for h, _data, _path, size in self.parts) + 2 * BLOCK

    def __iter__(self):
        for h, data, path, size in self.parts:
            yield h
            if data is not None:
                yield data
            else:
                yield from file_chunks(path, size)
            yield padding(size)
        yield b'\0' * (2 * BLOCK)


def file_chunks(path, size):
    """A file's bytes, as long as it was when the archive was planned (one that changed since stops the download,
    rather than leaving a tar that only looks whole)"""
    left = size
    with open(path, 'rb') as f:
        while left > 0:
            chunk = f.read(min(CHUNK, left))
            if not chunk:
                raise OSError("{} got shorter while it was exported".format(path))
            left -= len(chunk)
            yield chunk


def flight_sizes(project):
    """What each flight adds to the archive, in bytes, and whether it is busy (then not offered)"""
    out = []
    for d in ThermalDataset.objects.filter(project=project).prefetch_related('conversions').order_by('created_at', 'id'):
        if busy(d):
            out.append({'id': d.id, 'name': d.name, 'busy': True, 'bytes': None})
            continue
        size = 0
        for path, name in flight_files(d):
            try:
                n = os.path.getsize(path)
            except OSError:
                continue
            size += len(header(name, n, 0)) + n + len(padding(n))
        out.append({'id': d.id, 'name': d.name, 'busy': False, 'bytes': size})
    return out
