"""
Converting a thermal dataset with dji-thermal-cli's process: the settings a user can choose (checked here, kept on the
conversion and as the user's saved preferences), and the conversion itself, run on the job runner
(jobs.py).

Settings are kept as JSON: dji-thermal-cli's Settings fields (None keeps each image's own embedded value), plus the
outputs, the compression, normalization, the nadir-only pitch limit and whether to build the mosaics
(thermal_mosaics).
"""
import math
import os
import time

from django.conf import settings
from django.utils import timezone

from .thermal_analysis import Canceled, clean, relative, PROGRESS_INTERVAL

UNITS = ('C', 'F', 'K')
COMPRESSIONS = ('deflate', 'none')

# dji-thermal-cli's own defaults (Settings(), process()), what "Reset to defaults" goes back to
DEFAULTS = {
    'distance': 'lrf',
    'humidity': None,
    'emissivity': None,
    'reflected_temp': None,
    'ambient_temp': None,
    'unit': 'C',
    'range_min': None,
    'range_max': None,
    'palette': None,
    'gimbal_yaw': None,
    'gimbal_pitch': None,
    'gimbal_roll': None,
    'replace_above': None,
    'replace_above_value': None,
    'replace_below': None,
    'replace_below_value': None,
    'strip_location': False,
    'normalize': False,
    'max_pitch': None,
    'outputs': ['temp_c:tiff', 'pseudo:png'],
    'compression': 'deflate',
    'mosaics': True,        # the app's own: build the mosaics after the images
    'visual': True,         # the app's own: and the visual mosaic with them, when the dataset has visual frames
}

# (low, high) of the numbers; the camera's own limits are narrower and are checked per image when converting
LIMITS = {
    'distance': (0.1, 1000.0),
    'humidity': (0.0, 100.0),
    'emissivity': (0.1, 1.0),
    'gimbal_yaw': (-360.0, 360.0),
    'gimbal_pitch': (-180.0, 180.0),
    'gimbal_roll': (-180.0, 180.0),
    'max_pitch': (-90.0, 90.0),
}
# In the chosen unit: checked by dji-thermal-cli's Settings (above absolute zero, ranges in order)
TEMPERATURES = ('reflected_temp', 'ambient_temp', 'range_min', 'range_max', 'replace_above', 'replace_below')
SETTINGS_FIELDS = ('distance', 'humidity', 'emissivity', 'reflected_temp', 'ambient_temp', 'unit', 'range_min',
                   'range_max', 'palette', 'gimbal_yaw', 'gimbal_pitch', 'gimbal_roll', 'replace_above',
                   'replace_above_value', 'replace_below', 'replace_below_value', 'strip_location')


def products():
    """The outputs dji-thermal-cli can write: [{product, description, formats}]"""
    from dji_thermal_cli import outputs
    return [{'product': name, 'description': p.description, 'formats': list(p.formats)}
            for name, p in outputs.PRODUCTS.items()]


def palettes():
    from dji_thermal_cli import api
    return list(api.PALETTES)


def blank(value):
    return value is None or (isinstance(value, str) and value.strip() == "")


def number(value):
    """A finite float, or raises ValueError"""
    if isinstance(value, bool):
        raise ValueError()
    n = float(value)
    if not math.isfinite(n):
        raise ValueError()
    return n


