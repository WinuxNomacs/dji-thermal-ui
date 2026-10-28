"""
The API of the Thermal Analyzer: the projects (a site's datasets together), the thermal datasets (uploaded images, or a folder on this computer), uploading their
images, their analysis in a job, their conversions (several, side by side), their mosaics (tiles and values for the
viewer), the radiometric analysis of the mosaics and frames (measuring, saved measurements, frames measured again with
other parameters) and the saved preferences (conversion settings, temperature unit).

Ported from LuxODM's thermal-analyzer plugin (commit a2a81052), without its projects and permissions: everything here
is the one user's.
"""
import colorsys
import datetime
import hashlib
import io
import json
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

from . import basemaps, jobs, places, thermal_analysis, thermal_conversion, thermal_measure, thermal_mosaics
from .downloads import download_file_response, download_file_stream
from .models import (FINDING_SEVERITIES, FINDING_STATUSES, Finding, Preferences, Project, ThermalConversion,
                     ThermalDataset, ThermalMeasurement)
from .raster.security import path_traversal_check

PREFERENCES_KEY = 'conversion_settings'
UNIT_KEY = 'unit'
DEFAULT_UNIT = 'F'
THEME_KEY = 'theme'
THEMES = ('system', 'light', 'dark')     # system: the computer's own light or dark
LOCALE_KEY = 'locale'
# The locales dates and times can be shown in besides the computer's own (""), named by the browser
LOCALES = ('en-US', 'en-GB', 'en-CA', 'en-AU', 'fr-CA', 'fr-FR', 'de-DE', 'es-ES', 'es-MX', 'it-IT', 'nl-NL',
           'pt-BR', 'pl-PL', 'sv-SE', 'ja-JP', 'ko-KR', 'zh-CN')
IMAGE_EXTENSIONS = ('.jpg', '.jpeg')
MAX_FOLDER_DEPTH = 4    # subfolders kept from an uploaded folder (e.g. thermal/, 100MEDIA/)
MAX_NAME_LENGTH = 255
MAX_DESCRIPTION_LENGTH = 10000
VISUAL_FRAME_QUALITY = 90               # a visual frame as the pages show it
REPORT_AUTHOR_KEY = 'report_author'     # the author last typed on a report, which fills in new ones


def get_project(pk):
    try:
        return Project.objects.get(pk=pk)
    except Project.DoesNotExist:
        raise NotFound() from None


def project_id_of(value):
    """The project a dataset is made in or moved to, from its id"""
    try:
        return Project.objects.get(pk=int(value)).id
    except (TypeError, ValueError, Project.DoesNotExist):
        raise ValidationError({'project': "That project does not exist"}) from None


def location_of(value):
    """A project's location from {lon, lat, label}, or None to clear it"""
    if value is None:
        return None, None, ""
    if not isinstance(value, dict):
        raise ValidationError({'location': "A location is a point (lon, lat) with its label"})
    try:
        lon, lat = float(value.get('lon')), float(value.get('lat'))
    except (TypeError, ValueError):
        raise ValidationError({'location': "A location is a point (lon, lat) with its label"}) from None
    if not (-180 <= lon <= 180 and -90 <= lat <= 90):
        raise ValidationError({'location': "That point is not on the Earth (lon -180 to 180, lat -90 to 90)"})
    return lon, lat, str(value.get('label') or "").strip()[:MAX_NAME_LENGTH]


def project_fields(data, partial):
    """The fields a project is made or changed with (partial: only those given)"""
    out = {}
    if not partial or 'name' in data:
        name = str(data.get('name') or '').strip()
        if not name:
            raise ValidationError({'name': "A name is required"})
        out['name'] = name[:MAX_NAME_LENGTH]
    if 'description' in data:
        description = data.get('description') or ""
        if not isinstance(description, str):
            raise ValidationError({'description': "A description is text"})
        if len(description) > MAX_DESCRIPTION_LENGTH:
            raise ValidationError({'description': "That is longer than {} characters".format(MAX_DESCRIPTION_LENGTH)})
        out['description'] = description.strip()
    if 'location' in data:
        out['location_lon'], out['location_lat'], out['location_label'] = location_of(data.get('location'))
    return out


