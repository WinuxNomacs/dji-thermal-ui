"""
A project's import: an archive that backup.py wrote, sent in pieces (one request may carry 1 GB at most) and unpacked
as they come into a staging folder in the data folder, `imports/<id>/`. Its manifest comes first, so the project's
name and flights are known early. Finishing makes a new project with new ids, the rows' links remapped, and moves the
files into place. A folder flight comes in as an uploaded one; a job left running comes in as canceled.
"""
import errno
import json
import os
import re
import secrets
import shutil
import tarfile
import threading
import time

from django.conf import settings
from django.core.exceptions import SuspiciousFileOperation
from django.core.exceptions import ValidationError as ModelValidationError
from django.db import IntegrityError, transaction

from . import backup
from .models import Finding, Project, ThermalConversion, ThermalDataset, ThermalMeasurement, VideoFrame
from .raster.security import path_traversal_check

BLOCK = tarfile.BLOCKSIZE
MAX_MANIFEST = 256 * 1024 * 1024
MAX_HEADER = 1024 * 1024
ABANDONED = 3600                # seconds an import nobody sends to is kept
FILE = re.compile(r'^datasets/([0-9]+)/(images|conversions/([0-9]+)|video-frames)/(.+)$')
WINDOWS = os.name == 'nt'
REFUSED_ON_WINDOWS = '<>:"|?*'                 # in a file name made on another system
CANT_KEEP = "This computer can't keep one of the archive's files: {} ({})"


DISK_FULL = "The disk is full: free some space and try again"


class RestoreError(Exception):
    """Why an archive cannot be imported, as the dialog says it"""


def imports_dir():
    return os.path.join(settings.DATA_DIR, 'imports')


def clear_imports():
    """Removes the imports a closed server left half way"""
    shutil.rmtree(imports_dir(), ignore_errors=True)


def free_name(name):
    """The name, or the first "name (2)", "name (3)"... that no project has"""
    taken = set(Project.objects.values_list('name', flat=True))
    if name not in taken:
        return name
    m = re.match(r'^(.*) \(([0-9]+)\)$', name)
    base, n = (m.group(1), int(m.group(2)) + 1) if m else (name, 2)
    while True:
        suffix = " ({})".format(n)
        candidate = base[:255 - len(suffix)] + suffix
        if candidate not in taken:
            return candidate
        n += 1


def check_manifest(m):
    """The manifest, checked enough to make rows from: its format and version, and the shape of its rows"""
    if not isinstance(m, dict) or m.get('format') != backup.FORMAT:
        raise RestoreError("This is not a project exported by dji-thermal-ui")
    if not isinstance(m.get('version'), int) or m['version'] > backup.VERSION:
        raise RestoreError("This project was exported by a newer dji-thermal-ui ({}): update this one to import it"
                          .format(m.get('app') or "unknown version"))
    def rows(value):
        if not isinstance(value, list) or not all(isinstance(r, dict) and isinstance(r.get('id'), int) for r in value):
            raise RestoreError("The archive's manifest is damaged")
        return value
    if not isinstance(m.get('project'), dict) or not str(m['project'].get('name') or '').strip():
        raise RestoreError("The archive's manifest is damaged")
    for f in rows(m.get('flights')):
        for c in rows(f.get('conversions', [])):
            rows(c.get('measurements', []))
        rows(f.get('findings', []))
        rows(f.get('video_frames', []))
    return m


def summary(m):
    """What the import dialog shows of an archive"""
    name = str(m['project']['name']).strip()[:255]
    return {
        'name': name, 'proposed': free_name(name), 'app': m.get('app'), 'exported_at': m.get('exported_at'),
        'flights': [{'name': f.get('name'), 'file_count': f.get('file_count'), 'conversions': len(f.get('conversions', []))}
                    for f in m['flights']],
    }


