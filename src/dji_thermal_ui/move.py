"""Moving the data folder (the Storage page). The database cannot change under a running server, so the page only
asks: the move is written as a plan in the config folder, the server restarts itself, and the new process moves the
files before it opens the database (perform()), then imports the projects chosen from what the target held
(analyzer/storage.import_replaced). What the target held is set aside in replaced-<date>/ there, nothing deleted.

No Django here: perform() runs before it is set up.
"""

import _thread
import datetime
import json
import os
import shutil
import sqlite3
import tempfile
import threading
import time
from pathlib import Path

from . import datadir

PLAN = "move.json"
RESULT = "move-result.json"
DATABASE = "db.sqlite3"
SET_ASIDE = "replaced-"
MIGRATIONS = Path(__file__).resolve().parent / "analyzer" / "migrations"

# Set when the page asked for a move: the command restarts once the server has closed (SERVING: it is serving)
RESTART = threading.Event()
SERVING = False


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


def existing(path):
    """The path, or its nearest parent that exists"""
    path = Path(path)
    while not path.exists() and path.parent != path:
        path = path.parent
    return path


def inside(path, folder):
    """Whether path is folder or inside it"""
    return path == folder or folder in path.parents


def drive(path):
    """The drive a path is on (st_dev): a rename stays on one"""
    return os.stat(path).st_dev


def database_of(folder):
    """What a data folder's database says, read only: {projects: [{id, name, flights, size}], newer}; newer: it was
    made by a dji-thermal-ui with migrations this one does not have. Raises sqlite3.Error."""
    con = sqlite3.connect(Path(folder, DATABASE).as_uri() + "?mode=ro", uri=True)
    try:
        projects = con.execute("SELECT id, name FROM analyzer_project ORDER BY name, id").fetchall()
        flights = con.execute("SELECT id, project_id FROM analyzer_thermaldataset").fetchall()
        applied = {n for (n,) in con.execute("SELECT name FROM django_migrations WHERE app = 'analyzer'")}
    finally:
        con.close()
    known = {p.stem for p in MIGRATIONS.glob("[0-9]*.py")}
    out = []
    for pid, name in projects:
        ids = [f for f, p in flights if p == pid]
        out.append({'id': pid, 'name': name, 'flights': len(ids),
                    'size': sum(folder_size(Path(folder, "datasets", str(f)))[0] for f in ids)})
    return {'projects': out, 'newer': bool(applied - known)}


def is_data_folder(folder):
    return Path(folder, DATABASE).is_file()


def inspect(target, source):
    """What moving the data folder source to target would do, and what stops it: {path, kind ('new', 'empty' or
    'data'; 'other' or 'file' refused), same_drive, needed, free, projects, problems}"""
    out = {'path': str(target), 'kind': None, 'same_drive': False, 'needed': 0, 'free': None, 'projects': [],
           'problems': []}
    problems = out['problems']
    if not str(target).strip() or not Path(target).expanduser().is_absolute():
        problems.append("Type the folder's full path.")
        return out
    target = Path(os.path.abspath(Path(target).expanduser()))
    source = Path(source).resolve()
    out['path'] = str(target)
    if target.exists():
        target = target.resolve()
        out['path'] = str(target)
    if inside(target, source):
        problems.append("That is the data folder, or a folder inside it.")
        return out
    if inside(source, target):
        problems.append("The data folder is inside that folder: choose one outside it.")
        return out
    if target.exists() and not target.is_dir():
        out['kind'] = 'file'
        problems.append("That is a file, not a folder.")
        return out
    if not target.exists():
        out['kind'] = 'new'
    elif is_data_folder(target):
        out['kind'] = 'data'
    elif not any(target.iterdir()):
        out['kind'] = 'empty'
    else:
        out['kind'] = 'other'
        problems.append("That folder holds other files: choose an empty folder, a new one, or another data folder "
                        "of this app.")
        return out

    parent = existing(target)
    try:
        fd, probe = tempfile.mkstemp(dir=parent, prefix=".dji-thermal-ui-")
        os.close(fd)
        os.unlink(probe)
    except OSError as e:
        problems.append("That folder cannot be written to: {}".format(e.strerror or e))
        return out
    out['same_drive'] = drive(parent) == drive(source)
    out['free'] = shutil.disk_usage(parent).free
    if not out['same_drive']:
        out['needed'] = sum(folder_size(e)[0] if e.is_dir() else e.stat().st_size
                            for e in source.iterdir() if e.name != "imports")
        if out['needed'] > out['free']:
            problems.append("There is not enough room on that drive.")
    if out['kind'] == 'data':
        try:
            db = database_of(target)
        except sqlite3.Error as e:
            problems.append("Its database could not be read: {}".format(e))
            return out
        out['projects'] = db['projects']
        if db['newer']:
            problems.append("Its database was made by a newer dji-thermal-ui: update this one first.")
    return out