def project_summary(project):
    """A project as the projects page shows it: its datasets' counts, and the disk space the app keeps for them
    (uploaded images and outputs: a folder dataset's own folder is not the app's)"""
    datasets = list(project.datasets.all())
    conversions = list(ThermalConversion.objects.filter(dataset__project=project).only('size', 'mosaic_status'))
    kept = sum(d.size for d in datasets if d.source == 'upload') + sum(c.size for c in conversions)
    location = None
    if project.location_lon is not None and project.location_lat is not None:
        location = {'lon': project.location_lon, 'lat': project.location_lat, 'label': project.location_label}
    return {
        'id': project.id,
        'name': project.name,
        'description': project.description,
        'location': location,
        'dataset_count': len(datasets),
        'conversion_count': len(conversions),
        'mosaic_count': sum(1 for c in conversions if c.mosaic_status == 'ready'),
        'measurement_count': ThermalMeasurement.objects.filter(conversion__dataset__project=project).count(),
        'finding_count': Finding.objects.filter(dataset__project=project).count(),
        'size': int(kept * 1024 * 1024),
        'created_at': project.created_at,
        'updated_at': project.updated_at,
    }


def project_detail(project):
    """A project with where each of its datasets was flown, and its datasets' findings"""
    out = project_summary(project)
    out['areas'] = [{'dataset': d.id, 'name': d.name, 'ring': ring} for d in project.datasets.all()
                    for ring in [thermal_analysis.flight_area(d.analysis)] if ring]
    out['findings'] = project_findings(project)
    return out


def project_findings(project):
    """A project's findings, each with its dataset's name and the conversion it opens on: the one its temperatures
    were read on, or the dataset's latest with mosaics when that one has none (none when no conversion has them)"""
    shown = {}
    for c in ThermalConversion.objects.filter(dataset__project=project, status='ready', mosaic_status='ready'):
        shown.setdefault(c.dataset_id, []).append(c.id)
    out = []
    for f in Finding.objects.filter(dataset__project=project).select_related('conversion', 'dataset'):
        ids = shown.get(f.dataset_id) or []
        item = finding_json(f)
        item.update(dataset_name=f.dataset.name, opens=f.conversion_id if f.conversion_id in ids else max(ids, default=None))
        out.append(item)
    return out


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
        'project': dataset.project_id,
        'name': dataset.name,
        'source': dataset.source,
        'status': dataset.status,
        'progress': dataset.progress,
        'error': dataset.error,
        'file_count': dataset.file_count,
        'size': int(dataset.size * 1024 * 1024),
        'thermal': files.get('thermal', 0),
        'not_thermal': sum(n for k, n in files.items() if k != 'thermal'),
        'visual': sum(1 for r in a.get('files') or [] if thermal_analysis.is_visual(r)),
        'errors': s.get('error', 0),
        'warnings': s.get('warning', 0),
        'infos': s.get('info', 0),
        'cameras': sorted(set(c.get('model') or "" for c in a.get('cameras') or [])),
        'analyzed': bool(a),
        'conversion_count': len(conversions),
        'conversions_ready': sum(1 for c in conversions if c.status == 'ready'),
        'mosaic_count': sum(1 for c in conversions if c.mosaic_status == 'ready'),
        'measurement_count': ThermalMeasurement.objects.filter(conversion__dataset=dataset).count(),
        'finding_count': dataset.findings.count(),
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
    out['project_name'] = dataset.project.name
    out['analysis'] = dataset.analysis or {}
    out['flight_zone'] = thermal_analysis.flight_zone(dataset.analysis)
    out['flight_area'] = thermal_analysis.flight_area(dataset.analysis)
    out['report'] = dataset.report or {}
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
    out['report'] = c.report or {}
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


def app_locale():
    """The locale dates and times are shown in (the preferences'), "" for the computer's own"""
    locale = Preferences.load().data.get(LOCALE_KEY)
    return locale if locale in LOCALES else ""


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


def report_author():
    """The author last typed on a report, "" when none was"""
    return Preferences.load().data.get(REPORT_AUTHOR_KEY) or ""


DATASET_REPORT = ('title', 'author', 'date', 'notes', 'appendix')
MOSAIC_REPORT = ('title', 'author', 'date', 'notes', 'view', 'left_out')
VIEW_KEYS = {'tab': str, 'palette': str, 'range': list, 'adjust': dict, 'findings': bool, 'hidden': list}
MAX_LEFT_OUT = 1000


def parse_report(value, saved, keys=DATASET_REPORT):
    """A report's text, changed: the keys sent replace those saved (a title, author and notes are text, the date a
    YYYY-MM-DD day or "", the appendix a yes or no; a mosaic report's view as the viewer's URL has it, and the ids of
    the measurements it leaves out; null forgets one, which the page then fills in again)"""
    if not isinstance(value, dict):
        raise ValidationError({'report': "An object of " + ", ".join(keys)})
    out = dict(saved or {})
    for key, v in value.items():
        if key not in keys:
            raise ValidationError({'report': "Unknown: {}".format(key)})
        if v is None:
            out.pop(key, None)
        elif key in ('title', 'author', 'notes'):
            limit = MAX_DESCRIPTION_LENGTH if key == 'notes' else MAX_NAME_LENGTH
            if not isinstance(v, str) or len(v) > limit:
                raise ValidationError({'report': "The {} is text of {} characters at most".format(key, limit)})
            out[key] = v
        elif key == 'date':
            if not isinstance(v, str) or v and not parse_day(v):
                raise ValidationError({'report': "The date is a day as YYYY-MM-DD"})
            out[key] = v
        elif key == 'appendix':
            if not isinstance(v, bool):
                raise ValidationError({'report': "The appendix is true or false"})
            out[key] = v
        elif key == 'view':
            out[key] = report_view(v)
        else:
            if not isinstance(v, list) or len(v) > MAX_LEFT_OUT or \
                    not all(isinstance(i, int) and not isinstance(i, bool) and i > 0 for i in v):
                raise ValidationError({'report': "The measurements left out are their ids"})
            out[key] = sorted(set(v))
    return out


