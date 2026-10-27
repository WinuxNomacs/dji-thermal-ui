"""
The API of the Thermal Analyzer: the thermal datasets (uploaded images, or a folder on this computer), uploading their
images, their analysis in a job, their conversions (several, side by side), their mosaics (tiles and values for the
viewer), the radiometric analysis of the mosaics and frames (measuring, saved measurements, frames measured again with
other parameters) and the saved preferences (conversion settings, temperature unit).

Ported from LuxODM's thermal-analyzer plugin (commit a2a81052), without its projects and permissions: everything here
is the one user's.
"""
import colorsys
import hashlib
import io
import json
import math
import os
import shutil
import uuid
from functools import lru_cache

import numpy as np

from django.core.exceptions import SuspiciousFileOperation
from django.core.files.uploadedfile import InMemoryUploadedFile
from django.db import transaction
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from zipstream.ng import ZipStream

from . import jobs, thermal_analysis, thermal_conversion, thermal_measure, thermal_mosaics
from .downloads import download_file_response, download_file_stream
from .models import Preferences, ThermalConversion, ThermalDataset, ThermalMeasurement
from .raster.security import path_traversal_check

PREFERENCES_KEY = 'conversion_settings'
UNIT_KEY = 'unit'
DEFAULT_UNIT = 'F'
THEME_KEY = 'theme'
THEMES = ('system', 'light', 'dark')     # system: the computer's own light or dark
IMAGE_EXTENSIONS = ('.jpg', '.jpeg')
MAX_FOLDER_DEPTH = 4    # subfolders kept from an uploaded folder (e.g. thermal/, 100MEDIA/)


def get_dataset(pk):
    try:
        return ThermalDataset.objects.get(pk=pk)
    except ThermalDataset.DoesNotExist:
        raise NotFound() from None


def check_stale(item):
    """An analysis, conversion or mosaic whose job is gone (the app stopped, or the job failed) is not left running
    forever"""
    if getattr(item, 'mosaic_status', '') == 'building' and item.status != 'converting':
        if jobs.alive(item.run_id):
            return item
        message = "The mosaic job stopped before it finished"
        if type(item).objects.filter(pk=item.pk, run_id=item.run_id).update(
                mosaic_status='failed', mosaic_error=message, run_id="", mosaic_progress=0):
            item.mosaic_status, item.mosaic_error, item.run_id, item.mosaic_progress = 'failed', message, "", 0
        return item
    if item.status not in ('analyzing', 'converting') or jobs.alive(item.run_id):
        return item
    message = "The {} job stopped before it finished".format('analysis' if item.status == 'analyzing' else 'conversion')
    if type(item).objects.filter(pk=item.pk, run_id=item.run_id).update(
            status='failed', error=message, run_id="", progress=0):
        item.status, item.error, item.run_id, item.progress = 'failed', message, "", 0
    return item


def summary(dataset):
    """A dataset as the list shows it"""
    a = dataset.analysis or {}
    s = a.get('summary') or {}
    files = s.get('files') or {}
    conversions = list(dataset.conversions.all())
    # A conversion converting or a mosaic being built (a job that stopped is marked failed first)
    busy = any(check_stale(c).status == 'converting' or c.mosaic_status == 'building' for c in conversions
               if c.status == 'converting' or c.mosaic_status == 'building')
    out = {
        'id': dataset.id,
        'name': dataset.name,
        'source': dataset.source,
        'status': dataset.status,
        'progress': dataset.progress,
        'error': dataset.error,
        'file_count': dataset.file_count,
        'size': int(dataset.size * 1024 * 1024),
        'thermal': files.get('thermal', 0),
        'not_thermal': sum(n for k, n in files.items() if k != 'thermal'),
        'errors': s.get('error', 0),
        'warnings': s.get('warning', 0),
        'infos': s.get('info', 0),
        'cameras': sorted(set(c.get('model') or "" for c in a.get('cameras') or [])),
        'analyzed': bool(a),
        'conversion_count': len(conversions),
        'conversions_ready': sum(1 for c in conversions if c.status == 'ready'),
        'mosaic_count': sum(1 for c in conversions if c.mosaic_status == 'ready'),
        'measurement_count': ThermalMeasurement.objects.filter(conversion__dataset=dataset).count(),
        'busy': busy,
        'analyzed_at': dataset.analyzed_at,
        'created_at': dataset.created_at,
        # The latest of its creation, its analysis and its conversions' starts and finishes
        'last_activity': max(t for t in [dataset.created_at, dataset.analyzed_at] +
                             [t for c in conversions for t in (c.created_at, c.finished_at)] if t),
    }
    if dataset.source == 'folder':
        out['folder'] = dataset.folder
    return out


def detail(dataset):
    out = summary(dataset)
    out['analysis'] = dataset.analysis or {}
    out['conversions'] = [conversion_summary(check_stale(c)) for c in dataset.conversions.all()]
    # What the conversions' settings are compared against, to list what each one changed
    out['defaults'] = defaults()
    return out


def conversion_summary(c):
    """A conversion as the dataset's Convert tab lists it"""
    r = c.results or {}
    return {
        'id': c.id,
        'dataset': c.dataset_id,
        'name': c.name,
        'settings': c.options,
        'description': thermal_conversion.summary_text(c.options or {}),
        'status': c.status,
        'progress': c.progress,
        'error': c.error,
        'converted': r.get('converted', 0),
        'skipped': r.get('skipped', 0),
        'mosaic_status': c.mosaic_status,
        'mosaic_progress': c.mosaic_progress,
        'stage': c.stage,
        'mosaic_error': c.mosaic_error,
        'mosaic_files': sorted(f for k in (c.mosaics or {}).get('kinds', {}).values() for f in k.get('files', [])),
        'file_count': c.file_count,
        'size': int(c.size * 1024 * 1024),
        'created_at': c.created_at,
        'finished_at': c.finished_at,
    }


def conversion_detail(c):
    out = conversion_summary(c)
    out['results'] = c.results or {}
    return out


def get_conversion(pk):
    try:
        return ThermalConversion.objects.select_related('dataset').get(pk=pk)
    except ThermalConversion.DoesNotExist:
        raise NotFound() from None


def app_unit():
    """The unit temperatures are shown in (the preferences'), F when none is saved"""
    unit = Preferences.load().data.get(UNIT_KEY)
    return unit if unit in thermal_conversion.UNITS else DEFAULT_UNIT


def app_theme():
    """The pages' colours (the preferences'), the computer's own when none is saved"""
    theme = Preferences.load().data.get(THEME_KEY)
    return theme if theme in THEMES else THEMES[0]


def defaults():
    """dji-thermal-cli's defaults, the files written in the app's unit"""
    return dict(thermal_conversion.DEFAULTS, unit=app_unit())


def preferences():
    """The saved conversion settings (None when none are saved), completed and checked as when converting"""
    saved = Preferences.load().data.get(PREFERENCES_KEY)
    if not isinstance(saved, dict):
        return None
    settings, errors = thermal_conversion.parse_settings(saved)
    # Saved settings a newer dji-thermal-cli no longer accepts fall back to the defaults, field by field
    for field in errors:
        if field in settings:
            settings[field] = thermal_conversion.DEFAULTS[field]
    return settings


def save_preference(key, value):
    """Saves (or with None, forgets) one preference"""
    with transaction.atomic():
        prefs = Preferences.load()
        data = dict(prefs.data or {})
        if value is None:
            data.pop(key, None)
        else:
            data[key] = value
        prefs.data = data
        prefs.save(update_fields=['data'])


def start_mosaics(conversion):
    run_id = uuid.uuid4().hex
    ThermalConversion.objects.filter(pk=conversion.pk).update(mosaic_status='building', mosaic_progress=0,
                                                              stage={}, mosaic_error="", mosaics={}, run_id=run_id)
    jobs.submit(thermal_mosaics.build_mosaics, conversion.pk, run_id)
    conversion.refresh_from_db()
    return conversion


def start_conversion(conversion):
    run_id = uuid.uuid4().hex
    ThermalConversion.objects.filter(pk=conversion.pk).update(status='converting', progress=0, stage={}, error="",
                                                              run_id=run_id)
    jobs.submit(thermal_conversion.convert, conversion.pk, run_id)
    conversion.refresh_from_db()
    return conversion


def served_only(rel):
    """Whether a path in a conversion's folder is one served only to the viewer, never as a download (the located
    copies of stripped mosaics)"""
    parts = os.path.normpath(rel).replace('\\', '/').split('/')
    return parts[0] == thermal_mosaics.VIEWER_DIR


def download_name(text):
    """A file name from a dataset or conversion name: letters, digits, dots, dashes and underscores (the header that
    carries it is not quoted, and some browsers cut an unquoted name at its first space)"""
    name = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in text).strip("._")
    return name or "conversion"


def start_analysis(dataset):
    run_id = uuid.uuid4().hex
    ThermalDataset.objects.filter(pk=dataset.pk).update(status='analyzing', progress=0, error="", run_id=run_id,
                                                         updated_at=timezone.now())
    jobs.submit(thermal_analysis.analyze_dataset, dataset.pk, run_id)
    dataset.refresh_from_db()
    return dataset