def parse_settings(raw):
    """
    :param raw: the settings as sent ({field: value}, missing fields take the defaults; "" keeps the embedded value)
    :return: (settings, errors): the settings checked and complete (as DEFAULTS), and {field: message} for the ones
        that are not valid (empty when all are)
    """
    raw = raw if isinstance(raw, dict) else {}
    out, errors = dict(DEFAULTS), {}

    def get(field):
        return raw.get(field, DEFAULTS[field])

    distance = get('distance')
    if distance in ('lrf', 'embedded'):
        out['distance'] = distance
    elif blank(distance):
        out['distance'] = 'lrf'
    else:
        try:
            out['distance'] = number(distance)
        except (TypeError, ValueError):
            errors['distance'] = "The distance is the rangefinder's, the embedded one, or a number of metres"

    unit = str(get('unit') or 'C').upper()
    if unit in UNITS:
        out['unit'] = unit
    else:
        errors['unit'] = "The unit is C, F or K"

    for field in ('humidity', 'emissivity', 'gimbal_yaw', 'gimbal_pitch', 'gimbal_roll', 'max_pitch') + TEMPERATURES:
        value = get(field)
        if blank(value):
            out[field] = None
            continue
        try:
            out[field] = number(value)
        except (TypeError, ValueError):
            errors[field] = "Not a number"

    for field, (low, high) in LIMITS.items():
        value = out.get(field)
        if isinstance(value, float) and field not in errors and not (low <= value <= high):
            errors[field] = "Between {:g} and {:g}".format(low, high)

    for side in ('above', 'below'):
        field = 'replace_{}_value'.format(side)
        value = get(field)
        if blank(value):
            out[field] = None
        elif isinstance(value, str) and value.strip().lower() == 'nodata':
            out[field] = 'nodata'
        else:
            try:
                out[field] = number(value)
            except (TypeError, ValueError):
                errors[field] = "A temperature, or no data"

    palette = get('palette')
    if blank(palette):
        out['palette'] = None
    elif palette in palettes():
        out['palette'] = palette
    else:
        errors['palette'] = "Not one of dji-thermal-cli's palettes"

    out['strip_location'] = bool(get('strip_location'))
    out['normalize'] = bool(get('normalize'))
    out['mosaics'] = bool(get('mosaics'))
    out['visual'] = bool(get('visual'))

    compression = get('compression')
    if compression in COMPRESSIONS:
        out['compression'] = compression
    else:
        errors['compression'] = "deflate or none"

    wanted = get('outputs')
    allowed = {p['product']: p['formats'] for p in products()}
    if not isinstance(wanted, (list, tuple)) or not wanted:
        errors['outputs'] = "Choose at least one output"
    else:
        chosen = []
        for spec in wanted:
            product, _, fmt = str(spec).partition(':')
            fmt = 'tiff' if fmt == 'tif' else fmt
            if product not in allowed or (fmt and fmt not in allowed[product]):
                errors['outputs'] = "{} is not an output dji-thermal-cli writes".format(spec)
                break
            spec = '{}:{}'.format(product, fmt or allowed[product][0])
            if spec not in chosen:
                chosen.append(spec)
        out['outputs'] = chosen

    if not errors:
        # What dji-thermal-cli itself checks: a range given whole and in order, replacements with their value,
        # temperatures above absolute zero
        from dji_thermal_cli import api
        try:
            api.Settings(**{f: out[f] for f in SETTINGS_FIELDS})
        except api.SettingsError as e:
            errors['settings'] = str(e)
    return out, errors


def summary_text(s):
    """A short description of a conversion's settings, for its default name and the list"""
    parts = [', '.join(o.replace(':', ' ') for o in s.get('outputs') or [])]
    if s.get('normalize'):
        parts.append('normalized')
    if s.get('max_pitch') is not None:
        parts.append('pitch ≤ {:g}°'.format(s['max_pitch']))
    changed = [f for f in ('distance', 'humidity', 'emissivity', 'reflected_temp', 'ambient_temp')
               if s.get(f) != DEFAULTS[f]]
    if changed:
        parts.append('measurement: ' + ', '.join(f.replace('_', ' ') for f in changed))
    if s.get('palette'):
        parts.append(s['palette'])
    if s.get('mosaics'):
        parts.append('mosaics')
    return ' · '.join(p for p in parts if p)


def api_arguments(s):
    """The keyword arguments of dji-thermal-cli's api.process for these settings (checked by parse_settings)"""
    from dji_thermal_cli import api
    return {
        'settings': api.Settings(**{f: s[f] for f in SETTINGS_FIELDS}),
        'outputs': tuple(s['outputs']),
        'compression': s['compression'],
        'normalize': bool(s['normalize']),
        'max_pitch': s['max_pitch'],
    }


def compact(report, root, out_dir):
    """What a conversion keeps of api.process's report: {files, converted, skipped, normalization, version}"""
    files = []
    offsets = report.normalization.offsets_c if report.normalization is not None else {}
    for r in report.results:
        files.append({
            'path': relative(r.src, root),
            'ok': bool(r.ok),
            'reason': r.reason or "",
            'outputs': [relative(p, out_dir) for p in (r.outputs or [])],
            'notes': list(r.notes or []),
            'distance': r.distance,
            'distance_source': r.distance_source or "",
            # What normalizing subtracted from the frame (°C), for the frame page to measure it as converted
            'offset_c': offsets.get(r.src),
        })
    files.sort(key=lambda f: f['path'])
    norm = None
    if report.normalization is not None:
        n = report.normalization
        offsets = list(n.offsets_c.values())
        norm = {'ambient_c': n.ambient_c, 'reflected_c': n.reflected_c, 'frames': n.frames,
                'without_offset': n.without_offset,
                'offset_min': min(offsets) if offsets else None, 'offset_max': max(offsets) if offsets else None}
    try:
        from dji_thermal_cli import __version__ as version
    except ImportError:
        version = ""
    converted = sum(1 for f in files if f['ok'])
    return clean({'files': files, 'converted': converted, 'skipped': len(files) - converted,
                  'normalization': norm, 'version': version})