def report_view(v):
    """A mosaic report's view, checked: what the viewer's URL keeps (tab, palette, range, adjust, findings, hidden)"""
    def refuse():
        raise ValidationError({'report': "The view is the viewer's: " + ", ".join(VIEW_KEYS)})
    if not isinstance(v, dict) or len(json.dumps(v)) > 2000:
        refuse()
    for key, x in v.items():
        if not isinstance(x, VIEW_KEYS.get(key, type(None))) or isinstance(x, str) and len(x) > 64:
            refuse()
    r = v.get('range')
    if r is not None and not (len(r) == 2 and all(isinstance(n, (int, float)) and not isinstance(n, bool) and
                                                  np.isfinite(n) for n in r) and r[0] < r[1]):
        refuse()
    a = v.get('adjust')
    if a is not None and not (set(a) <= {'gamma', 'equalize', 'sharpen'} and
                              all(isinstance(n, (int, float)) for n in a.values())):
        refuse()
    if not all(isinstance(i, int) and not isinstance(i, bool) for i in v.get('hidden') or []):
        refuse()
    return v


def remember_author(report):
    """Keeps the author typed on a report for new ones (a blank one forgets nothing)"""
    if report.get('author', '').strip():
        save_preference(REPORT_AUTHOR_KEY, report['author'].strip())


def parse_day(text):
    try:
        return len(text) == 10 and datetime.date.fromisoformat(text)
    except ValueError:
        return None


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


class ProjectListCreateView(DatasetView):
    def get(self, request):
        """The projects, oldest first (the Default Project made if there is none)"""
        Project.default()
        return Response({'projects': [project_summary(p) for p in Project.objects.all()]})

    def post(self, request):
        project = Project.objects.create(**project_fields(request.data, partial=False))
        return Response(project_detail(project), status=status.HTTP_201_CREATED)


class ProjectDetailView(DatasetView):
    def get(self, request, pk):
        return Response(project_detail(get_project(pk)))

    def patch(self, request, pk):
        project = get_project(pk)
        fields = project_fields(request.data, partial=True)
        for k, v in fields.items():
            setattr(project, k, v)
        project.save(update_fields=list(fields) + ['updated_at'])
        return Response(project_detail(project))

    def delete(self, request, pk):
        """Deletes the project with its datasets (their running jobs find their runs gone and stop); the Default
        Project is made again when it was the last"""
        get_project(pk).delete()
        Project.default()
        return Response(status=status.HTTP_204_NO_CONTENT)


class NavigationView(DatasetView):
    def get(self, request):
        """What the navigation pane lists: the projects, their datasets and the datasets' conversions, with what each
        conversion has to show (its frames once converted, its mosaics once built)"""
        Project.default()
        projects = Project.objects.prefetch_related('datasets__conversions')
        return Response({'projects': [{
            'id': p.id, 'name': p.name,
            'datasets': [{
                'id': d.id, 'name': d.name,
                'conversions': [{'id': c.id, 'name': c.name, 'frames': c.status == 'ready',
                                 'mosaics': c.status == 'ready' and c.mosaic_status == 'ready'}
                                for c in d.conversions.all()],
            } for d in p.datasets.all()],
        } for p in projects]})


class PlacesView(DatasetView):
    def get(self, request):
        """Places for a project's location, from OpenStreetMap: those a text names (?q=), or the one at a point
        (?lon=&lat=), named in the browser's language"""
        language = request.headers.get('Accept-Language', '')[:100]
        try:
            if 'q' in request.query_params:
                query = request.query_params['q'].strip()
                if not query:
                    raise ValidationError({'q': "Type an address or a place to search for"})
                if len(query) > places.MAX_QUERY_LENGTH:
                    raise ValidationError({'q': "That is longer than {} characters".format(places.MAX_QUERY_LENGTH)})
                found = places.search(query, language)
            else:
                lon, lat, _ = location_of({'lon': request.query_params.get('lon'),
                                           'lat': request.query_params.get('lat')})
                at = places.reverse(lon, lat, language)
                found = [at] if at else []
        except places.PlacesError as e:
            return Response({'detail': str(e)}, status=status.HTTP_502_BAD_GATEWAY)
        return Response({'places': found, 'service': places.SERVICE, 'attribution': places.ATTRIBUTION})