def upload_path(name):
    """Where an uploaded file goes within the images folder: its name, under the subfolders it came from (if any)"""
    parts = [p for p in name.replace('\\', '/').split('/') if p not in ('', '.', '..')]
    if not parts:
        return None
    return os.path.join(*parts[-(MAX_FOLDER_DEPTH + 1):])


class DatasetView(APIView):
    pass


class DatasetListCreateView(DatasetView):
    def get(self, request):
        """The datasets, newest first"""
        return Response({'datasets': [summary(check_stale(d)) for d in ThermalDataset.objects.all()]})

    def post(self, request):
        name = str(request.data.get('name', '')).strip()
        source = request.data.get('source', 'upload')
        folder = str(request.data.get('folder', '')).strip()
        if not name:
            raise ValidationError({'name': "A name is required"})
        if source not in ('upload', 'folder'):
            raise ValidationError({'source': "Upload images or use a folder"})
        if source == 'folder':
            if not folder or not os.path.isdir(folder):
                raise ValidationError({'folder': "That folder does not exist"})
            folder = os.path.abspath(folder)

        dataset = ThermalDataset.objects.create(name=name[:255], source=source,
                                                folder=folder if source == 'folder' else "")
        if source == 'folder':
            dataset.update_size()
            dataset.save(update_fields=['file_count', 'size'])
            dataset = start_analysis(dataset)
        return Response(detail(dataset), status=status.HTTP_201_CREATED)


class DatasetDetailView(DatasetView):
    def get(self, request, pk):
        return Response(detail(check_stale(get_dataset(pk))))

    def patch(self, request, pk):
        dataset = get_dataset(pk)
        name = str(request.data.get('name', '')).strip()
        if not name:
            raise ValidationError({'name': "A name is required"})
        dataset.name = name[:255]
        # Only the name: a running analysis writes the rest
        dataset.save(update_fields=['name', 'updated_at'])
        return Response(detail(dataset))

    def delete(self, request, pk):
        dataset = get_dataset(pk)
        dataset.delete()    # a running analysis finds its run gone and stops
        return Response(status=status.HTTP_204_NO_CONTENT)


class DatasetUploadView(DatasetView):
    def post(self, request, pk):
        dataset = get_dataset(pk)
        if dataset.source != 'upload':
            raise ValidationError({'error': "This dataset reads a folder: there is nothing to upload"})
        if dataset.status == 'analyzing':
            raise ValidationError({'error': "Wait for the analysis to finish, or cancel it, before adding images"})

        images_dir = dataset.images_dir()
        saved, skipped = 0, []
        # Django keeps only the name of an uploaded file: its place in the folder chosen comes as 'paths', in order
        files = request.FILES.getlist('images')
        paths = request.data.getlist('paths') if hasattr(request.data, 'getlist') else []
        if len(paths) != len(files):
            paths = [f.name for f in files]
        for f, name in zip(files, paths):
            rel = upload_path(name or "")
            if rel is None or not rel.lower().endswith(IMAGE_EXTENSIONS):
                skipped.append(name)
                continue
            dst = path_traversal_check(os.path.join(images_dir, rel), images_dir)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            if isinstance(f, InMemoryUploadedFile):
                with open(dst, 'wb') as out:
                    for chunk in f.chunks():
                        out.write(chunk)
            else:
                # A large upload is a temporary file already: copied by path
                shutil.copyfile(f.temporary_file_path(), dst)
            saved += 1

        with transaction.atomic():
            dataset.update_size()
            fields = ['file_count', 'size', 'updated_at']
            if saved and dataset.status != 'new':
                # The images changed: the analysis (kept until it is run again) no longer matches them
                dataset.status = 'new'
                fields.append('status')
            dataset.save(update_fields=fields)
        return Response({'saved': saved, 'skipped': skipped, 'file_count': dataset.file_count,
                         'size': int(dataset.size * 1024 * 1024)})


class DatasetAnalyzeView(DatasetView):
    def post(self, request, pk):
        dataset = check_stale(get_dataset(pk))
        if dataset.status == 'analyzing':
            raise ValidationError({'error': "The dataset is already being analyzed"})
        if dataset.source == 'folder' and not os.path.isdir(dataset.folder):
            raise ValidationError({'error': "The dataset's folder no longer exists"})
        if dataset.source == 'upload' and not dataset.file_count:
            raise ValidationError({'error': "Add images to the dataset first"})
        return Response(detail(start_analysis(dataset)))


class DatasetCancelView(DatasetView):
    def post(self, request, pk):
        dataset = get_dataset(pk)
        # The job stops at its next progress write, when it finds its run gone
        ThermalDataset.objects.filter(pk=dataset.pk, status='analyzing').update(
            status='canceled', run_id="", progress=0, updated_at=timezone.now())
        dataset.refresh_from_db()
        return Response(detail(dataset))


THUMBNAIL_SIZE = (96, 96)


class DatasetThumbnailView(DatasetView):
    def get(self, request, pk):
        """A small JPEG of one of the files its analysis lists (?file=), for the Files tab"""
        from PIL import Image
        from django.http import HttpResponse
        dataset = get_dataset(pk)
        rel = request.query_params.get('file') or ""
        if not rel or rel not in {r.get('path') for r in (dataset.analysis or {}).get('files') or []}:
            raise NotFound({'error': "Not a file of this dataset"})
        root = dataset.images_dir()
        try:
            path = path_traversal_check(os.path.join(root, rel), root)
        except SuspiciousFileOperation:
            raise NotFound({'error': "Not a file of this dataset"}) from None
        if not os.path.isfile(path):
            raise NotFound({'error': "The file is not there any more"})
        out = io.BytesIO()
        try:
            with Image.open(path) as im:
                # The JPEG decoder scales down while reading: a few milliseconds a frame
                im.draft('RGB', THUMBNAIL_SIZE)
                im = im.convert('RGB')
                im.thumbnail(THUMBNAIL_SIZE)
                im.save(out, 'JPEG', quality=75)
        except (OSError, ValueError):
            raise NotFound({'error': "The file is not an image"}) from None
        response = HttpResponse(out.getvalue(), content_type="image/jpeg")
        response['Cache-Control'] = 'private, max-age=86400'
        return response


class ConversionListCreateView(DatasetView):
    def get(self, request, pk):
        dataset = get_dataset(pk)
        return Response([conversion_summary(check_stale(c)) for c in dataset.conversions.all()])

    def post(self, request, pk):
        """Converts the dataset's images with the settings given, as a new conversion kept beside the others"""
        dataset = get_dataset(pk)
        if dataset.source == 'folder' and not os.path.isdir(dataset.folder):
            raise ValidationError({'error': "The dataset's folder no longer exists"})
        if dataset.source == 'upload' and not dataset.file_count:
            raise ValidationError({'error': "Add images to the dataset first"})
        settings, errors = thermal_conversion.parse_settings(request.data.get('settings'))
        if errors:
            raise ValidationError(errors)
        name = str(request.data.get('name', '') or '').strip() or \
            "Conversion {}".format(dataset.conversions.count() + 1)
        conversion = ThermalConversion.objects.create(dataset=dataset, name=name[:255], options=settings)
        return Response(conversion_detail(start_conversion(conversion)), status=status.HTTP_201_CREATED)


class ConversionDetailView(DatasetView):
    def get(self, request, pk):
        return Response(conversion_detail(check_stale(get_conversion(pk))))

    def patch(self, request, pk):
        conversion = get_conversion(pk)
        name = str(request.data.get('name', '')).strip()
        if not name:
            raise ValidationError({'name': "A name is required"})
        conversion.name = name[:255]
        # Only the name: a running conversion writes the rest
        conversion.save(update_fields=['name'])
        return Response(conversion_detail(conversion))

    def delete(self, request, pk):
        conversion = get_conversion(pk)
        conversion.delete()     # a running conversion finds its run gone and stops; its folder goes (post_delete)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ConversionCancelView(DatasetView):
    def post(self, request, pk):
        conversion = get_conversion(pk)
        # The job stops at its next progress write, when it finds its run gone; what it wrote so far is kept, counted.
        # Once the images are converted, it is the mosaics that are canceled
        if ThermalConversion.objects.filter(pk=conversion.pk, status='converting').update(
                status='canceled', run_id="", progress=0, stage={}, finished_at=timezone.now()) or \
                ThermalConversion.objects.filter(pk=conversion.pk, mosaic_status='building').update(
                    mosaic_status='canceled', run_id="", mosaic_progress=0, stage={}):
            conversion.refresh_from_db()
            conversion.update_size()
            conversion.save(update_fields=['file_count', 'size'])
        conversion.refresh_from_db()
        return Response(conversion_detail(conversion))