def config_file(name):
    return datadir.config_dir() / name


def read_json(name):
    try:
        return json.loads(config_file(name).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def write_json(name, value):
    f = config_file(name)
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(value, indent=1), encoding="utf-8")


def forget(name):
    config_file(name).unlink(missing_ok=True)


def write_plan(source, target, projects):
    write_json(PLAN, {'from': str(source), 'to': str(target), 'projects': list(projects), 'asked_at': time.time()})


def take_plan():
    """The move asked, removed so that a move that stops half way is never tried again"""
    plan = read_json(PLAN)
    forget(PLAN)
    return plan


def read_result():
    return read_json(RESULT)


def request_restart(delay=0.5):
    """Restarts the server once the page has its answer: the main thread is interrupted, as by Ctrl+C"""
    RESTART.set()
    if SERVING:
        threading.Timer(delay, _thread.interrupt_main).start()


def set_aside_name(target):
    """replaced-<date>, or replaced-<date>-2... when that is taken"""
    base = SET_ASIDE + datetime.date.today().isoformat()
    name, n = base, 2
    while (target / name).exists():
        name, n = "{}-{}".format(base, n), n + 1
    return target / name


def copy(src, dst):
    if src.is_dir() and not src.is_symlink():
        shutil.copytree(src, dst, symlinks=True)
    else:
        shutil.copy2(src, dst, follow_symlinks=False)


def remove(path):
    if path.is_dir() and not path.is_symlink():
        shutil.rmtree(path)
    else:
        path.unlink()


def perform(plan):
    """Moves the data folder as planned, before the database is opened: what the target held set aside in
    replaced-<date>/ there, then the folder's files moved (renamed on the same drive, else copied, then removed),
    then the pointer written. A move that fails is undone. Returns the result the Storage page shows."""
    source, target = Path(plan['from']), Path(plan['to'])
    result = {'state': 'failed', 'from': str(source), 'to': str(target), 'replaced': None, 'at': time.time(),
              'imported': [], 'error': None}
    info = inspect(target, source)
    if info['problems']:
        result['error'] = " ".join(info['problems'])
        return result
    target = Path(info['path'])
    undo, copied, made = [], [], not target.exists()
    try:
        target.mkdir(parents=True, exist_ok=True)
        if info['kind'] == 'data':
            replaced = set_aside_name(target)
            replaced.mkdir()
            result['replaced'] = str(replaced)
            for e in sorted(target.iterdir()):
                if e != replaced and not e.name.startswith(SET_ASIDE):
                    e.rename(replaced / e.name)
                    undo.append((replaced / e.name, e))
        shutil.rmtree(source / "imports", ignore_errors=True)
        entries = sorted(source.iterdir())
        if info['same_drive']:
            for e in entries:
                e.rename(target / e.name)
                undo.append((target / e.name, e))
        else:
            for e in entries:
                copied.append(target / e.name)
                copy(e, target / e.name)
    except OSError as e:
        for p in reversed(copied):
            if p.exists() or p.is_symlink():
                shutil.rmtree(p, ignore_errors=True) if p.is_dir() else p.unlink(missing_ok=True)
        for now, was in reversed(undo):
            now.rename(was)
        if result['replaced']:
            Path(result['replaced']).rmdir()
        if made:
            shutil.rmtree(target, ignore_errors=True)
        result.update(replaced=None, error="Could not move the files: {}".format(e))
        return result
    if not info['same_drive']:
        for e in entries:                       # copied whole: the originals go
            remove(e)
    datadir.set_pointer(target)
    try:
        source.rmdir()
    except OSError:
        pass
    result.update(state='moved')
    return result