class DatasetListCreateView(DatasetView):
    def get(self, request):
        """The datasets, newest first: all of them, or a project's"""
        datasets = ThermalDataset.objects.all()
        if request.query_params.get('project'):
            datasets = datasets.filter(project=get_project(request.query_params['project']))
        return Response({'datasets': [summary(check_stale(d)) for d in datasets]})

    def post(self, request):
        project = project_id_of(request.data['project']) if request.data.get('project') is not None else None
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

        dataset = ThermalDataset.objects.create(project_id=project, name=name[:255], source=source,
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
        """Renames the dataset, moves it to another project, or changes its report's text (the author typed is kept
        for new reports)"""
        dataset = get_dataset(pk)
        fields = []
        if 'report' in request.data:
            dataset.report = parse_report(request.data['report'], dataset.report)
            fields.append('report')
            remember_author(dataset.report)
        if 'project' in request.data:
            dataset.project_id = project_id_of(request.data['project'])
            fields.append('project')
        if 'name' in request.data or not fields:
            name = str(request.data.get('name', '')).strip()
            if not name:
                raise ValidationError({'name': "A name is required"})
            dataset.name = name[:255]
            fields.append('name')
        # Only these: a running analysis writes the rest
        dataset.save(update_fields=fields + ['updated_at'])
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
        """Renames the conversion, or changes its mosaic report's text and view (the author typed is kept for new
        reports)"""
        conversion = get_conversion(pk)
        fields = []
        if 'report' in request.data:
            conversion.report = parse_report(request.data['report'], conversion.report, MOSAIC_REPORT)
            fields.append('report')
            remember_author(conversion.report)
        if 'name' in request.data or not fields:
            name = str(request.data.get('name', '')).strip()
            if not name:
                raise ValidationError({'name': "A name is required"})
            conversion.name = name[:255]
            fields.append('name')
        # Only these: a running conversion writes the rest
        conversion.save(update_fields=fields)
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
            'locale': app_locale(),
            'locales': list(LOCALES),
            'products': thermal_conversion.products(),
            'palettes': thermal_conversion.palettes(),
            'limits': thermal_conversion.LIMITS,
        })

    def put(self, request):
        """Saves settings as the defaults for new conversions, and/or the unit temperatures are shown in, and/or the
        pages' theme, and/or the locale of dates and times ("": the computer's), and/or the Mapbox token (null forgets
        it)"""
        out = {}
        for key, choices in ((UNIT_KEY, thermal_conversion.UNITS), (THEME_KEY, THEMES), (LOCALE_KEY, ("",) + LOCALES)):
            if key in request.data:
                value = request.data.get(key)
                if value not in choices:
                    raise ValidationError({key: "One of {}".format(", ".join(c or '""' for c in choices))})
                save_preference(key, value)
                out[key] = value
        if basemaps.TOKEN_KEY in request.data:
            token = request.data.get(basemaps.TOKEN_KEY)
            if token is not None:
                error = basemaps.token_error(token)
                if error:
                    raise ValidationError({basemaps.TOKEN_KEY: error})
                token = token.strip()
            save_preference(basemaps.TOKEN_KEY, token)
            out['mapbox'] = basemaps.mapbox_state()
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
                'flight_zone': thermal_analysis.flight_zone(conversion.dataset.analysis),
                'stripped': bool(m.get('stripped')), 'frames': m.get('frames') or [], 'tabs': tabs,
                'kinds': {kind: {key: v for key, v in k.items() if key not in ('raster',)} for kind, k in kinds.items()},
                'palettes': palettes, 'default_palette': default_palette(conversion, palettes) if kinds else None,
                'baselines': {kind: thermal_measure.mosaic_baseline(conversion, kind) for kind in kinds},
                'frame_colors': encoded(frame_colormap()[i] for i in range(FRAME_COLORS)),
                'visual': {k: v for k, v in m['visual'].items() if k != 'raster'} if m.get('visual') else None,
                'visual_note': m.get('visual_note') or ""})
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
    """Values as the browser colours them: float32 little-endian, row by row, NO_DATA where there are none, their
    width and height in X-Width and X-Height"""
    from django.http import HttpResponse
    valid = valid & np.isfinite(values)
    res = HttpResponse(np.where(valid, values, NO_DATA).astype('<f4').tobytes(), content_type='application/octet-stream')
    res['X-Height'], res['X-Width'] = values.shape
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
    """What reads the mosaics' tiles here, for their ETag (the tiler's own code is in tile_code_fingerprint)"""
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
        """How the browser draws a temperature tab's tiles over rescale with gamma and equalize (corrected as they
        are): the palette's share at thermal_measure.CURVE_SAMPLES temperatures evenly across the range, for the legend"""
        conversion = get_conversion(pk)
        path, band = mosaic_raster(conversion, tab)
        if band != 1:
            raise NotFound()
        low, high = range_params(request)
        adjust = adjust_params(request)
        correction = mosaic_correction(request, conversion, tab)
        curve = mosaic_curve(conversion, tab, path, band, correction, low, high, adjust)
        return Response({'shares': thermal_measure.curve_shares(low, high, adjust, curve)})