class ConversionDownloadView(DatasetView):
    def get(self, request, pk):
        """The conversion's outputs as a zip (streamed as it is made), or one of them (?file=<path in the outputs>)"""
        conversion = get_conversion(pk)
        out_dir = conversion.data_dir()
        if not os.path.isdir(out_dir):
            raise NotFound()
        rel = request.query_params.get('file')
        if rel:
            if served_only(rel):
                raise NotFound()
            try:
                path = path_traversal_check(os.path.join(out_dir, rel), out_dir)
            except SuspiciousFileOperation:
                raise NotFound() from None
            if not os.path.isfile(path):
                raise NotFound()
            return download_file_response(request, path, 'attachment')

        zs = ZipStream(sized=True)
        zs.comment = "Generated by dji-thermal-ui"
        for dirpath, dirnames, filenames in os.walk(out_dir):
            if dirpath == out_dir and thermal_mosaics.VIEWER_DIR in dirnames:
                dirnames.remove(thermal_mosaics.VIEWER_DIR)
            dirnames.sort()
            for f in sorted(filenames):
                full = os.path.join(dirpath, f)
                if not os.path.islink(full):
                    zs.add_path(full, thermal_analysis.relative(full, out_dir))
        name = download_name("{}-{}".format(conversion.dataset.name, conversion.name)) + ".zip"
        return download_file_stream(request, zs, 'attachment', download_filename=name)


class PreferencesView(DatasetView):
    def get(self, request):
        """The saved conversion settings (or the defaults), the temperature unit, and what can be chosen"""
        saved = preferences()
        return Response({
            'settings': saved if saved is not None else defaults(),
            'saved': saved is not None,
            'defaults': defaults(),
            'unit': app_unit(),
            'units': list(thermal_conversion.UNITS),
            'theme': app_theme(),
            'themes': list(THEMES),
            'products': thermal_conversion.products(),
            'palettes': thermal_conversion.palettes(),
            'limits': thermal_conversion.LIMITS,
        })

    def put(self, request):
        """Saves settings as the defaults for new conversions, and/or the unit temperatures are shown in, and/or the
        pages' theme"""
        out = {}
        for key, choices in ((UNIT_KEY, thermal_conversion.UNITS), (THEME_KEY, THEMES)):
            if key in request.data:
                value = request.data.get(key)
                if value not in choices:
                    raise ValidationError({key: "One of {}".format(", ".join(choices))})
                save_preference(key, value)
                out[key] = value
        if 'settings' in request.data or not out:
            settings, errors = thermal_conversion.parse_settings(request.data.get('settings'))
            if errors:
                raise ValidationError(errors)
            save_preference(PREFERENCES_KEY, settings)
            out.update(settings=settings, saved=True)
        return Response(out)

    def delete(self, request):
        """Back to dji-thermal-cli's defaults (the unit and the theme are kept)"""
        save_preference(PREFERENCES_KEY, None)
        return Response({'settings': defaults(), 'saved': False})


# --- the mosaic viewer --------------------------------------------------------------------------------------------

# The colour maps offered besides DJI's palettes (those the tiler offers for thermal layers)
VIEWER_COLORMAPS = ('ironbow', 'gray', 'gray_r', 'lava', 'arctic', 'rainbow', 'hot', 'magma', 'inferno', 'plasma',
                    'viridis', 'jet')
DJI_PREFIX = 'dji_'
FRAME_COLORS = 256      # the source frame tab colours frame n with colour n % FRAME_COLORS
HISTOGRAM_FILE = 'histogram-{}.json'    # a mosaic tab's histogram for the equalization, in the viewer folder
# A tile's unsharp mask, in its pixels: far out, a raster pixel is less than one; close in, many
MIN_SHARPEN_SIGMA = 0.5
MAX_SHARPEN_SIGMA = 16.0
# The values the browser colours (data tiles): float32, this where there is no data (WebGL cannot test for NaN), with
# DATA_GUTTER pixels around a mosaic's tile for the browser's sharpening to read past its edges
DATA_TILE_SIZE = 256
DATA_GUTTER = 8
NO_DATA = -1e30


@lru_cache(maxsize=None)
def frame_colormap():
    """Distinct colours for neighbouring frames (hues a golden angle apart): {index: (r, g, b, 255)}"""
    out = {}
    for i in range(FRAME_COLORS):
        r, g, b = colorsys.hsv_to_rgb((i * 0.618033988749895) % 1.0, 0.65 + 0.3 * (i % 2), 0.95 - 0.25 * (i % 3 == 2))
        out[i] = (int(r * 255), int(g * 255), int(b * 255), 255)
    return out


def encoded(colors):
    """Colours as the tiler's metadata gives them (0xRRGGBBAA integers), for the legend"""
    return [(int(c[0]) << 24) | (int(c[1]) << 16) | (int(c[2]) << 8) | 255 for c in colors]


@lru_cache(maxsize=32)
def frame_palettes(path, mtime):
    from pathlib import Path
    return thermal_mosaics.dji_palettes([Path(path)])


def conversion_palettes(conversion):
    """DJI's palettes as the conversion's frames hold them: {name: [[r, g, b] x 256]} (as the mosaics kept them, else
    read from the dataset's first frame)"""
    path = os.path.join(conversion.data_dir(), thermal_mosaics.VIEWER_DIR, thermal_mosaics.PALETTES_FILE)
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        pass
    for row in thermal_measure.frame_rows(conversion)[:1]:
        try:
            frame = thermal_measure.frame_file(conversion, row['path'])
            return frame_palettes(frame, os.stat(frame).st_mtime_ns)
        except (thermal_measure.MeasureError, OSError):
            pass
    return {}


def viewer_palettes(conversion):
    from .raster.tiler import colormap_entries
    dji = [{'key': DJI_PREFIX + name, 'label': "DJI " + name, 'color_map': encoded(lut)}
           for name, lut in conversion_palettes(conversion).items()]
    return dji + colormap_entries(VIEWER_COLORMAPS)


def palette_colormap(conversion, name):
    """The colour map ({index: (r, g, b, a)}) of one of viewer_palettes, or ValidationError"""
    from .raster.tiler import check_colormap
    if name.startswith(DJI_PREFIX):
        lut = conversion_palettes(conversion).get(name[len(DJI_PREFIX):])
        if lut is None:
            raise ValidationError({'color_map': "Not a palette of this conversion"})
        return {i: (c[0], c[1], c[2], 255) for i, c in enumerate(lut)}
    if name not in VIEWER_COLORMAPS:
        raise ValidationError({'color_map': "Not a valid color_map value"})
    return check_colormap(name)


def style_params(request, conversion):
    """The colour map, range, isotherm and adjustments (thermal_measure.parse_adjust) a tile or frame image is drawn
    with"""
    name = request.query_params.get('color_map') or default_palette(conversion, viewer_palettes(conversion))
    cmap = palette_colormap(conversion, name)
    low, high = range_params(request)
    try:
        isotherm = thermal_measure.parse_isotherm(request.query_params.get('isotherm'))
    except thermal_measure.MeasureError as e:
        raise ValidationError({'isotherm': str(e)}) from None
    return cmap, low, high, isotherm, adjust_params(request)


def adjust_params(request):
    try:
        return thermal_measure.parse_adjust(request.query_params)
    except thermal_measure.MeasureError as e:
        raise ValidationError({'error': str(e)}) from None


def range_params(request):
    from .raster.tiler import parse_rescale
    low, high = parse_rescale(request.query_params.get('rescale') or "0,1")
    if not high > low:
        raise ValidationError({'rescale': "The range's maximum must be above its minimum"})
    return low, high


def default_palette(conversion, palettes):
    """The conversion's own palette, else the flight's (as dji-thermal-cli's preview used it), else ironbow"""
    keys = {p['key'] for p in palettes}
    m = conversion.mosaics or {}
    for name in ((conversion.options or {}).get('palette'),
                 ((m.get('kinds') or {}).get('as_converted') or {}).get('palette')):
        if name and DJI_PREFIX + name in keys:
            return DJI_PREFIX + name
    return 'ironbow'


def viewer(conversion):
    """What the viewer shows of a conversion's mosaics: the tabs, palettes, frames (and when the first and last were
    taken, as recorded), and dji-thermal-cli's reports"""
    m = conversion.mosaics or {}
    kinds = m.get('kinds') or {}
    palettes = viewer_palettes(conversion) if kinds else []
    tabs = []
    for tab, kind, _band in thermal_mosaics.TABS:
        k = kinds.get(kind)
        if not k:
            continue
        stats = k.get('view_angle') if tab == 'view_angle' else k.get('temperature')
        tabs.append({'tab': tab, 'kind': kind, 'bounds': k.get('bounds'), 'minzoom': k.get('minzoom'),
                     'maxzoom': k.get('maxzoom'), 'stats': stats if tab != 'source_frame' else None})
    in_mosaic = set(m.get('frames') or [])
    times = sorted(r['time'] for r in thermal_measure.frame_rows(conversion) if r['path'] in in_mosaic and r.get('time'))
    out = conversion_summary(conversion)
    out.update({'dataset_name': conversion.dataset.name, 'unit': m.get('unit') or (conversion.options or {}).get('unit'),
                'flown': [times[0], times[-1]] if times else [],
                'stripped': bool(m.get('stripped')), 'frames': m.get('frames') or [], 'tabs': tabs,
                'kinds': {kind: {key: v for key, v in k.items() if key not in ('raster',)} for kind, k in kinds.items()},
                'palettes': palettes, 'default_palette': default_palette(conversion, palettes) if kinds else None,
                'baselines': {kind: thermal_measure.mosaic_baseline(conversion, kind) for kind in kinds},
                'frame_colors': encoded(frame_colormap()[i] for i in range(FRAME_COLORS))})
    return out