class Reader:
    """A tar read as its bytes come, a piece at a time: the manifest kept, the flights' files written under folder.
    tarfile reads only a whole file, so the headers are read here (with tarfile's own parser for each block)."""

    def __init__(self, folder):
        self.folder = folder
        self.state = 'header'               # or 'data', 'end'
        self.block = bytearray()            # a header's bytes until it is whole
        self.left = 0                       # the member's data still to come
        self.pad = 0                        # then its padding
        self.member = None                  # what the data is: 'manifest', 'meta' (an extended header) or 'file'
        self.meta = bytearray()
        self.out = None
        self.pax = {}                       # what the next header's extended header says
        self.manifest = None
        self.zeros = 0
        self.files = {}                     # flight id: its conversions' ids, from the manifest

    def feed(self, data):
        view = memoryview(data)
        while view:
            if self.state == 'end':
                if any(view):
                    raise RestoreError("The archive has data after its end")
                return
            if self.state == 'header':
                take = min(BLOCK - len(self.block), len(view))
                self.block += view[:take]
                view = view[take:]
                if len(self.block) == BLOCK:
                    self.header(bytes(self.block))
                    self.block.clear()
                continue
            if self.left:
                take = min(self.left, len(view))
                self.data(view[:take])
                self.left -= take
                view = view[take:]
                if not self.left:
                    self.done()
                continue
            take = min(self.pad, len(view))
            self.pad -= take
            view = view[take:]
            if not self.pad:
                self.state = 'header'

    def header(self, block):
        if not any(block):
            self.zeros += 1
            if self.zeros == 2:
                self.state = 'end'
            return
        if self.zeros:
            raise RestoreError("The archive is damaged")
        try:
            info = tarfile.TarInfo.frombuf(block, 'utf-8', 'surrogateescape')
        except tarfile.HeaderError:
            raise RestoreError("This is not a tar archive, or it is damaged") from None
        name = self.pax.pop('path', info.name)
        size = int(self.pax.pop('size', info.size))
        self.pax = {}
        if info.type in (tarfile.XHDTYPE, tarfile.XGLTYPE, tarfile.GNUTYPE_LONGNAME):
            if size > MAX_HEADER:
                raise RestoreError("The archive is damaged")
            self.member = ('meta', info.type)
        elif self.manifest is None:
            if name != backup.MANIFEST or not info.isreg():
                raise RestoreError("This is not a project exported by dji-thermal-ui: it does not start with its manifest")
            if size > MAX_MANIFEST:
                raise RestoreError("The archive's manifest is too large")
            self.member = ('manifest', None)
        elif info.isdir():
            self.member = ('skip', None)
        elif info.isreg():
            self.member = ('file', None)
            path = self.destination(name)
            try:
                self.out = open(path, 'wb')
            except OSError as e:                   # a name or path this system refuses (Windows: too long...)
                raise RestoreError(CANT_KEEP.format(name, e.strerror)) from None
        else:
            raise RestoreError("The archive holds a link or a special file: {}".format(name))
        self.meta.clear()
        self.left, self.pad = size, -size % BLOCK
        self.state = 'data'
        if not size:
            self.done()

    def destination(self, name):
        """Where a flight's file goes, refused unless it is one of the manifest's flights' and stays in its folder"""
        m = FILE.match(name)
        flight = m and int(m.group(1))
        if not m or flight not in self.files or m.group(3) and int(m.group(3)) not in self.files[flight] or \
                any(p in ('', '.', '..') for p in m.group(4).split('/')):
            raise RestoreError("The archive holds a file that is not its flights': {}".format(name))
        if WINDOWS and any(ch in REFUSED_ON_WINDOWS for ch in m.group(4)):
            raise RestoreError(CANT_KEEP.format(name, "a character Windows refuses in a file name"))
        try:
            path = path_traversal_check(os.path.join(self.folder, *name.split('/')), self.folder)
        except SuspiciousFileOperation:
            raise RestoreError("The archive holds a file that is not its flights': {}".format(name)) from None
        if os.path.exists(path):                   # Windows and macOS: two names that differ only in case
            raise RestoreError("The archive holds two files this computer can't keep apart: {}".format(name))
        os.makedirs(os.path.dirname(path), exist_ok=True)
        return path

    def data(self, chunk):
        kind = self.member[0]
        if kind == 'file':
            try:
                self.out.write(chunk)
            except OSError as e:
                if e.errno != errno.ENOSPC:
                    raise
                raise RestoreError(DISK_FULL) from None
        elif kind != 'skip':
            self.meta += chunk

    def done(self):
        kind, what = self.member
        if kind == 'file':
            self.out.close()
            self.out = None
        elif kind == 'manifest':
            try:
                m = json.loads(bytes(self.meta).decode('utf-8'))
            except ValueError:
                raise RestoreError("The archive's manifest is damaged") from None
            self.manifest = check_manifest(m)
            self.files = {f['id']: {c['id'] for c in f.get('conversions', [])} for f in m['flights']}
        elif kind == 'meta' and what == tarfile.XHDTYPE:
            self.pax = pax_records(bytes(self.meta))
        elif kind == 'meta' and what == tarfile.GNUTYPE_LONGNAME:
            self.pax = {'path': bytes(self.meta).rstrip(b'\0').decode('utf-8', 'surrogateescape')}
        self.meta.clear()
        self.member = None
        self.state = 'data' if self.pad else 'header'

    def whole(self):
        """Whether the archive was read to its end (a tar's closing zeros are not always there)"""
        return self.manifest is not None and (self.state == 'end' or self.state == 'header' and not self.block)

    def close(self):
        if self.out:
            self.out.close()
            self.out = None