def mosaic_point(request, conversion, tab, lon, lat):
    """A mosaic tab's values at a point (lon, lat): temperature (corrected as the tiles are), source frame, view angle
    and the frame's pixel it was read from (column, row; none in a mosaic built before dji-thermal-cli 1.4.0)"""
    from .raster.tiler import point_values

    path, _band = mosaic_raster(conversion, tab)
    m = conversion.mosaics or {}
    unit = m.get('unit') or 'C'
    out = {'coordinates': [lon, lat], 'valid': False, 'unit': unit,
           'temperature': None, 'frame': None, 'frame_index': None, 'view_angle': None, 'frame_pixel': None}
    with thermal_mosaics.open_raster(path) as src:
        values = point_values(src, lon, lat, indexes=(1, 2, 3, 4, 5) if src.dataset.count >= 5 else (1, 2, 3))
    if values is None:
        out['reason'] = 'outside_raster'
        return out
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
    return out


class MosaicPointView(DatasetView):
    def get(self, request, pk, tab):
        """A mosaic tab's values at a point (see mosaic_point)"""
        conversion = get_conversion(pk)
        mosaic_raster(conversion, tab)
        try:
            lon, lat = float(request.query_params.get('lon')), float(request.query_params.get('lat'))
        except (TypeError, ValueError):
            raise ValidationError({'error': "lon and lat are required"}) from None
        if not (-180 <= lon <= 180 and -90 <= lat <= 90):
            raise ValidationError({'error': "Coordinates out of range"})
        return Response(mosaic_point(request, conversion, tab, lon, lat))


def frame_sources(conversion, path, geometry):
    """The frames that saw a checked spot or area of a mosaic (path: its GeoTIFF), each with when it was taken and its
    visual pair (or None): {frames, reason, kind, geometry, models}"""
    from . import thermal_sources

    models = thermal_sources.read_models(path)
    out = thermal_sources.sources(path, geometry, (conversion.mosaics or {}).get('frames') or [], models)
    times = {r['path']: r.get('time') or "" for r in thermal_measure.frame_rows(conversion)}
    pairs = thermal_mosaics.read_visual_pairs(conversion.data_dir())
    for f in out['frames']:
        f['time'] = times.get(f['frame'], "")
        f['visual'] = pairs.get(f['frame'])
    out.update(kind=geometry['type'], geometry=geometry, models=models is not None)
    return out


class MosaicSourcesView(DatasetView):
    def post(self, request, pk, tab):
        """
        The frames that saw a spot or an area of a mosaic tab (geometry: a GeoJSON Point or Polygon, lon/lat), the ones
        the mosaic used first (see thermal_sources.sources), each with when it was taken; models: whether the mosaic
        knows every frame that saw it (built with dji-thermal-cli 1.5.0 or later), else it lists only those it used.
        A spot also gets the mosaic's values there (point, as MosaicPointView's).
        """
        conversion = get_conversion(pk)
        path, _band = mosaic_raster(conversion, tab)
        try:
            geometry = thermal_measure.check_geometry(request.data.get('geometry'))
        except thermal_measure.MeasureError as e:
            raise ValidationError({'error': str(e)}) from None
        if geometry['type'] not in ('Point', 'Polygon'):
            raise ValidationError({'error': "The geometry is a spot or an area"})
        out = frame_sources(conversion, path, geometry)
        if geometry['type'] == 'Point':
            out['point'] = mosaic_point(request, conversion, tab, *geometry['coordinates'])
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


def comparable(conversion):
    """The conversions whose mosaics the conversion's can be compared with (its own too): its project's first, then
    by project, dataset and name, with their temperature tabs"""
    out = []
    own = conversion.dataset.project_id
    found = ThermalConversion.objects.select_related('dataset__project').order_by(
        'dataset__project__name', 'dataset__project_id', 'dataset__name', 'dataset_id', 'name', 'id')
    for c in sorted(found, key=lambda c: c.dataset.project_id != own):
        kinds = (c.mosaics or {}).get('kinds') or {}
        tabs = [tab for tab, kind, band in thermal_mosaics.TABS if band == 1 and kinds.get(kind)]
        if tabs:
            out.append({'id': c.id, 'name': c.name, 'dataset': c.dataset_id, 'dataset_name': c.dataset.name,
                        'project': c.dataset.project_id, 'project_name': c.dataset.project.name,
                        'unit': mosaic_unit(c), 'tabs': tabs})
    return out