def mosaic_correction(request, conversion, kind):
    """The approximate correction a mosaic's temperatures are asked with (emissivity, reflected_temp), or None"""
    try:
        return thermal_measure.mosaic_correction(conversion, kind, request.query_params)
    except thermal_measure.MeasureError as e:
        raise ValidationError({'error': str(e)}) from None


def mosaic_curve(conversion, tab, path, band, correction, low, high, adjust):
    """The equalization (thermal_measure.equalization) of a temperature tab's temperatures, corrected, over low..high,
    or None when not asked for (or not temperatures)"""
    if not adjust['equalize'] or band != 1:
        return None
    unit = (conversion.mosaics or {}).get('unit') or 'C'
    kept = os.path.join(conversion.data_dir(), thermal_mosaics.VIEWER_DIR, HISTOGRAM_FILE.format(tab))
    histogram = thermal_measure.mosaic_histogram(path, unit, kept)
    return thermal_measure.equalization(thermal_measure.corrected_histogram(histogram, unit, correction), low, high)


def frame_curve(values, low, high, adjust):
    return thermal_measure.equalization(thermal_measure.value_histogram(values, (low, high)), low, high) \
        if adjust['equalize'] else None


def sharpening_reach(src, x, y, z, tilesize):
    """The unsharp mask's sigma in a tile's pixels (its radius is in the raster's) and the margin to read for it"""
    from rasterio.warp import transform_bounds
    left, bottom, right, top = transform_bounds(src.tms.rasterio_crs, src.crs, *src.tms.xy_bounds(x, y, z))
    sigma = thermal_measure.SHARPEN_RADIUS * abs(src.dataset.res[0]) / ((right - left) / float(tilesize))
    sigma = min(max(sigma, MIN_SHARPEN_SIGMA), MAX_SHARPEN_SIGMA)
    return sigma, int(math.ceil(3 * sigma))


def read_tile(src, x, y, z, band, margin=0, tilesize=256):
    """A tile of one band of a mosaic (float64) and where it has data, with margin pixels around it, or 404. A
    buffered read samples its pixels a little differently, so the tile's own are as an unbuffered read gives them."""
    from rio_tiler.errors import TileOutsideBounds
    from .raster.tiler import ZOOM_EXTRA_LEVELS, get_zoom_safe
    if not src.tile_exists(tile_x=x, tile_y=y, tile_z=z):
        raise NotFound()
    minzoom, maxzoom = get_zoom_safe(src)
    if z < minzoom - ZOOM_EXTRA_LEVELS or z > maxzoom + ZOOM_EXTRA_LEVELS:
        raise NotFound()
    read = dict(indexes=(band,), tilesize=tilesize, resampling_method='nearest', reproject_method='nearest')
    try:
        tile = src.tile(x, y, z, **read)
        data, valid = np.asarray(tile.data[0], dtype=np.float64), tile.mask > 0
        if margin:
            around = src.tile(x, y, z, buffer=margin, **read)
            inner = (slice(margin, -margin), slice(margin, -margin))
            data, valid = np.asarray(around.data[0], dtype=np.float64), around.mask > 0
            data[inner], valid[inner] = tile.data[0], tile.mask > 0
    except TileOutsideBounds:
        raise NotFound() from None
    return data, valid


def data_response(values, valid, etag, cache='private, no-cache'):
    """Values as the browser colours them: float32 little-endian, row by row, NO_DATA where there are none"""
    from django.http import HttpResponse
    valid = valid & np.isfinite(values)
    res = HttpResponse(np.where(valid, values, NO_DATA).astype('<f4').tobytes(), content_type='application/octet-stream')
    if etag:
        res['ETag'] = etag
    res['Cache-Control'] = cache
    return res


def mosaic_values(conversion, tab, band, data, valid, correction):
    """A mosaic tile's values as drawn: temperatures without dji-thermal-cli's no-data marker, corrected"""
    valid = valid & np.isfinite(data)
    if band != 1:
        return data, valid
    unit = mosaic_unit(conversion)
    valid &= data > thermal_mosaics.low_value(unit)
    data = thermal_measure.corrected(np.where(valid, data, np.nan), unit, correction)
    return data, valid & np.isfinite(data)


def mosaic_raster(conversion, tab):
    """(path, band) a tab reads, or 404"""
    found = thermal_mosaics.tab_raster(conversion.data_dir(), conversion.mosaics or {}, tab)
    if found is None or not os.path.isfile(found[0]):
        raise NotFound()
    return found


@lru_cache(maxsize=None)
def viewer_code_fingerprint():
    """What renders the mosaics' tiles here, for their ETag (the tiler's own code is in tile_code_fingerprint)"""
    h = hashlib.sha1()
    for name in ('api.py', 'thermal_mosaics.py', 'thermal_measure.py'):
        with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), name), 'rb') as f:
            h.update(f.read())
    return h.hexdigest()


class MosaicsView(DatasetView):
    def get(self, request, pk):
        """The conversion's mosaics as the viewer shows them"""
        conversion = check_stale(get_conversion(pk))
        return Response(viewer(conversion))

    def post(self, request, pk):
        """Builds (again) the mosaics of a converted conversion"""
        conversion = check_stale(get_conversion(pk))
        if conversion.status != 'ready':
            raise ValidationError({'error': "The images must be converted first"})
        if conversion.mosaic_status == 'building':
            raise ValidationError({'error': "The mosaics are already being built"})
        if not (conversion.options or {}).get('mosaics'):
            ThermalConversion.objects.filter(pk=conversion.pk).update(options=dict(conversion.options or {},
                                                                                  mosaics=True))
        return Response(conversion_detail(start_mosaics(conversion)))


class MosaicTileView(DatasetView):
    def get(self, request, pk, tab, z, x, y, ext=None):
        """
        A tile of a mosaic tab: temperatures and view angles over rescale=min,max with color_map (one of
        viewer_palettes), source frames each in their own colour. Values are never interpolated (nearest pixel).
        Temperatures can be corrected (emissivity, reflected_temp: see mosaic_correction) and show an isotherm
        (isotherm=above,T / below,T / between,A,B: its pixels in the palette, the rest in grey), and be drawn
        adjusted (gamma, equalize=1 over the whole tab's histogram, sharpen: see thermal_measure.parse_adjust).
        """
        from rio_tiler.errors import TileOutsideBounds
        from .raster.tiler import get_zoom_safe, not_modified, raster_etag, render_tile, tile_format, tile_response
        from .raster.tiler import ZOOM_EXTRA_LEVELS

        conversion = get_conversion(pk)
        path, band = mosaic_raster(conversion, tab)
        z, x, y = int(z), int(x), int(y)
        palettes_file = os.path.join(conversion.data_dir(), thermal_mosaics.VIEWER_DIR, thermal_mosaics.PALETTES_FILE)
        # A correction is relative to what the mosaic was measured with, which the dataset's analysis can change
        baseline = thermal_measure.mosaic_baseline(conversion, tab) if band == 1 else ''
        etag = raster_etag(request, path, viewer_code_fingerprint(),
                           os.stat(palettes_file).st_mtime_ns if os.path.isfile(palettes_file) else '',
                           json.dumps(baseline, sort_keys=True))
        cached = not_modified(request, etag)
        if cached is not None:
            return cached

        cmap, isotherm, correction, adjust = frame_colormap(), None, None, None
        if tab != 'source_frame':
            cmap, low, high, isotherm, adjust = style_params(request, conversion)
        if band == 1:
            correction = mosaic_correction(request, conversion, tab)
        else:
            isotherm = None     # isotherms are temperatures

        with thermal_mosaics.open_raster(path) as src:
            if not src.tile_exists(tile_x=x, tile_y=y, tile_z=z):
                raise NotFound()
            minzoom, maxzoom = get_zoom_safe(src)
            if z < minzoom - ZOOM_EXTRA_LEVELS or z > maxzoom + ZOOM_EXTRA_LEVELS:
                raise NotFound()
            sigma, margin = sharpening_reach(src, x, y, z, 256) if adjust and adjust['sharpen'] > 0 else (0, 0)
            read = dict(indexes=(band,), tilesize=256, resampling_method='nearest', reproject_method='nearest')
            try:
                tile = src.tile(x, y, z, **read)
                data = np.asarray(tile.data[0], dtype=np.float64)
                valid = tile.mask > 0
                if margin:
                    # The margin around the tile for the sharpening; a buffered read samples its pixels a little
                    # differently, so the tile's own are drawn where they are without it
                    around = src.tile(x, y, z, buffer=margin, **read)
                    inner = (slice(margin, -margin), slice(margin, -margin))
                    data, valid = np.asarray(around.data[0], dtype=np.float64), around.mask > 0
                    data[inner], valid[inner] = tile.data[0], tile.mask > 0
            except TileOutsideBounds:
                raise NotFound() from None

        valid &= np.isfinite(data)
        if band == 1:
            unit = (conversion.mosaics or {}).get('unit') or 'C'
            valid &= data > thermal_mosaics.low_value(unit)
            data = thermal_measure.corrected(np.where(valid, data, np.nan), unit, correction)
            valid &= np.isfinite(data)
        inner = valid[margin:valid.shape[0] - margin, margin:valid.shape[1] - margin]
        mask = np.where(inner, 255, 0).astype(np.uint8)
        ext, driver, options = tile_format(request, mask, ext)
        if tab == 'source_frame':
            levels = np.mod(np.rint(np.where(valid, data, 0)), FRAME_COLORS).astype(np.uint8)[np.newaxis]
        else:
            curve = mosaic_curve(conversion, tab, path, band, correction, low, high, adjust)
            levels, cmap = thermal_measure.colorize(data, valid, cmap, low, high, isotherm, adjust, curve, sigma,
                                                    margin)
        content = render_tile(levels, mask, driver, colormap=cmap, **options)
        return tile_response(content, ext, etag)