def pax_records(data):
    """An extended header's path and size (records of "<length> <key>=<value>\\n")"""
    out, i = {}, 0
    while i < len(data):
        space = data.index(b' ', i)
        length = int(data[i:space])
        key, _eq, value = data[space + 1:i + length - 1].partition(b'=')
        if key in (b'path', b'size'):
            out[key.decode()] = value.decode('utf-8', 'surrogateescape')
        i += length
    return out


class Import:
    """One archive being sent: its bytes so far, unpacked into its staging folder"""

    def __init__(self, size):
        self.id = secrets.token_hex(8)
        self.size = size
        self.received = 0
        self.folder = os.path.join(imports_dir(), self.id)
        os.makedirs(self.folder)
        self.reader = Reader(self.folder)
        self.lock = threading.Lock()
        self.touched = time.time()

    def remove(self):
        self.reader.close()
        shutil.rmtree(self.folder, ignore_errors=True)


IMPORTS = {}
IMPORTS_LOCK = threading.Lock()


def start(size):
    """A new import of an archive of size bytes (those nobody sent to for an hour are dropped)"""
    with IMPORTS_LOCK:
        for old in [i for i in IMPORTS.values() if time.time() - i.touched > ABANDONED]:
            IMPORTS.pop(old.id).remove()
        i = Import(size)
        IMPORTS[i.id] = i
        return i


def get(import_id):
    with IMPORTS_LOCK:
        return IMPORTS.get(import_id)


def discard(i):
    with IMPORTS_LOCK:
        IMPORTS.pop(i.id, None)
    with i.lock:
        i.remove()


def receive(i, offset, stream, length):
    """Reads a piece of the archive starting at offset; a piece sent again is read from where the last one stopped.
    Returns False when offset is past what was received (a piece is missing)."""
    with i.lock:
        if offset > i.received:
            return False
        skip = i.received - offset
        left = length
        while left > 0:
            chunk = stream.read(min(backup.CHUNK, left))
            if not chunk:
                break
            left -= len(chunk)
            if skip >= len(chunk):
                skip -= len(chunk)
                continue
            chunk = chunk[skip:]
            skip = 0
            if i.received + len(chunk) > i.size:
                raise RestoreError("The archive is longer than it said")
            i.reader.feed(chunk)
            i.received += len(chunk)
        i.touched = time.time()
        return True


def fields(model, row, **override):
    """A row's stored fields that the model has, without its id, and those given"""
    names = {f.attname for f in model._meta.concrete_fields if not f.primary_key}
    out = {k: v for k, v in row.items() if k in names}
    out.update(override)
    return out


def made(model, row, **override):
    obj = model(**fields(model, row, **override))
    obj.full_clean(validate_unique=False)
    obj.save()
    return obj


def remap(ids, mapping):
    return sorted(mapping[i] for i in ids if i in mapping)


def finish(i, name):
    """The import made into a new project named name (one no project has): its rows with new ids, its files moved
    into the data folder. Returns the project."""
    with i.lock:
        if i.received != i.size or not i.reader.whole():
            raise RestoreError("The archive has not all been received")
        project = make_project(i.reader.manifest, i.folder, name)
    discard(i)
    return project