class ComparableView(DatasetView):
    def get(self, request, pk):
        """The mosaics a conversion's can be compared with"""
        return Response(comparable(get_conversion(pk)))


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
            'parameters': m.parameters, 'values': m.values, 'comment': m.comment, 'created_at': m.created_at}


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
        Renames a measurement (name), changes its comment, or measures it again with other parameters (parameters: as
        MeasureView's, {} for the conversion's own), on the same target, frame, geometry and isotherm
        """
        conversion, m = get_measurement(pk, mid)
        fields = []
        if 'comment' in request.data:
            comment = request.data.get('comment')
            if not isinstance(comment, str) or len(comment) > MAX_DESCRIPTION_LENGTH:
                raise ValidationError({'comment': "Text of {} characters at most".format(MAX_DESCRIPTION_LENGTH)})
            m.comment = comment
            fields.append('comment')
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
            raise ValidationError({'error': "Give a name, a comment or parameters"})
        m.save(update_fields=fields)
        return Response(measurement_json(m))

    def delete(self, request, pk, mid):
        _c, m = get_measurement(pk, mid)
        m.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


FINDING_TABS = ('as_converted', 'harmonized')
# What a finding keeps of what its spot or area measured
FINDING_TEMPERATURES = ('min', 'max', 'mean', 'surroundings', 'delta_t', 'value', 'valid_pixels', 'area')


def get_finding(pk, fid):
    try:
        return Finding.objects.select_related('conversion').get(pk=fid, dataset_id=get_dataset(pk).id)
    except Finding.DoesNotExist:
        raise NotFound() from None


def finding_json(f):
    return {'id': f.id, 'dataset': f.dataset_id, 'name': f.name, 'notes': f.notes, 'severity': f.severity,
            'status': f.status, 'geometry': f.geometry, 'shape': f.shape, 'conversion': f.conversion_id,
            'conversion_name': f.conversion.name if f.conversion else "", 'tab': f.tab, 'temperatures': f.temperatures,
            'frames': f.frames, 'models': f.models_known, 'created_at': f.created_at, 'updated_at': f.updated_at}


def finding_fields(data, partial):
    """The fields a finding is saved or changed with (partial: only those given)"""
    out = {}
    if not partial or 'name' in data:
        name = str(data.get('name') or "").strip()
        if not name or len(name) > MAX_NAME_LENGTH:
            raise ValidationError({'name': "A name of 1 to {} characters is required".format(MAX_NAME_LENGTH)})
        out['name'] = name
    if 'notes' in data:
        notes = data.get('notes') or ""
        if not isinstance(notes, str):
            raise ValidationError({'notes': "Notes are text"})
        if len(notes) > MAX_DESCRIPTION_LENGTH:
            raise ValidationError({'notes': "That is longer than {} characters".format(MAX_DESCRIPTION_LENGTH)})
        out['notes'] = notes.strip()
    for field, choices in (('severity', FINDING_SEVERITIES), ('status', FINDING_STATUSES)):
        if field in data:
            if data[field] not in dict(choices):
                raise ValidationError({field: "The {} is one of {}".format(field, ", ".join(dict(choices)))})
            out[field] = data[field]
    return out


def kept_frames(frames, kept):
    """A finding's frames, each marked kept when its name is in kept (None: all of them)"""
    if kept is not None and (not isinstance(kept, list) or not all(isinstance(k, str) for k in kept)):
        raise ValidationError({'kept': "The frames kept are a list of their names"})
    return [dict(f, kept=kept is None or f['frame'] in kept) for f in frames]


def finding_temperatures(values):
    """What a finding keeps of a measure's {result, unit, approximate} (and the parameters it was corrected with)"""
    result = values.get('result') or {}
    out = {k: result[k] for k in FINDING_TEMPERATURES if result.get(k) is not None}
    out.update(unit=values.get('unit') or 'C', approximate=bool(values.get('approximate')))
    return out


def finding_from_measurement(dataset, mid):
    """A saved measurement's spot or area, as a finding is made from it: (conversion, tab, geometry, shape,
    temperatures)"""
    try:
        m = ThermalMeasurement.objects.select_related('conversion').get(pk=int(mid), conversion__dataset=dataset)
    except (TypeError, ValueError, ThermalMeasurement.DoesNotExist):
        raise ValidationError({'measurement': "That measurement does not exist"}) from None
    if m.target not in FINDING_TABS:
        raise ValidationError({'measurement': "Only a measurement on a mosaic can be saved as a finding"})
    if m.geometry.get('type') not in ('Point', 'Polygon'):
        raise ValidationError({'measurement': "Only a spot or an area can be saved as a finding"})
    values = m.values or {}
    temperatures = finding_temperatures(values)
    if m.parameters:
        temperatures['parameters'] = m.parameters
    return m.conversion, m.target, m.geometry, values.get('shape'), temperatures