def mosaic_etag(request, conversion, tab, path, band):
    """A mosaic tile's ETag: its raster, the palettes kept beside it and the baseline a correction is relative to
    (which the dataset's analysis can change)"""
    from .raster.tiler import raster_etag
    palettes_file = os.path.join(conversion.data_dir(), thermal_mosaics.VIEWER_DIR, thermal_mosaics.PALETTES_FILE)
    baseline = thermal_measure.mosaic_baseline(conversion, tab) if band == 1 else ''
    return raster_etag(request, path, viewer_code_fingerprint(),
                       os.stat(palettes_file).st_mtime_ns if os.path.isfile(palettes_file) else '',
                       json.dumps(baseline, sort_keys=True))


class MosaicDataView(DatasetView):
    def get(self, request, pk, tab, z, x, y):
        """
        A data tile of a mosaic tab (see data_response), DATA_TILE_SIZE pixels across with DATA_GUTTER around it:
        temperatures (corrected with emissivity and reflected_temp: see mosaic_correction), view angles, or the
        index of each pixel's source frame. Values are never interpolated (nearest pixel).
        """
        from .raster.tiler import not_modified
        conversion = get_conversion(pk)
        path, band = mosaic_raster(conversion, tab)
        etag = mosaic_etag(request, conversion, tab, path, band)
        cached = not_modified(request, etag)
        if cached is not None:
            return cached
        correction = mosaic_correction(request, conversion, tab) if band == 1 else None
        with thermal_mosaics.open_raster(path) as src:
            data, valid = read_tile(src, int(x), int(y), int(z), band, DATA_GUTTER, DATA_TILE_SIZE)
        return data_response(*mosaic_values(conversion, tab, band, data, valid, correction), etag)


class MosaicCurveView(DatasetView):
    def get(self, request, pk, tab):
        """How a temperature tab's tiles are drawn over rescale with gamma and equalize (corrected as they are): the
        palette's share at thermal_measure.CURVE_SAMPLES temperatures evenly across the range, for the legend"""
        conversion = get_conversion(pk)
        path, band = mosaic_raster(conversion, tab)
        if band != 1:
            raise NotFound()
        low, high = range_params(request)
        adjust = adjust_params(request)
        correction = mosaic_correction(request, conversion, tab)
        curve = mosaic_curve(conversion, tab, path, band, correction, low, high, adjust)
        return Response({'shares': thermal_measure.curve_shares(low, high, adjust, curve)})


class MosaicPointView(DatasetView):
    def get(self, request, pk, tab):
        """A mosaic tab's values at a point (lon, lat): temperature (corrected as the tiles are), source frame, view
        angle and the frame's pixel it was read from (column, row; none in a mosaic built before dji-thermal-cli 1.4.0)"""
        from .raster.tiler import point_values

        conversion = get_conversion(pk)
        path, _band = mosaic_raster(conversion, tab)
        try:
            lon, lat = float(request.query_params.get('lon')), float(request.query_params.get('lat'))
        except (TypeError, ValueError):
            raise ValidationError({'error': "lon and lat are required"}) from None
        if not (-180 <= lon <= 180 and -90 <= lat <= 90):
            raise ValidationError({'error': "Coordinates out of range"})

        m = conversion.mosaics or {}
        unit = m.get('unit') or 'C'
        out = {'coordinates': [lon, lat], 'valid': False, 'unit': unit,
               'temperature': None, 'frame': None, 'frame_index': None, 'view_angle': None, 'frame_pixel': None}
        with thermal_mosaics.open_raster(path) as src:
            values = point_values(src, lon, lat, indexes=(1, 2, 3, 4, 5) if src.dataset.count >= 5 else (1, 2, 3))
        if values is None:
            out['reason'] = 'outside_raster'
            return Response(out)
        temperature, frame, angle = values[:3]
        if temperature is not None and temperature > thermal_mosaics.low_value(unit):
            kind = dict((t[0], t[1]) for t in thermal_mosaics.TABS).get(tab)
            out['temperature'] = float(thermal_measure.corrected(np.array([temperature]), unit,
                                                                 mosaic_correction(request, conversion, kind))[0])
        if frame is not None:
            frames = m.get('frames') or []
            out['frame_index'] = int(round(frame))
            out['frame'] = frames[out['frame_index']] if 0 <= out['frame_index'] < len(frames) else None
            if len(values) == 5 and None not in values[3:]:
                out['frame_pixel'] = [int(values[3]), int(values[4])]
        out['view_angle'] = angle
        out['valid'] = out['temperature'] is not None or out['frame'] is not None
        if not out['valid']:
            out['reason'] = 'nodata'
        return Response(out)


FOOTPRINT_SIZE = 1024


class MosaicFootprintView(DatasetView):
    def get(self, request, pk):
        """Where a frame is what the mosaics show (its pixels of the Source frame tab), as lon/lat GeoJSON, read at
        most FOOTPRINT_SIZE pixels across"""
        import rasterio
        from rasterio import features, warp
        from rasterio.enums import Resampling

        conversion = get_conversion(pk)
        path, band = mosaic_raster(conversion, 'source_frame')
        frames = (conversion.mosaics or {}).get('frames') or []
        frame = request.query_params.get('frame')
        if frame not in frames:
            raise NotFound()
        index = frames.index(frame)

        with rasterio.open(path) as src:
            scale = max(1.0, max(src.width, src.height) / float(FOOTPRINT_SIZE))
            shape = (max(1, int(round(src.height / scale))), max(1, int(round(src.width / scale))))
            values = src.read(band, out_shape=shape, resampling=Resampling.nearest, masked=True)
            transform = src.transform @ src.transform.scale(src.width / float(shape[1]), src.height / float(shape[0]))
            crs = src.crs
        inside = (np.round(values.filled(-1)) == index).astype(np.uint8)
        geometries = [warp.transform_geom(crs, 'EPSG:4326', g, precision=7)
                      for g, _v in features.shapes(inside, mask=inside.astype(bool), transform=transform)]
        return Response({'type': 'FeatureCollection', 'features': [
            {'type': 'Feature', 'properties': {'frame': frame}, 'geometry': g} for g in geometries]})


# --- comparing two mosaics ----------------------------------------------------------------------------------------

# The diverging colour maps a difference (A - B) is drawn with, centred on 0
DIFFERENCE_COLORMAPS = ('rdbu_r', 'coolwarm', 'bwr', 'seismic')
DIFFERENCE_SIZE = 512       # the difference's statistics are read at most this many pixels across


def temperature_raster(conversion, tab):
    """The raster of a temperature tab (as converted, harmonized), or 404"""
    path, band = mosaic_raster(conversion, tab)
    if band != 1:
        raise NotFound()
    return path


def compared_with(request, conversion):
    """The conversion a difference is taken with (b: any conversion, of any dataset), its tab (b_tab) and that tab's
    raster"""
    try:
        other = get_conversion(int(request.query_params.get('b')))
    except (TypeError, ValueError):
        raise ValidationError({'b': "The conversion to compare with is required"}) from None
    tab = request.query_params.get('b_tab') or 'as_converted'
    return other, tab, temperature_raster(other, tab)


def mosaic_unit(conversion):
    return (conversion.mosaics or {}).get('unit') or 'C'


def difference(a, a_valid, a_unit, b, b_valid, b_unit):
    """A - B in A's unit (B's temperatures converted to it), NaN where either has no data"""
    a = thermal_measure.no_data(np.where(a_valid, a, np.nan), a_unit)
    b = thermal_measure.no_data(np.where(b_valid, b, np.nan), b_unit)
    return a - thermal_measure.from_celsius(thermal_measure.to_celsius(b, b_unit), a_unit)


