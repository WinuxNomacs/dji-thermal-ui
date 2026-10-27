"""
A thermal dataset's analysis: dji-thermal-cli's check (with the WebODM plan) over its images, kept on the dataset as
a compact record: a row per file, the cameras, the problems found and the plan. Runs on the job runner (jobs.py).
"""
import dataclasses
import datetime
import math
import os
import re
import time
from collections import Counter

from django.conf import settings
from django.utils import timezone

PROGRESS_INTERVAL = 1.0     # seconds between progress writes (each also checks the run is still wanted)
ZONE_STEP = 15              # minutes: time zones' offsets are whole quarter hours, the camera's two clocks are not
MAX_OFFSET = 14 * 60        # minutes: no time zone is further from UTC
TIME = re.compile(r'^(\d{4})[:-](\d\d)[:-](\d\d)[ T](\d\d):(\d\d):(\d\d(?:\.\d+)?)')


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
        'utc': cam.get('utc_at_exposure') or "",
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


def flight_area(analysis):
    """Where a dataset's thermal frames were taken: the convex hull of their positions as a closed lon/lat ring, or
    None without three positions apart"""
    points = sorted({(r['lon'], r['lat']) for r in (analysis or {}).get('files') or []
                     if r.get('kind') == 'thermal' and r.get('lon') is not None and r.get('lat') is not None})
    if len(points) < 3:
        return None

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    def half(pts):
        out = []
        for p in pts:
            while len(out) >= 2 and cross(out[-2], out[-1], p) <= 0:
                out.pop()
            out.append(p)
        return out[:-1]

    hull = half(points) + half(points[::-1])
    if len(hull) < 3:
        return None
    return [list(p) for p in hull + hull[:1]]


def recorded_time(text):
    """A time as a frame records it ("2026:10:22 16:34:57", or "2026-10-22T21:35:16.504449"), without its zone; None
    when it is not one"""
    m = TIME.match(str(text or ""))
    if not m:
        return None
    try:
        whole = datetime.datetime(*(int(g) for g in m.groups()[:5]), int(float(m.group(6))))
    except ValueError:
        return None
    return whole + datetime.timedelta(seconds=float(m.group(6)) % 1)


def flight_zone(analysis):
    """The time zone a dataset was flown in, from its frames' two clocks: the local capture time (EXIF
    DateTimeOriginal) against DJI's UTCAtExposure, rounded to a quarter hour, the most frames' offset. {'offset':
    minutes east of UTC} or, when it is not known, {'offset': None, 'reason': why}"""
    rows = [r for r in (analysis or {}).get('files') or [] if r.get('kind') == 'thermal']
    if rows and not any('utc' in r for r in rows):
        return {'offset': None, 'reason': "Analyze the dataset again to find the time zone it was flown in"}
    offsets = Counter()
    for r in rows:
        local, utc = recorded_time(r.get('time')), recorded_time(r.get('utc'))
        if local and utc:
            minutes = round((local - utc).total_seconds() / 60 / ZONE_STEP) * ZONE_STEP
            if abs(minutes) <= MAX_OFFSET:
                offsets[minutes] += 1
    if not offsets:
        return {'offset': None, 'reason': "The images do not record the time zone they were taken in"}
    return {'offset': offsets.most_common(1)[0][0]}