def finding_drawn(dataset, data):
    """A spot or area drawn on a mosaic, measured as a finding is made from it: (conversion, tab, geometry, shape,
    temperatures)"""
    try:
        conversion = dataset.conversions.get(pk=int(data.get('conversion')))
    except (TypeError, ValueError, ThermalConversion.DoesNotExist):
        raise ValidationError({'conversion': "That conversion does not exist"}) from None
    tab = data.get('tab')
    if tab not in FINDING_TABS:
        raise ValidationError({'tab': "The temperatures are read on a mosaic (as_converted, harmonized)"})
    asked = {'target': tab, 'geometry': data.get('geometry'), 'parameters': data.get('parameters')}
    _t, _f, geometry, parameters, _i = analysis_request(conversion, asked)
    if geometry is None or geometry['type'] not in ('Point', 'Polygon'):
        raise ValidationError({'error': "A finding is a spot or an area"})
    try:
        shape = thermal_measure.check_shape(data.get('shape'), geometry)
    except thermal_measure.MeasureError as e:
        raise ValidationError({'error': str(e)}) from None
    temperatures = finding_temperatures(analysis(conversion, tab, "", geometry, parameters, None))
    if parameters:
        temperatures['parameters'] = parameters
    return conversion, tab, geometry, shape, temperatures


class FindingsView(DatasetView):
    def get(self, request, pk):
        """The dataset's findings, oldest first"""
        dataset = get_dataset(pk)
        return Response({'findings': [finding_json(f) for f in dataset.findings.select_related('conversion')]})

    def post(self, request, pk):
        """
        Saves a spot or an area as a finding (name, notes, severity, status): drawn on a conversion's mosaic
        (conversion, tab, geometry, shape, parameters: the correction, as MeasureView's), its temperatures measured
        there; or a saved measurement's (measurement: its id), its figures copied. The frames that saw it are found
        on that mosaic, the ones named in kept kept (all without it).
        """
        dataset = get_dataset(pk)
        fields = finding_fields(request.data, partial=False)
        if request.data.get('measurement') not in (None, ""):
            conversion, tab, geometry, shape, temperatures = finding_from_measurement(dataset, request.data['measurement'])
        else:
            conversion, tab, geometry, shape, temperatures = finding_drawn(dataset, request.data)
        if not temperatures.get('valid_pixels'):
            raise ValidationError({'error': "The finding is outside the mosaic"})
        path, _band = mosaic_raster(conversion, tab)
        found = frame_sources(conversion, path, geometry)
        f = Finding.objects.create(dataset=dataset, conversion=conversion, tab=tab, geometry=geometry, shape=shape,
                                   temperatures=temperatures, frames=kept_frames(found['frames'], request.data.get('kept')),
                                   models_known=found['models'], **fields)
        return Response(finding_json(f), status=status.HTTP_201_CREATED)


class FindingDetailView(DatasetView):
    def patch(self, request, pk, fid):
        """Changes a finding's name, notes, severity or status, or the frames kept (kept: their names)"""
        f = get_finding(pk, fid)
        fields = finding_fields(request.data, partial=True)
        if 'kept' in request.data:
            fields['frames'] = kept_frames(f.frames, request.data['kept'])
        if not fields:
            raise ValidationError({'error': "Give a name, notes, a severity, a status or the frames kept"})
        for k, v in fields.items():
            setattr(f, k, v)
        f.save(update_fields=list(fields) + ['updated_at'])
        return Response(finding_json(f))

    def delete(self, request, pk, fid):
        get_finding(pk, fid).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


CSV_COLUMNS = (('name', "Name"), ('target', "Measured on"), ('frame', "Frame"), ('kind', "Shape"),
               ('min', "Min"), ('max', "Max"), ('mean', "Mean"), ('median', "Median"), ('std', "Std dev"),
               ('surroundings', "Surroundings"), ('delta_t', "ΔT"), ('unit', "Unit"), ('isotherm', "Isotherm"),
               ('isotherm_share', "Isotherm share"), ('length', "Length"), ('area', "Area"),
               ('size_unit', "Length / area unit"), ('valid_pixels', "Pixels"), ('distance', "Distance"),
               ('temperature', "Temperature"), ('source_frame', "Source frame"), ('parameters', "Parameters changed"),
               ('approximate', "Approximate"), ('comment', "Comment"), ('geometry', "Geometry"), ('created_at', "Saved at"))


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
            'comment': m.comment if which == 'result' else "",
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
            'flight_zone': thermal_analysis.flight_zone(conversion.dataset.analysis),
            'frames': [dict(f, recorded={k: rows[f['path']].get(k) for k in recorded})
                       for f in thermal_measure.frame_list(conversion)],
            'palettes': palettes, 'default_palette': default_palette(conversion, palettes),
            'changes': list(thermal_measure.CHANGES), 'limits': thermal_conversion.LIMITS,
        }))