def difference_colormap(request):
    from .raster.tiler import check_colormap
    name = request.query_params.get('color_map') or DIFFERENCE_COLORMAPS[0]
    if name not in DIFFERENCE_COLORMAPS:
        raise ValidationError({'color_map': "Not a valid color_map value"})
    return check_colormap(name)


def comparable(conversion):
    """The conversions whose mosaics the conversion's can be compared with (its own too), by dataset then name, with
    their temperature tabs"""
    out = []
    for c in ThermalConversion.objects.select_related('dataset').order_by('dataset__name', 'dataset_id', 'name', 'id'):
        kinds = (c.mosaics or {}).get('kinds') or {}
        tabs = [tab for tab, kind, band in thermal_mosaics.TABS if band == 1 and kinds.get(kind)]
        if tabs:
            out.append({'id': c.id, 'name': c.name, 'dataset': c.dataset_id, 'dataset_name': c.dataset.name,
                        'unit': mosaic_unit(c), 'tabs': tabs})
    return out


class ComparableView(DatasetView):
    def get(self, request, pk):
        """The mosaics a conversion's can be compared with"""
        return Response(comparable(get_conversion(pk)))


class MosaicDifferenceTileView(DatasetView):
    def get(self, request, pk, tab, z, x, y, ext=None):
        """
        A tile of the difference between a temperature tab and another conversion's (b, b_tab: see compared_with):
        A - B in A's unit, over rescale=min,max with color_map (one of DIFFERENCE_COLORMAPS). B is read into A's tile
        (nearest pixel, as A); a pixel is no data where either has none. Temperatures are as measured (no correction).
        """
        from rio_tiler.errors import TileOutsideBounds
        from .raster.tiler import get_zoom_safe, not_modified, raster_etag, render_tile, tile_format, tile_response
        from .raster.tiler import ZOOM_EXTRA_LEVELS

        conversion = get_conversion(pk)
        path = temperature_raster(conversion, tab)
        other, other_tab, other_path = compared_with(request, conversion)
        z, x, y = int(z), int(x), int(y)
        st = os.stat(other_path)
        etag = raster_etag(request, path, viewer_code_fingerprint(), other_path, st.st_ino, st.st_size,
                           st.st_mtime_ns, mosaic_unit(other))
        cached = not_modified(request, etag)
        if cached is not None:
            return cached
        cmap = difference_colormap(request)
        low, high = range_params(request)

        read = dict(indexes=(1,), tilesize=256, resampling_method='nearest', reproject_method='nearest')
        with thermal_mosaics.open_raster(path) as src:
            if not src.tile_exists(tile_x=x, tile_y=y, tile_z=z):
                raise NotFound()
            minzoom, maxzoom = get_zoom_safe(src)
            if z < minzoom - ZOOM_EXTRA_LEVELS or z > maxzoom + ZOOM_EXTRA_LEVELS:
                raise NotFound()
            try:
                a = src.tile(x, y, z, **read)
            except TileOutsideBounds:
                raise NotFound() from None
        with thermal_mosaics.open_raster(other_path) as src:
            try:
                b = src.tile(x, y, z, **read)
                b_data, b_valid = b.data[0], b.mask > 0
            except TileOutsideBounds:
                b_data, b_valid = np.zeros_like(a.data[0]), np.zeros(a.mask.shape, dtype=bool)

        data = difference(a.data[0], a.mask > 0, mosaic_unit(conversion), b_data, b_valid, mosaic_unit(other))
        valid = np.isfinite(data)
        mask = np.where(valid, 255, 0).astype(np.uint8)
        ext, driver, options = tile_format(request, mask, ext)
        levels, cmap = thermal_measure.colorize(data, valid, cmap, low, high)
        content = render_tile(levels, mask, driver, colormap=cmap, **options)
        return tile_response(content, ext, etag)


class MosaicDifferenceDataView(DatasetView):
    def get(self, request, pk, tab, z, x, y):
        """A data tile (see data_response) of the difference between a temperature tab and another conversion's (b,
        b_tab: see compared_with), as MosaicDifferenceTileView takes it, DATA_TILE_SIZE pixels across"""
        from rio_tiler.errors import TileOutsideBounds
        from .raster.tiler import not_modified, raster_etag
        conversion = get_conversion(pk)
        path = temperature_raster(conversion, tab)
        other, other_tab, other_path = compared_with(request, conversion)
        z, x, y = int(z), int(x), int(y)
        st = os.stat(other_path)
        etag = raster_etag(request, path, viewer_code_fingerprint(), other_path, st.st_ino, st.st_size,
                           st.st_mtime_ns, mosaic_unit(other))
        cached = not_modified(request, etag)
        if cached is not None:
            return cached
        with thermal_mosaics.open_raster(path) as src:
            a, a_valid = read_tile(src, x, y, z, 1, tilesize=DATA_TILE_SIZE)
        with thermal_mosaics.open_raster(other_path) as src:
            try:
                b = src.tile(x, y, z, indexes=(1,), tilesize=DATA_TILE_SIZE, resampling_method='nearest',
                             reproject_method='nearest')
                b_data, b_valid = b.data[0], b.mask > 0
            except TileOutsideBounds:
                b_data, b_valid = np.zeros_like(a), np.zeros(a.shape, dtype=bool)
        data = difference(a, a_valid, mosaic_unit(conversion), b_data, b_valid, mosaic_unit(other))
        return data_response(data, np.isfinite(data), etag)


class MosaicDifferenceView(DatasetView):
    def get(self, request, pk, tab):
        """The difference between a temperature tab and another conversion's (as its tiles: b, b_tab) where both
        are, read at most DIFFERENCE_SIZE pixels across: its statistics (thermal_mosaics.band_stats), a range
        centred on 0 that holds most of it, and the palettes it can be drawn with (DIFFERENCE_COLORMAPS)"""
        from rasterio.warp import transform_bounds
        from .raster.tiler import colormap_entries
        from rio_tiler.constants import WGS84_CRS
        from rio_tiler.errors import TileOutsideBounds

        conversion = get_conversion(pk)
        path = temperature_raster(conversion, tab)
        other, other_tab, other_path = compared_with(request, conversion)
        out = {'unit': mosaic_unit(conversion), 'bounds': None, 'stats': None, 'range': None,
               'palettes': colormap_entries(DIFFERENCE_COLORMAPS)}
        with thermal_mosaics.open_raster(path) as a_src, thermal_mosaics.open_raster(other_path) as b_src:
            (aw, as_, ae, an), (bw, bs, be, bn) = a_src.get_geographic_bounds(WGS84_CRS), b_src.get_geographic_bounds(WGS84_CRS)
            bbox = (max(aw, bw), max(as_, bs), min(ae, be), min(an, bn))
            if not (bbox[0] < bbox[2] and bbox[1] < bbox[3]):
                return Response(out)
            # Both are read into the same web-mercator grid, at about A's resolution, as the tiles are
            left, bottom, right, top = transform_bounds('EPSG:4326', 'EPSG:3857', *bbox)
            a_left, a_bottom, a_right, a_top = transform_bounds(a_src.crs, 'EPSG:3857', *a_src.bounds)
            res = max((a_right - a_left) / a_src.dataset.width, (a_top - a_bottom) / a_src.dataset.height)
            scale = max(1.0, max(right - left, top - bottom) / res / DIFFERENCE_SIZE)
            width = max(1, int(round((right - left) / res / scale)))
            height = max(1, int(round((top - bottom) / res / scale)))
            read = dict(dst_crs='EPSG:3857', bounds_crs='EPSG:4326', indexes=(1,), width=width, height=height,
                        resampling_method='nearest', reproject_method='nearest')
            try:
                a, b = a_src.part(bbox, **read), b_src.part(bbox, **read)
            except TileOutsideBounds:
                return Response(out)
        data = difference(a.data[0], a.mask > 0, mosaic_unit(conversion), b.data[0], b.mask > 0, mosaic_unit(other))
        out['bounds'] = list(bbox)
        out['stats'] = thermal_mosaics.band_stats(data)
        if out['stats'] is not None:
            reach = float(np.percentile(np.abs(data[np.isfinite(data)]), 98))
            reach = reach if reach > 0 else 1.0
            out['range'] = [-reach, reach]
        return Response(out)


# --- radiometric analysis -----------------------------------------------------------------------------------------

MEASUREMENT_TARGETS = ('as_converted', 'harmonized', 'frame')
MAX_NAME_LENGTH = 255


def changes_of(params):
    """The measurement parameters a frame is asked with changed (query or body), checked"""
    try:
        return thermal_measure.parse_changes(params)
    except thermal_measure.MeasureError as e:
        raise ValidationError({'error': str(e)}) from None