def mosaic_stage(event, **extra):
    """A dji-thermal-cli "mosaic" event as the pages show it: the stage, its step of steps (round of rounds while
    aligning), done of total in its unit; with extra (which mosaic it is)"""
    keys = ('stage', 'step', 'steps', 'round', 'rounds', 'done', 'total', 'unit')
    return dict({k: event.data[k] for k in keys if k in event.data}, **extra)


def stage_key(event):
    """What changes when a new stage (or an alignment round, or its solve) starts: its first event is written at once"""
    return event.data['stage'], event.data.get('round'), event.data['unit']


def stage_fraction(d):
    """How far a run of stages is, 0 to 1, each step counting the same; within an alignment round, measuring its
    pairs is the first half and the solve the second"""
    part = min(1.0, d['done'] / d['total']) if d['total'] else 0.0
    if 'round' in d:
        part = (d['round'] - 1 + (0.5 + part / 2 if d['unit'] == 'solve steps' else part / 2)) / d['rounds']
    return (d['step'] - 1 + part) / d['steps']


def convert(conversion_id, run_id):
    """
    Converts a dataset's images with a conversion's settings, into the conversion's folder. Writes only while the
    conversion's run is still run_id: canceling or deleting it changes that, and this run stops at its next progress
    write.
    """
    from .models import ThermalConversion
    from dji_thermal_cli import api

    run = ThermalConversion.objects.filter(pk=conversion_id, run_id=run_id)
    conversion = run.select_related('dataset').first()
    if conversion is None:
        return {'canceled': True}
    dataset = conversion.dataset
    root, out_dir = dataset.images_dir(), conversion.data_dir()

    try:
        if not os.path.isdir(root):
            raise Exception("The folder {} does not exist".format(root)
                            if dataset.source == 'folder' else "The dataset has no images")
        args = api_arguments(conversion.options)
        # Each image is reported once when it is written. Normalizing first compares the frames' overlaps, stage by
        # stage: the page shows the stage while the progress is 0
        total = max(1, len(api.scan(root).jpegs))
        state = {'done': 0, 'written': time.time(), 'stage': None}

        def write(now, **fields):
            t = time.time()
            if now or t - state['written'] >= PROGRESS_INTERVAL:
                state['written'] = t
                if not run.update(**fields):
                    raise Canceled()

        def progress(event):
            if event.kind == 'mosaic':
                key = stage_key(event)
                write(key != state['stage'], stage=mosaic_stage(event))
                state['stage'] = key
            elif event.kind == 'file':
                state['done'] += 1
                write(state['stage'] is not None, progress=min(0.99, state['done'] / total), stage={})
                state['stage'] = None

        report = api.process(root, out_dir, jobs=settings.THERMAL_PROCESSES, progress=progress, **args)
        results = compact(report, root, out_dir)
    except Canceled:
        return {'canceled': True}
    except Exception as e:
        conversion.update_size()
        run.update(status='failed', error=str(e), progress=0, stage={}, run_id="", file_count=conversion.file_count,
                   size=conversion.size, finished_at=timezone.now())
        return {'error': str(e)}

    conversion.update_size()
    status = 'ready' if results['converted'] else 'failed'
    error = "" if results['converted'] else "No image could be converted: see each image's reason"
    mosaics = status == 'ready' and bool(conversion.options.get('mosaics'))
    # The images can be downloaded while the mosaics are built: the run goes on (same run_id) for them
    if not run.update(status=status, error=error, progress=1.0, stage={}, results=results,
                      file_count=conversion.file_count,
                      size=conversion.size, run_id=run_id if mosaics else "", finished_at=timezone.now(),
                      **({'mosaic_status': 'building', 'mosaic_progress': 0, 'mosaic_error': ""} if mosaics else {})):
        return {'canceled': True}
    out = {'converted': results['converted']}
    if mosaics:
        from . import thermal_mosaics
        out.update(thermal_mosaics.finish(conversion, run))
    return out