class FrameView(DatasetView):
    def get(self, request, pk):
        """One frame as the conversion converted it (?frame=), and measured again with the parameters given; its visual
        pair, when the visual mosaic has it (see thermal_mosaics.visual_pairs)"""
        from .thermal_analysis import clean
        conversion = get_conversion(pk)
        rel = request.query_params.get('frame') or ""
        changes = changes_of(request.query_params)
        out = frame_info(conversion, rel, frame_measured(conversion, rel))
        if changes:
            out['changed'] = frame_info(conversion, rel, frame_measured(conversion, rel, changes))
        out['visual'] = thermal_mosaics.read_visual_pairs(conversion.data_dir()).get(rel)
        return Response(clean(out))


class FrameDataView(DatasetView):
    def get(self, request, pk):
        """A frame's temperatures (see data_response; its width and height are the frame's), measured again with the
        parameters given"""
        conversion = get_conversion(pk)
        rel = request.query_params.get('frame') or ""
        values = frame_measured(conversion, rel, changes_of(request.query_params))['values']
        return data_response(values, np.isfinite(values), None, 'private, max-age=600')


class FrameVisualView(DatasetView):
    def get(self, request, pk):
        """A thermal frame's visual pair (?frame=, the thermal frame) as a JPEG, at most ?size= pixels across (default:
        its own size), without its metadata"""
        from PIL import Image
        from django.http import HttpResponse
        conversion = get_conversion(pk)
        pair = thermal_mosaics.read_visual_pairs(conversion.data_dir()).get(request.query_params.get('frame') or "")
        if not pair:
            raise NotFound({'error': "The frame has no visual pair"})
        try:
            size = int(request.query_params.get('size') or 0)
        except ValueError:
            raise ValidationError({'error': "size is a number of pixels"}) from None
        root = conversion.dataset.images_dir()
        try:
            path = path_traversal_check(os.path.join(root, pair['frame']), root)
        except SuspiciousFileOperation:
            raise NotFound() from None
        if not os.path.isfile(path):
            raise NotFound({'error': "The visual frame is not there any more"})
        out = io.BytesIO()
        with Image.open(path) as im:
            if size > 0:
                im.draft('RGB', (size, size))
                im = im.convert('RGB')
                im.thumbnail((size, size))
            im.convert('RGB').save(out, 'JPEG', quality=VISUAL_FRAME_QUALITY)
        response = HttpResponse(out.getvalue(), content_type="image/jpeg")
        response['Cache-Control'] = 'private, max-age=600'
        return response


class VisualTileView(DatasetView):
    def get(self, request, pk, z, x, y):
        """A tile of the conversion's visual mosaic: a PNG, transparent where no frame saw the ground"""
        from django.http import HttpResponse
        from rio_tiler.errors import TileOutsideBounds
        from .raster.tiler import ZOOM_EXTRA_LEVELS, get_zoom_safe, not_modified, raster_etag
        conversion = get_conversion(pk)
        path = thermal_mosaics.visual_raster(conversion.data_dir(), conversion.mosaics or {})
        if not path or not os.path.isfile(path):
            raise NotFound()
        etag = raster_etag(request, path, viewer_code_fingerprint())
        cached = not_modified(request, etag)
        if cached is not None:
            return cached
        z, x, y = int(z), int(x), int(y)
        with thermal_mosaics.open_raster(path) as src:
            minzoom, maxzoom = get_zoom_safe(src)
            if not src.tile_exists(tile_x=x, tile_y=y, tile_z=z) or \
                    z < minzoom - ZOOM_EXTRA_LEVELS or z > maxzoom + ZOOM_EXTRA_LEVELS:
                raise NotFound()
            try:
                tile = src.tile(x, y, z, indexes=(1, 2, 3), resampling_method='bilinear',
                                reproject_method='bilinear')
            except TileOutsideBounds:
                raise NotFound() from None
        res = HttpResponse(tile.render(img_format='PNG'), content_type='image/png')
        res['ETag'] = etag
        res['Cache-Control'] = 'private, no-cache'
        return res


class FrameCurveView(DatasetView):
    def get(self, request, pk):
        """How the browser draws a frame (see MosaicCurveView), measured again with the parameters given"""
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