def frame_measured(conversion, rel, changes=None):
    try:
        return thermal_measure.measure_frame(conversion, rel, changes)
    except thermal_measure.MeasureError as e:
        raise ValidationError({'error': str(e)}) from None


def analysis_request(conversion, data):
    """What a measure asks ({target, frame, geometry, parameters, isotherm}), checked: (target, frame, geometry or
    None for all of it, parameters, isotherm)"""
    target = data.get('target')
    if target not in MEASUREMENT_TARGETS:
        raise ValidationError({'error': "The target is a mosaic (as_converted, harmonized) or a frame"})
    frame = data.get('frame') or "" if target == 'frame' else ""
    parameters = data.get('parameters') if isinstance(data.get('parameters'), dict) else {}
    try:
        geometry = data.get('geometry')
        geometry = None if geometry is None else thermal_measure.check_geometry(geometry, lonlat=target != 'frame')
        isotherm = thermal_measure.parse_isotherm(data.get('isotherm'))
        if target == 'frame':
            parameters = thermal_measure.parse_changes(parameters)
        else:
            parameters = {f: parameters[f] for f in thermal_measure.CORRECTIONS
                          if not thermal_conversion.blank(parameters.get(f))}
            thermal_measure.mosaic_correction(conversion, target, parameters)
    except thermal_measure.MeasureError as e:
        raise ValidationError({'error': str(e)}) from None
    return target, frame, geometry, parameters, isotherm


def analysis(conversion, target, frame, geometry, parameters, isotherm):
    """
    What a geometry measures (or the whole mosaic or frame): {result, unit, approximate}; on a frame with parameters
    changed, also {changed}: the same measured again by dji-thermal-cli with them
    """
    from .thermal_analysis import clean
    unit = (conversion.options or {}).get('unit') or 'C'
    out = {'unit': unit, 'approximate': False}
    if target == 'frame':
        base = frame_measured(conversion, frame)
        out['result'] = thermal_measure.frame_measure(base['values'], geometry, isotherm)
        if parameters:
            changed = frame_measured(conversion, frame, parameters)
            out['changed'] = thermal_measure.frame_measure(changed['values'], geometry, isotherm)
    else:
        path, _band = mosaic_raster(conversion, target)
        correction = thermal_measure.mosaic_correction(conversion, target, parameters)
        out['approximate'] = correction is not None
        out['result'] = thermal_measure.mosaic_measure(path, unit, geometry, correction, isotherm,
                                                       profile_frames(conversion, geometry))
    return clean(out)


def profile_frames(conversion, geometry):
    """What a line's profile on a mosaic reads its source frames from: (path, band, names), or None"""
    if geometry is None or geometry['type'] != 'LineString':
        return None
    try:
        path, band = mosaic_raster(conversion, 'source_frame')
    except NotFound:
        return None
    return path, band, (conversion.mosaics or {}).get('frames') or []


def measurement_json(m):
    return {'id': m.id, 'name': m.name, 'target': m.target, 'frame': m.frame, 'geometry': m.geometry,
            'parameters': m.parameters, 'values': m.values, 'created_at': m.created_at}


class MeasureView(DatasetView):
    def post(self, request, pk):
        """
        Measures a spot, line or area (geometry: GeoJSON, lon/lat on a mosaic, pixel x/y on a frame), or all of a
        mosaic or frame (no geometry): the temperatures' statistics and histogram, where the extremes are, the
        surroundings and ΔT, and the share of an isotherm. parameters: on a mosaic, emissivity and reflected_temp
        (the approximate correction); on a frame, the measurement parameters it is measured again with.
        """
        conversion = get_conversion(pk)
        return Response(analysis(conversion, *analysis_request(conversion, request.data)))


class MeasurementsView(DatasetView):
    def get(self, request, pk):
        """The measurements saved on the conversion (?frame= for one frame's, ?target= for one mosaic's)"""
        conversion = get_conversion(pk)
        items = conversion.measurements.all()
        if request.query_params.get('target'):
            items = items.filter(target=request.query_params['target'])
        if request.query_params.get('frame'):
            items = items.filter(frame=request.query_params['frame'])
        return Response({'measurements': [measurement_json(m) for m in items]})

    def post(self, request, pk):
        """Measures a geometry (as MeasureView) and saves it, named"""
        conversion = get_conversion(pk)
        name = str(request.data.get('name') or "").strip()
        if not name or len(name) > MAX_NAME_LENGTH:
            raise ValidationError({'name': "A name of 1 to {} characters is required".format(MAX_NAME_LENGTH)})
        target, frame, geometry, parameters, isotherm = analysis_request(conversion, request.data)
        if geometry is None:
            raise ValidationError({'error': "Draw a spot, a line or an area to save"})
        try:
            shape = thermal_measure.check_shape(request.data.get('shape'), geometry, lonlat=target != 'frame')
        except thermal_measure.MeasureError as e:
            raise ValidationError({'error': str(e)}) from None
        values = analysis(conversion, target, frame, geometry, parameters, isotherm)
        if isotherm is not None:
            values['isotherm'] = request.data.get('isotherm')
        if shape is not None:
            values['shape'] = shape
        m = ThermalMeasurement.objects.create(conversion=conversion, name=name, target=target, frame=frame,
                                              geometry=geometry, parameters=parameters, values=values)
        return Response(measurement_json(m), status=status.HTTP_201_CREATED)


def get_measurement(pk, mid):
    conversion = get_conversion(pk)
    try:
        return conversion, conversion.measurements.get(pk=mid)
    except ThermalMeasurement.DoesNotExist:
        raise NotFound() from None


class MeasurementDetailView(DatasetView):
    def patch(self, request, pk, mid):
        """
        Renames a measurement (name), or measures it again with other parameters (parameters: as MeasureView's, {}
        for the conversion's own), on the same target, frame, geometry and isotherm
        """
        conversion, m = get_measurement(pk, mid)
        fields = []
        if 'name' in request.data:
            name = str(request.data.get('name') or "").strip()
            if not name or len(name) > MAX_NAME_LENGTH:
                raise ValidationError({'name': "A name of 1 to {} characters is required".format(MAX_NAME_LENGTH)})
            m.name = name
            fields.append('name')
        if 'parameters' in request.data:
            old = m.values or {}
            asked = {'target': m.target, 'frame': m.frame, 'geometry': m.geometry, 'isotherm': old.get('isotherm'),
                     'parameters': request.data.get('parameters')}
            target, frame, geometry, parameters, isotherm = analysis_request(conversion, asked)
            values = analysis(conversion, target, frame, geometry, parameters, isotherm)
            for kept in ('isotherm', 'shape'):
                if old.get(kept) is not None:
                    values[kept] = old[kept]
            m.parameters, m.values = parameters, values
            fields += ['parameters', 'values']
        if not fields:
            raise ValidationError({'error': "Give a name or parameters"})
        m.save(update_fields=fields)
        return Response(measurement_json(m))

    def delete(self, request, pk, mid):
        _c, m = get_measurement(pk, mid)
        m.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


CSV_COLUMNS = (('name', "Name"), ('target', "Measured on"), ('frame', "Frame"), ('kind', "Shape"),
               ('min', "Min"), ('max', "Max"), ('mean', "Mean"), ('median', "Median"), ('std', "Std dev"),
               ('surroundings', "Surroundings"), ('delta_t', "ΔT"), ('unit', "Unit"), ('isotherm', "Isotherm"),
               ('isotherm_share', "Isotherm share"), ('length', "Length"), ('area', "Area"),
               ('size_unit', "Length / area unit"), ('valid_pixels', "Pixels"), ('distance', "Distance"),
               ('temperature', "Temperature"), ('source_frame', "Source frame"), ('parameters', "Parameters changed"),
               ('approximate', "Approximate"), ('geometry', "Geometry"), ('created_at', "Saved at"))


def csv_number(value, digits):
    return round(value, digits) if isinstance(value, (int, float)) and not isinstance(value, bool) else value