def make_project(m, folder, name, keep_folders=False):
    """A manifest made into a new project named name: its rows with new ids, its flights' files moved from
    folder/datasets/<old id>/ into the data folder. A folder flight comes in as an uploaded one, unless keep_folders
    (its folder still read in place). A failure moves the files back to where they were. Returns the project."""
    moved = []                                  # (where a folder went, where it was), undone in reverse
    os.makedirs(settings.DATASETS_DIR, exist_ok=True)

    def rename(old, new):
        os.rename(old, new)
        moved.append((new, old))

    def undo():
        for new, old in reversed(moved):
            try:
                os.rename(new, old)
            except OSError:
                pass

    try:
        with transaction.atomic():
            if Project.objects.filter(name=name).exists():
                raise RestoreError("A project is already named “{}”".format(name))
            p = m['project']
            project = made(Project, {k: p[k] for k in ('description', 'location_lon', 'location_lat',
                                                       'location_label') if k in p}, name=name)
            for f in m['flights']:
                in_place = keep_folders and f.get('source') == 'folder' and f.get('folder')
                d = made(ThermalDataset, f, project_id=project.id, source='folder' if in_place else 'upload',
                         folder=f['folder'] if in_place else "", run_id="",
                         status='canceled' if f.get('status') == 'analyzing' else f.get('status', 'new'))
                staged = os.path.join(folder, 'datasets', str(f['id']))
                if os.path.isdir(staged):
                    rename(staged, d.data_dir())
                conversions, measurements = {}, {}
                for c in f.get('conversions', []):
                    conv = made(ThermalConversion, c, dataset_id=d.id, run_id="",
                                status='canceled' if c.get('status') == 'converting' else c.get('status', 'ready'),
                                mosaic_status='canceled' if c.get('mosaic_status') == 'building'
                                else c.get('mosaic_status', ''),
                                # Its WebODM tasks aren't carried over: the orthophoto and DSM are kept, not their link
                                orthophoto=dict(c['orthophoto'], task=None) if c.get('orthophoto') else {},
                                dsm=dict(c['dsm'], task=None) if c.get('dsm') else {})
                    conversions[c['id']] = conv
                    old = os.path.join(d.data_dir(), 'conversions', str(c['id']))
                    if os.path.isdir(old):
                        rename(old, old + '.import')
                    for mm in c.get('measurements', []):
                        measurements[mm['id']] = made(ThermalMeasurement, mm, conversion_id=conv.id).id
                # The conversions' folders renamed in two steps: an old id may be another's new one
                for old_id, conv in conversions.items():
                    old = os.path.join(d.data_dir(), 'conversions', str(old_id)) + '.import'
                    if os.path.isdir(old):
                        rename(old, conv.data_dir())
                findings = {}
                for x in f.get('findings', []):
                    c = conversions.get(x.get('conversion_id'))
                    findings[x['id']] = made(Finding, x, dataset_id=d.id, conversion_id=c and c.id).id
                # A saved video frame's pictures are named by its key, so they stay where they came
                for x in f.get('video_frames', []):
                    if not re.match(r'^[0-9a-f]{1,32}$', str(x.get('key'))):
                        raise ValueError(x.get('key'))
                    made(VideoFrame, x, dataset_id=d.id, finding_id=findings.get(x.get('finding_id')))
                # A mosaic report names the measurements it leaves out and the findings it hides
                for conv in conversions.values():
                    report = dict(conv.report or {})
                    if 'left_out' in report:
                        report['left_out'] = remap(report['left_out'], measurements)
                    if isinstance(report.get('view'), dict) and 'hidden' in report['view']:
                        report['view'] = dict(report['view'], hidden=remap(report['view']['hidden'], findings))
                    conv.report = report
                    conv.update_size()
                    conv.save(update_fields=['report', 'file_count', 'size'])
                d.update_size()
                d.save(update_fields=['file_count', 'size'])
    except (ModelValidationError, IntegrityError, TypeError, ValueError, KeyError, AttributeError):
        undo()
        raise RestoreError("The archive's manifest is damaged") from None
    except OSError as e:
        undo()
        raise RestoreError("Could not move the files into the data folder: {}".format(e)) from None
    except BaseException:
        undo()
        raise
    return project
