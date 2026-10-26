"""
A thermal dataset's analysis: dji-thermal-cli's check (with the WebODM plan) over its images, kept on the dataset as
a compact record: a row per file, the cameras, the problems found and the plan. Runs on the job runner (jobs.py).
"""
import dataclasses
import math
import os
import time

from django.conf import settings
from django.utils import timezone

PROGRESS_INTERVAL = 1.0     # seconds between progress writes (each also checks the run is still wanted)


class Canceled(Exception):
    pass


def clean(value):
    """JSON-safe: no NaN or infinity (JSON has neither), paths and other objects as text"""
    if isinstance(value, float):
        return value if math.isfinite(value) else None
    if isinstance(value, dict):
        return {str(k): clean(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [clean(v) for v in value]
    if value is None or isinstance(value, (bool, int, str)):
        return value
    return str(value)


def relative(path, root):
    """A file's path within the dataset, with / on every system, so the rows stay the same wherever its folder is"""
    try:
        rel = os.path.relpath(str(path), root)
    except ValueError:                             # on another drive
        return os.path.basename(str(path))
    return os.path.basename(str(path)) if rel.startswith('..') else rel.replace(os.sep, '/')


def rounded(v, digits):
    return round(v, digits) if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) else None


def file_row(report, root):
    """One file of the dataset: what it is and, for a thermal image, what the Files table shows"""
    row = {'path': relative(report.path, root), 'kind': report.status.kind, 'reason': report.status.reason or ""}
    info = report.info
    if info is None:
        try:
            row['size'] = os.path.getsize(report.path)
        except OSError:
            row['size'] = None
        return row

    f, cam, th = info.get('file', {}), info.get('camera', {}), info.get('thermal', {})
    temp, geo, att = info.get('temperature') or {}, info.get('geospatial') or {}, info.get('attitude') or {}
    params = th.get('measurement_params') or {}
    rangefinder = geo.get('rangefinder') or {}
    row.update({
        'size': f.get('size_bytes'),
        'warnings': f.get('warnings') or [],
        'model': cam.get('model') or "",
        'serial': cam.get('camera_serial') or "",
        'width': cam.get('width'),
        'height': cam.get('height'),
        'time': cam.get('capture_time') or "",
        'lat': rounded(geo.get('latitude'), 8),
        'lon': rounded(geo.get('longitude'), 8),
        'alt': rounded(geo.get('relative_altitude_m'), 2),
        'abs_alt': rounded(geo.get('absolute_altitude_m'), 2),
        'gps': geo.get('gps_status') or "",
        'pitch': rounded(att.get('gimbal_pitch'), 1),
        'yaw': rounded(att.get('gimbal_yaw'), 1),
        'tmin': rounded(temp.get('min'), 2),
        'tmax': rounded(temp.get('max'), 2),
        'tmean': rounded(temp.get('mean'), 2),
        'distance': rounded(params.get('distance'), 2),
        'lrf': rounded(rangefinder.get('distance_m'), 2),
        'emissivity': rounded(params.get('emissivity'), 3),
        'humidity': rounded(params.get('humidity'), 1),
        'reflection': rounded(params.get('reflection'), 2),
        'ambient': rounded(params.get('ambient_temp'), 2),
        'palette': (th.get('palette') or {}).get('name') or "",
    })
    return row


def cameras(rows):
    """The cameras in a dataset, by model, serial and image size, with their frame count"""
    found = {}
    for r in rows:
        if r['kind'] != 'thermal':
            continue
        key = (r.get('model'), r.get('serial'), r.get('width'), r.get('height'))
        found[key] = found.get(key, 0) + 1
    return [{'model': k[0], 'serial': k[1], 'width': k[2], 'height': k[3], 'frames': n}
            for k, n in sorted(found.items(), key=lambda kv: -kv[1])]


def compact(result, root):
    """What a dataset keeps of api.check(..., webodm=True): {summary, files, cameras, findings, webodm, version}"""
    rows = [file_row(r, root) for r in result.reports]
    for p in result.scan.others:
        rows.append({'path': relative(p, root), 'kind': 'not_jpeg', 'reason': "not a JPEG", 'size': None})
    rows.sort(key=lambda r: r['path'])

    findings = [{'severity': f.severity, 'code': f.code, 'message': f.message,
                 'files': [relative(p, root) for p in f.files], 'suggestion': f.suggestion}
                for f in result.findings]

    plan = None
    if result.webodm is not None:
        plan = dataclasses.asdict(result.webodm)
        plan.pop('findings', None)
        plan['odm_arguments'] = result.webodm.odm_arguments()

    try:
        from dji_thermal_cli import __version__ as version
    except ImportError:
        version = ""

    return clean({'summary': result.summary, 'files': rows, 'cameras': cameras(rows), 'findings': findings,
                  'webodm': plan, 'version': version})


def analyze_dataset(dataset_id, run_id):
    """
    Analyzes a dataset and keeps the result on it. Writes only while the dataset's run is still run_id: canceling,
    deleting or starting the analysis again changes it, and this run stops at its next progress write.
    """
    from .models import ThermalDataset
    from dji_thermal_cli import api

    run = ThermalDataset.objects.filter(pk=dataset_id, run_id=run_id)
    dataset = run.first()
    if dataset is None:
        return {'canceled': True}

    root = dataset.images_dir()
    try:
        if not os.path.isdir(root):
            raise Exception("The folder {} does not exist".format(root)
                            if dataset.source == 'folder' else "The dataset has no images")

        total = max(1, len(api.scan(root).jpegs))
        state = {'done': 0, 'written': time.time()}

        def progress(event):
            if event.kind != 'file':
                return
            state['done'] += 1
            now = time.time()
            if now - state['written'] >= PROGRESS_INTERVAL:
                state['written'] = now
                if not run.update(progress=min(0.99, state['done'] / total)):
                    raise Canceled()

        result = api.check(root, webodm=True, jobs=settings.THERMAL_PROCESSES, progress=progress)
        analysis = compact(result, root)
    except Canceled:
        return {'canceled': True}
    except Exception as e:
        run.update(status='failed', error=str(e), progress=0, run_id="", updated_at=timezone.now())
        return {'error': str(e)}

    dataset.update_size()
    run.update(status='ready', progress=1.0, error="", analysis=analysis, analyzed_at=timezone.now(),
               file_count=dataset.file_count, size=dataset.size, run_id="", updated_at=timezone.now())
    return {'files': dataset.file_count}