def csv_rows(m, unit='C', profile=True):
    """A measurement's CSV rows, its temperatures in the unit: one, and a second for the parameters changed on a frame
    (measured again); with profile, a line's are each followed by a row per sample of its profile"""
    v = m.values or {}
    measured = v.get('unit') or 'C'

    def temperature(value):
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            return value
        return thermal_measure.from_celsius(thermal_measure.to_celsius(value, measured), unit)

    def difference(value):
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            return value
        return thermal_measure.difference_in(unit, value / 1.8 if measured == 'F' else value)

    def isotherm(value):
        parts = str(value or "").split(',')
        return ",".join([parts[0]] + ["{:g}".format(round(temperature(float(p)), 4)) for p in parts[1:]]) if value else ""

    def parameters(params):
        # The temperatures changed on a frame are in the conversion's unit, as measured
        return {k: round(temperature(x), 4) if k in ('reflected_temp', 'ambient_temp') else x for k, x in params.items()}

    t = lambda key: csv_number(temperature(r.get(key)), 3)
    d = lambda key: csv_number(difference(r.get(key)), 3)
    rows = []
    for which in ('result', 'changed'):
        r = v.get(which)
        if not r:
            continue
        iso = r.get('isotherm') or {}
        name = m.name if which == 'result' else m.name + " (parameters changed)"
        target = str(dict(ThermalMeasurement._meta.get_field('target').choices).get(m.target, m.target))
        rows.append({
            'name': name, 'target': target, 'frame': m.frame, 'kind': (v.get('shape') or {}).get('kind') or r.get('kind'),
            'min': t('min'), 'max': t('max'), 'mean': t('mean'), 'median': t('median'), 'std': d('std'),
            'surroundings': t('surroundings'), 'delta_t': d('delta_t'), 'unit': unit,
            'isotherm': isotherm(v.get('isotherm')), 'isotherm_share': csv_number(iso.get('share'), 4),
            'length': csv_number(r.get('length'), 2), 'area': csv_number(r.get('area'), 2),
            'size_unit': ("px" if m.target == 'frame' else "m") if (r.get('length') or r.get('area')) else "",
            'valid_pixels': r.get('valid_pixels'), 'distance': None, 'temperature': None, 'source_frame': None,
            'parameters': json.dumps(parameters(m.parameters)) if m.parameters and (which == 'changed' or m.target != 'frame') else "",
            'approximate': "yes" if v.get('approximate') else "",
            'geometry': json.dumps(m.geometry),
            'created_at': m.created_at.isoformat(),
        })
        p = r.get('profile') if profile else None
        if p:
            empty = {k: None for k, _l in CSV_COLUMNS}
            size_unit = rows[-1]['size_unit']
            frames = p.get('frames') or []
            for i, (distance, value, point) in enumerate(zip(p['distance'], p['values'], p['points'])):
                rows.append(dict(empty, name=name, target=target, frame=m.frame, kind='profile', unit=unit,
                                 size_unit=size_unit,
                                 distance=csv_number(distance, 2), temperature=csv_number(temperature(value), 3),
                                 source_frame=frames[i] if i < len(frames) else None,
                                 geometry=json.dumps({'type': 'Point', 'coordinates': point})))
    return rows


class MeasurementsCsvView(DatasetView):
    def get(self, request, pk):
        """The conversion's saved measurements as CSV, in the user's temperature unit"""
        import csv
        import io
        from django.http import HttpResponse
        conversion = get_conversion(pk)
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow([label for _k, label in CSV_COLUMNS])
        for m in conversion.measurements.all():
            for row in csv_rows(m, app_unit()):
                writer.writerow(["" if row[k] is None else row[k] for k, _l in CSV_COLUMNS])
        response = HttpResponse(buf.getvalue(), content_type='text/csv; charset=utf-8')
        name = download_name("{}-{}-measurements".format(conversion.dataset.name, conversion.name)) + ".csv"
        response['Content-Disposition'] = 'attachment; filename="{}"'.format(name)
        return response


class MeasurementsGeoJsonView(DatasetView):
    def get(self, request, pk):
        """The conversion's measurements on its mosaics as GeoJSON (lon/lat), their values as in the CSV, in the user's
        temperature unit; those on frames have no place on the map and are left out"""
        from django.http import HttpResponse
        conversion = get_conversion(pk)
        unit = app_unit()
        features = [{'type': 'Feature', 'geometry': m.geometry,
                     'properties': {k: row[k] for k, _l in CSV_COLUMNS if k not in ('frame', 'geometry')}}
                    for m in conversion.measurements.exclude(target='frame')
                    for row in csv_rows(m, unit, profile=False)]
        response = HttpResponse(json.dumps({'type': 'FeatureCollection', 'features': features}, ensure_ascii=False),
                                content_type='application/geo+json; charset=utf-8')
        name = download_name("{}-{}-measurements".format(conversion.dataset.name, conversion.name)) + ".geojson"
        response['Content-Disposition'] = 'attachment; filename="{}"'.format(name)
        return response


def frame_info(conversion, rel, measured_frame):
    """A frame as its page shows it: its size, the parameters it was measured with and its temperatures' statistics"""
    values = measured_frame['values']
    return {'frame': rel, 'width': int(values.shape[1]), 'height': int(values.shape[0]),
            'params': measured_frame['params'], 'distance_source': measured_frame['distance_source'],
            'notes': measured_frame['notes'], 'offset': measured_frame['offset'],
            'offset_known': measured_frame['offset_known'], 'settings': measured_frame['settings'],
            'stats': thermal_measure.value_stats(values)}


class FramesView(DatasetView):
    def get(self, request, pk):
        """The frames of the conversion's dataset, and what the frame page needs to show them"""
        conversion = get_conversion(pk)
        palettes = viewer_palettes(conversion)
        rows = {r['path']: r for r in thermal_measure.frame_rows(conversion)}
        recorded = ('emissivity', 'humidity', 'distance', 'lrf', 'reflection', 'ambient', 'alt', 'pitch', 'time')
        return Response(dict(conversion_summary(conversion), **{
            'dataset_name': conversion.dataset.name,
            'unit': (conversion.options or {}).get('unit') or 'C',
            'normalized': bool((conversion.options or {}).get('normalize')),
            'frames': [dict(f, recorded={k: rows[f['path']].get(k) for k in recorded})
                       for f in thermal_measure.frame_list(conversion)],
            'palettes': palettes, 'default_palette': default_palette(conversion, palettes),
            'changes': list(thermal_measure.CHANGES), 'limits': thermal_conversion.LIMITS,
        }))


class FrameView(DatasetView):
    def get(self, request, pk):
        """One frame as the conversion converted it (?frame=), and measured again with the parameters given"""
        from .thermal_analysis import clean
        conversion = get_conversion(pk)
        rel = request.query_params.get('frame') or ""
        changes = changes_of(request.query_params)
        out = frame_info(conversion, rel, frame_measured(conversion, rel))
        if changes:
            out['changed'] = frame_info(conversion, rel, frame_measured(conversion, rel, changes))
        return Response(clean(out))


class FrameImageView(DatasetView):
    def get(self, request, pk, ext=None):
        """A frame drawn as the mosaics' tiles are (color_map, rescale, isotherm, gamma, equalize, sharpen), measured
        again with the parameters given"""
        from .raster.tiler import render_tile, tile_format
        conversion = get_conversion(pk)
        rel = request.query_params.get('frame') or ""
        m = frame_measured(conversion, rel, changes_of(request.query_params))
        cmap, low, high, isotherm, adjust = style_params(request, conversion)
        values = m['values']
        valid = np.isfinite(values)
        mask = np.where(valid, 255, 0).astype(np.uint8)
        ext, driver, options = tile_format(request, mask, ext or 'png')
        bands, cmap = thermal_measure.colorize(values, valid, cmap, low, high, isotherm, adjust,
                                               frame_curve(values, low, high, adjust))
        content = render_tile(bands, mask, driver, colormap=cmap, **options)
        from django.http import HttpResponse
        response = HttpResponse(content, content_type="image/{}".format(ext))
        response['Cache-Control'] = 'private, max-age=600'
        return response


class FrameDataView(DatasetView):
    def get(self, request, pk):
        """A frame's temperatures (see data_response; its width and height are the frame's), measured again with the
        parameters given"""
        conversion = get_conversion(pk)
        rel = request.query_params.get('frame') or ""
        values = frame_measured(conversion, rel, changes_of(request.query_params))['values']
        return data_response(values, np.isfinite(values), None, 'private, max-age=600')


class FrameCurveView(DatasetView):
    def get(self, request, pk):
        """How a frame's image is drawn (see MosaicCurveView), measured again with the parameters given"""
        conversion = get_conversion(pk)
        rel = request.query_params.get('frame') or ""
        m = frame_measured(conversion, rel, changes_of(request.query_params))
        low, high = range_params(request)
        adjust = adjust_params(request)
        return Response({'shares': thermal_measure.curve_shares(low, high, adjust,
                                                                frame_curve(m['values'], low, high, adjust))})


class FramePointView(DatasetView):
    def get(self, request, pk):
        """A frame's temperature at a pixel (x, y), as converted and measured again with the parameters given"""
        conversion = get_conversion(pk)
        rel = request.query_params.get('frame') or ""
        try:
            x, y = float(request.query_params.get('x')), float(request.query_params.get('y'))
        except (TypeError, ValueError):
            raise ValidationError({'error': "x and y are required"}) from None
        changes = changes_of(request.query_params)

        def at(m):
            values = m['values']
            row, col = int(np.floor(y)), int(np.floor(x))
            if not (0 <= row < values.shape[0] and 0 <= col < values.shape[1]) or not np.isfinite(values[row, col]):
                return None
            return float(values[row, col])

        base = frame_measured(conversion, rel)
        out = {'x': x, 'y': y, 'unit': (conversion.options or {}).get('unit') or 'C', 'temperature': at(base),
               'inside': 0 <= x < base['values'].shape[1] and 0 <= y < base['values'].shape[0]}
        if changes:
            out['changed'] = at(frame_measured(conversion, rel, changes))
        return Response(out)
